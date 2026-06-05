import { defineBackground } from '#imports'
import { browser } from '@/lib/browser.js'
import { stripFramingHeaders } from '@/lib/headers.js'
import { checkHost } from '@/lib/monitor.js'
import { getHosts, getSettings, pushResult, ensureSeeded } from '@/lib/storage.js'

// Firefox MV2 persistent background page. WXT imports this file in Node at build time to read the
// entrypoint options, so ALL runtime code must live inside main() — only imports stay at the top.
export default defineBackground({
  persistent: true,
  main () {
    const ALARM = 'glanceboard-check'
    const FILTER = { urls: ['*://*/*'], types: ['sub_frame', 'xmlhttprequest'] }
    const certCache = new Map() // hostname -> { certExpiresInDays, capturedAt }
    const lastOk = new Map() // host id -> last ok/error state (notify only on ok -> error)

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
      // Strip framing headers ONLY for our preview iframes — never top-level navigations, so a
      // monitored site keeps its clickjacking protection when opened in a normal tab/window.
      if (details.type === 'sub_frame') {
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
            title: 'Glanceboard — host unreachable',
            message: `${host.hostname}: ${sample.error || 'check failed'}`
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
        for (const host of hosts) {
          // Isolate per-host failures so one bad write/notification doesn't skip the rest this cycle.
          try {
            const result = await checkHost(host.url, { timeoutMs: 15000 })
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

    browser.alarms.onAlarm.addListener((alarm) => {
      if (alarm.name === ALARM) runChecks().catch(err => console.error('Glanceboard runChecks failed', err))
    })

    // Re-register the listener when hosts change; (re)schedule or stop checks when settings change.
    browser.storage.onChanged.addListener(async (changes, area) => {
      if (area !== 'local') return
      if (changes.hosts) registerWebRequest()
      if (changes.settings) await scheduleChecks(await getSettings())
    })

    registerWebRequest()
    browser.permissions.onAdded.addListener(registerWebRequest)
    browser.permissions.onRemoved.addListener(registerWebRequest)

    async function init () {
      await ensureSeeded()
      const settings = await getSettings()
      await scheduleChecks(settings)
      if ((Number(settings.intervalMinutes) || 0) >= 1) {
        runChecks().catch(err => console.error('Glanceboard initial run failed', err))
      }
    }

    init().catch(err => console.error('Glanceboard init failed', err))
  }
})
