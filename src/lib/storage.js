import { browser } from './browser.js'
import { normalizeHost } from './url.js'

// storage.local schema:
//   hosts:    [{ id, url, hostname, addedAt, metrics:{cert,load} }]   id = origin (unique key)
//   results:  { [id]: { timestamp[], elapsed[], certExpiresInDays[], ok, error, source, lastTimestamp } }
//   settings: { intervalMinutes, mode, notificationsEnabled, maxSamples, cardMinWidth, metricDefaults }
//   seeded:   true once the (currently empty) default host list has been written
const KEYS = { hosts: 'hosts', results: 'results', settings: 'settings', seeded: 'seeded' }

// No default hosts — the user adds their own. (Kept as an empty list so seeding a default
// set later is trivial if ever wanted.)
export const SEED_HOSTNAMES = []

export const DEFAULT_SETTINGS = {
  intervalMinutes: 0, // 0 = off (no background checks); >= 1 = check every N minutes (floor 1)
  mode: 'auto', // 'auto' | 'desktop' | 'mobile'
  notificationsEnabled: false,
  maxSamples: 60,
  cardMinWidth: 320, // px — min preview-tile width for the responsive desktop grid
  metricDefaults: { cert: false, load: false } // default visibility of the cert/load tiles for new hosts
}

function makeHost (input) {
  const n = normalizeHost(input)
  if (!n) return null
  return { id: n.id, url: n.url, hostname: n.hostname, addedAt: Date.now() }
}

export async function getHosts () {
  const { [KEYS.hosts]: hosts } = await browser.storage.local.get(KEYS.hosts)
  return Array.isArray(hosts) ? hosts : []
}

export async function setHosts (hosts) {
  await browser.storage.local.set({ [KEYS.hosts]: hosts })
}

export async function addHost (input) {
  const host = makeHost(input)
  if (!host) throw new Error('Invalid host or URL')
  const hosts = await getHosts()
  if (hosts.some(h => h.id === host.id)) return hosts // dedupe
  const { metricDefaults } = await getSettings()
  host.metrics = { ...metricDefaults }
  const next = [...hosts, host]
  await setHosts(next)
  return next
}

export async function removeHost (id) {
  const hosts = await getHosts()
  const removed = hosts.find(h => h.id === id)
  const next = hosts.filter(h => h.id !== id)
  await setHosts(next)

  // Revoke the per-host permission once no remaining host needs its origin match pattern, so a
  // removed host is truly no longer accessible (preserves the per-host least-privilege model).
  const pattern = removed && normalizeHost(removed.url)?.originPattern
  if (pattern && browser.permissions?.remove) {
    const stillNeeded = next.some(h => normalizeHost(h.url)?.originPattern === pattern)
    if (!stillNeeded) {
      try {
        await browser.permissions.remove({ origins: [pattern] })
      } catch { /* best-effort; permission revocation isn't critical to storage correctness */ }
    }
  }

  const results = await getAllResults()
  if (results[id]) {
    delete results[id]
    await browser.storage.local.set({ [KEYS.results]: results })
  }
  return next
}

// Toggle one metric tile (cert | load) for a single host.
export async function setHostMetric (id, key, value) {
  const hosts = await getHosts()
  const next = hosts.map(h => (h.id === id ? { ...h, metrics: { ...h.metrics, [key]: value } } : h))
  await setHosts(next)
  return next
}

// Toggle one metric tile (cert | load) for every host at once.
export async function setAllHostsMetric (key, value) {
  const hosts = await getHosts()
  const next = hosts.map(h => ({ ...h, metrics: { ...h.metrics, [key]: value } }))
  await setHosts(next)
  return next
}

export async function getAllResults () {
  const { [KEYS.results]: results } = await browser.storage.local.get(KEYS.results)
  return results && typeof results === 'object' ? results : {}
}

// Append a measurement to a host's rolling history (newest first, matching the old data shape
// so LineChart ports unchanged). Cert is "sticky": a sample without a fresh cert reading keeps
// the last known value rather than blanking the column.
export async function pushResult (id, sample, maxSamples = DEFAULT_SETTINGS.maxSamples) {
  const results = await getAllResults()
  const prev = results[id] || { timestamp: [], elapsed: [], certExpiresInDays: [] }
  const cert = sample.certExpiresInDays ?? prev.certExpiresInDays?.[0] ?? null
  results[id] = {
    timestamp: [sample.timestamp, ...(prev.timestamp || [])].slice(0, maxSamples),
    elapsed: [sample.elapsed, ...(prev.elapsed || [])].slice(0, maxSamples),
    certExpiresInDays: [cert, ...(prev.certExpiresInDays || [])].slice(0, maxSamples),
    ok: sample.ok,
    error: sample.error || null,
    source: sample.source || 'fetch',
    lastTimestamp: sample.timestamp
  }
  await browser.storage.local.set({ [KEYS.results]: results })
  return results[id]
}

export async function getSettings () {
  const { [KEYS.settings]: s } = await browser.storage.local.get(KEYS.settings)
  const merged = { ...DEFAULT_SETTINGS, ...(s || {}) }
  // metricDefaults is nested — deep-merge so a partial stored value keeps the other key's default.
  merged.metricDefaults = { ...DEFAULT_SETTINGS.metricDefaults, ...(s?.metricDefaults || {}) }
  return merged
}

export async function setSettings (patch) {
  const current = await getSettings()
  const next = { ...current, ...patch }
  // Merge (not replace) the nested metricDefaults so partial patches aren't destructive.
  if (patch && patch.metricDefaults) {
    next.metricDefaults = { ...current.metricDefaults, ...patch.metricDefaults }
  }
  await browser.storage.local.set({ [KEYS.settings]: next })
  return next
}

// Seed the default host list once, on first run.
export async function ensureSeeded () {
  const { [KEYS.seeded]: seeded } = await browser.storage.local.get(KEYS.seeded)
  if (seeded) return
  const hosts = SEED_HOSTNAMES.map(makeHost).filter(Boolean)
  await browser.storage.local.set({ [KEYS.hosts]: hosts, [KEYS.seeded]: true })
}

// Subscribe to local storage changes. Returns an unsubscribe function.
export function onChanged (callback) {
  const listener = (changes, area) => {
    if (area === 'local') callback(changes)
  }
  browser.storage.onChanged.addListener(listener)
  return () => browser.storage.onChanged.removeListener(listener)
}
