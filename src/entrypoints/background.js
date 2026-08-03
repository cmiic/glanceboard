import { defineBackground } from '#imports'
import { browser } from '@/lib/browser.js'
import { stripFramingHeaders, isFromOwnExtension, isApprovedTarget } from '@/lib/headers.js'
import { checkHost } from '@/lib/monitor.js'
import { stepDelay, delayUntilSlot } from '@/lib/schedule.js'
import { refreshFeedSources } from '@/lib/feed-refresh.js'
import { nextFeedRefreshAt } from '@/lib/feed-polling.js'
import {
  getHosts, getSettings, pushResult, ensureSeeded, migrateResultsToPerKey,
  reconcileOriginPermissions, entryOrigin, entryLabel, getFeedSources, getAllFeedCaches
} from '@/lib/storage.js'

// Firefox MV2 persistent background page. WXT imports this file in Node at build time to read the
// entrypoint options, so ALL runtime code must live inside main() — only imports stay at the top.
export default defineBackground({
  persistent: true,
  main () {
    const ALARM = 'glanceboard-check'
    const FEED_ALARM = 'glanceboard-feed-refresh'
    const FILTER = { urls: ['*://*/*'], types: ['sub_frame', 'xmlhttprequest'] }
    const EXT_BASE = browser.runtime.getURL('/') // our extension's moz-extension:// base URL
    const certCache = new Map() // hostname -> { certExpiresInDays, capturedAt }
    const lastOk = new Map() // host id -> last ok/error state (notify only on ok -> error)
    // Origins the user explicitly added — the allowlist gating framing-header stripping. Derived from
    // each entry's origin, NOT its id: a page entry's id carries a path, while isApprovedTarget
    // matches on origin. Kept in sync with storage.local `hosts` (populated in init, refreshed on
    // change) so the blocking onHeadersReceived path can check it synchronously.
    let approvedOrigins = new Set()

    function certDaysFromSecurityInfo (info) {
      if (!info || (info.state !== 'secure' && info.state !== 'weak')) return null
      const cert = info.certificates && info.certificates[0]
      const end = cert && cert.validity && cert.validity.end
      if (!end) return null
      return Math.floor((end - Date.now()) / 86400000)
    }

    // Fire-and-forget cert capture, kept OUT of the blocking return path so header stripping stays
    // synchronous; getSecurityInfo is initiated while the requestId is still valid.
    function captureCert (details) {
      browser.webRequest.getSecurityInfo(details.requestId, {})
        .then((info) => {
          const days = certDaysFromSecurityInfo(info)
          if (days !== null) {
            certCache.set(new URL(details.url).hostname, { certExpiresInDays: days, capturedAt: Date.now() })
          }
        })
        .catch(() => { /* not every request exposes security info */ })
    }

    function onHeadersReceived (details) {
      captureCert(details)
      // Strip framing headers ONLY for our dashboard's own preview iframes (not top-level loads, not
      // frames embedded by other sites) AND only when the framed origin is one the user added — so a
      // monitored host keeps its clickjacking protection everywhere except inside our preview, and a
      // redirect to an unrelated origin is never silently de-protected.
      if (details.type === 'sub_frame' && isFromOwnExtension(details, EXT_BASE) && isApprovedTarget(details.url, approvedOrigins)) {
        return { responseHeaders: stripFramingHeaders(details.responseHeaders) }
      }
      return undefined
    }

    // Firefox snapshots the permitted-host set when the listener is ADDED; host permissions are
    // granted per host at runtime, so re-add the listener whenever they change.
    function registerWebRequest () {
      if (browser.webRequest.onHeadersReceived.hasListener(onHeadersReceived)) {
        browser.webRequest.onHeadersReceived.removeListener(onHeadersReceived)
      }
      browser.webRequest.onHeadersReceived.addListener(onHeadersReceived, FILTER, ['blocking', 'responseHeaders'])
    }

    async function maybeNotify (host, sample, settings) {
      const was = lastOk.get(host.id)
      lastOk.set(host.id, sample.ok)
      if (!settings.notificationsEnabled) return
      if (was !== false && sample.ok === false) {
        try {
          await browser.notifications.create(`glanceboard-${host.id}`, {
            type: 'basic',
            iconUrl: browser.runtime.getURL(browser.runtime.getManifest().icons['192']),
            title: 'Glanceboard — site unreachable',
            // The label, not the hostname — two monitored pages of one host must be distinguishable.
            message: `${entryLabel(host)}: ${sample.error || 'check failed'}`
          })
        } catch (_e) { /* notifications are best-effort */ }
      }
    }

    let running = false
    async function runChecks () {
      if (running) return
      running = true
      try {
        const [hosts, settings] = await Promise.all([getHosts(), getSettings()])
        // These checks were already sequential — one request in flight at a time — but ran with no
        // gap, so a set of quick hosts still got hit back to back. Space them out, shortening the
        // gap when the gaps alone wouldn't fit inside the check interval. Only the gaps are
        // budgeted: request time is not, so a cycle of slow or timing-out hosts can still overrun
        // its interval, and the `running` guard above drops the tick that lands during it.
        const gapMs = stepDelay(hosts.length, (Number(settings.intervalMinutes) || 0) * 60000)
        const startedAt = Date.now()
        for (const [index, host] of hosts.entries()) {
          // Wait until this host's slot, not for a full gap after the previous request — otherwise
          // each request's own duration is added to the spacing and the cycle overruns its interval.
          const wait = delayUntilSlot(index, gapMs, startedAt, Date.now())
          if (wait > 0) await new Promise(resolve => setTimeout(resolve, wait))
          // Isolate per-host failures so one bad write/notification doesn't skip the rest this cycle.
          try {
            const result = await checkHost(host.url, { timeoutMs: 15000 })
            // Cert is a property of the host, so pages of the same host share one cached reading.
            const cert = certCache.get(host.hostname)
            const sample = { ...result, certExpiresInDays: cert ? cert.certExpiresInDays : null }
            await pushResult(host.id, sample, settings.maxSamples)
            await maybeNotify(host, sample, settings)
          } catch (err) {
            console.error('Glanceboard check failed for', host.id, err)
          }
        }
      } finally {
        running = false
      }
    }

    // intervalMinutes 0 = off → no alarm, stay fully passive. >= 1 = poll every N minutes.
    async function scheduleChecks (settings) {
      const n = Number(settings.intervalMinutes) || 0
      if (n >= 1) {
        await browser.alarms.create(ALARM, { periodInMinutes: n })
      } else {
        await browser.alarms.clear(ALARM)
      }
    }

    const pendingFeedJobs = []
    let feedQueueRunning = false

    async function drainFeedQueue () {
      if (feedQueueRunning) return
      feedQueueRunning = true
      try {
        while (pendingFeedJobs.length) {
          // A user-forced refresh goes ahead of queued automatic/dashboard-due work, but never
          // interrupts a refresh batch already in flight.
          pendingFeedJobs.sort((a, b) => b.priority - a.priority || a.order - b.order)
          const job = pendingFeedJobs.shift()
          try {
            const settings = await getSettings()
            const result = await refreshFeedSources(job.sourceIds, {
              force: job.force, pollingEnabled: !!settings.feedPollingEnabled
            })
            await scheduleFeedRefresh(settings)
            job.resolve(result)
          } catch (error) {
            console.error('Glanceboard feed refresh failed', error)
            job.reject(error)
          }
        }
      } finally {
        feedQueueRunning = false
        // JavaScript currently reaches this point without yielding after the final empty check,
        // but re-check after releasing the lock so a future await at that boundary cannot strand a
        // job whose enqueue attempt observed feedQueueRunning=true.
        if (pendingFeedJobs.length) {
          drainFeedQueue().catch(error => console.error('Glanceboard feed queue re-drain failed', error))
        }
      }
    }

    let feedJobOrder = 0
    function enqueueFeedRefresh (sourceIds, { force = false } = {}) {
      return new Promise((resolve, reject) => {
        pendingFeedJobs.push({ sourceIds, force, priority: force ? 1 : 0, order: feedJobOrder++, resolve, reject })
        drainFeedQueue().catch(error => {
          console.error('Glanceboard feed queue failed', error)
          reject(error)
        })
      })
    }

    async function scheduleFeedRefresh (settings) {
      if (!settings.feedPollingEnabled) {
        await browser.alarms.clear(FEED_ALARM)
        return
      }
      const [sources, caches] = await Promise.all([getFeedSources(), getAllFeedCaches()])
      const when = nextFeedRefreshAt(sources, caches)
      if (when == null) await browser.alarms.clear(FEED_ALARM)
      else await browser.alarms.create(FEED_ALARM, { when: Math.max(Date.now() + 1000, when) })
    }

    browser.alarms.onAlarm.addListener((alarm) => {
      if (alarm.name === ALARM) runChecks().catch(err => console.error('Glanceboard runChecks failed', err))
      if (alarm.name === FEED_ALARM) enqueueFeedRefresh(null).catch(err => console.error('Glanceboard scheduled feed refresh failed', err))
    })

    browser.runtime.onMessage.addListener((message) => {
      if (message?.type !== 'refresh-feeds') return undefined
      return enqueueFeedRefresh(Array.isArray(message.sourceIds) ? message.sourceIds : null, { force: !!message.force })
    })

    // Re-register the listener when hosts change; (re)schedule or stop checks when settings change.
    browser.storage.onChanged.addListener(async (changes, area) => {
      if (area !== 'local') return
      if (changes.hosts) {
        // Keep the strip allowlist in sync from the event payload (synchronous, race-free).
        approvedOrigins = new Set((changes.hosts.newValue || []).map(entryOrigin).filter(Boolean))
        registerWebRequest()
      }
      if (changes.settings) {
        const settings = await getSettings()
        await scheduleChecks(settings)
        await scheduleFeedRefresh(settings)
      } else if (changes.feedSources) {
        await scheduleFeedRefresh(await getSettings())
      }
    })

    async function init () {
      // Load the strip allowlist and register the header listener FIRST — before any other async
      // setup — so onHeadersReceived is never live with an empty allowlist (which would skip stripping
      // and break previews on cold start / right after an upgrade).
      approvedOrigins = new Set((await getHosts()).map(entryOrigin).filter(Boolean))
      registerWebRequest()
      browser.permissions.onAdded.addListener(registerWebRequest)
      browser.permissions.onRemoved.addListener(registerWebRequest)
      await ensureSeeded()
      await migrateResultsToPerKey() // one-time upgrade from the legacy monolithic `results` object
      await reconcileOriginPermissions()
      const settings = await getSettings()
      await scheduleChecks(settings)
      await scheduleFeedRefresh(settings)
      if ((Number(settings.intervalMinutes) || 0) >= 1) {
        runChecks().catch(err => console.error('Glanceboard initial run failed', err))
      }
      if (settings.feedPollingEnabled) {
        enqueueFeedRefresh(null).catch(err => console.error('Glanceboard initial feed refresh failed', err))
      }
    }

    init().catch(err => console.error('Glanceboard init failed', err))
  }
})
