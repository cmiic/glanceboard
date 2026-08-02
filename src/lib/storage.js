import { browser } from './browser.js'
import { normalizeTarget } from './url.js'
import { normalizeHttpUrl } from './rss.js'
import { feedSourceDisplay } from './feed-settings.js'

// storage.local schema:
//   hosts:      [{ id, url, hostname, origin, label, addedAt, metrics:{cert,load}, layout:{x,y,w,h} }]
//               id = the normalized URL: the bare origin for a whole-site entry, origin + path for a
//               single monitored page. Several pages of one host are independent entries.
//               layout = { x, y, w, h } desktop tile position and size in grid units (see
//               lib/layout.js); absent means "place it automatically".
//   result:<id>: { timestamp[], elapsed[], certExpiresInDays[], ok, error, source, lastTimestamp }
//               one key per monitored entry — so two pages of the same host keep separate histories,
//               and concurrent writers (parallel preview iframes) don't clobber each other. The old
//               monolithic `results` object is migrated away (migrateResultsToPerKey).
//   settings:   { intervalMinutes, previewIntervalMinutes, mode, notificationsEnabled, maxSamples, cardMinWidth, metricDefaults }
//   feedSources:[{ id, type, url, discoveredFrom, title, groupId, addedAt,
//                  display:{showImage,showDescription,descriptionMaxChars} }]
//   feedGroups: [{ id, name, addedAt, layout:{x,y,w,h} }]
//   feed-cache:<id>: { fetchedAt, etag, lastModified, channel, items, error }
//   seeded:     true once the (currently empty) default host list has been written
const KEYS = {
  hosts: 'hosts', results: 'results', settings: 'settings', seeded: 'seeded',
  feedSources: 'feedSources', feedGroups: 'feedGroups'
}
// Per-entry results key prefix. `result:<entry id>` → that site's or page's rolling history.
const RESULT_PREFIX = 'result:'
const FEED_CACHE_PREFIX = 'feed-cache:'

// No default hosts — the user adds their own. (Kept as an empty list so seeding a default
// set later is trivial if ever wanted.)
export const SEED_HOSTNAMES = []

export const DEFAULT_SETTINGS = {
  intervalMinutes: 0, // 0 = off (no background checks); >= 1 = check every N minutes (floor 1)
  previewIntervalMinutes: 0, // 0 = off (load previews once on open, no auto-refresh); >= 1 = refresh every N min
  mode: 'auto', // 'auto' | 'desktop' | 'mobile'
  notificationsEnabled: false,
  maxSamples: 60,
  cardMinWidth: 320, // px — min preview-tile width for the responsive desktop grid
  metricDefaults: { cert: false, load: false } // default visibility of the cert/load tiles for new hosts
}

function makeEntry (input) {
  const n = normalizeTarget(input)
  if (!n) return null
  return { id: n.id, url: n.url, hostname: n.hostname, origin: n.origin, label: n.label, addedAt: Date.now() }
}

// `origin` and `label` arrived with page support, so entries stored by an older version lack them.
// Derive rather than migrate — the stored `url` is always enough to recompute both.
export function entryOrigin (entry) {
  return entry?.origin || normalizeTarget(entry?.url)?.origin || null
}

export function entryLabel (entry) {
  return entry?.label || normalizeTarget(entry?.url)?.label || entry?.hostname || ''
}

export async function getHosts () {
  const { [KEYS.hosts]: hosts } = await browser.storage.local.get(KEYS.hosts)
  return Array.isArray(hosts) ? hosts : []
}

export async function setHosts (hosts) {
  await browser.storage.local.set({ [KEYS.hosts]: hosts })
}

export async function getFeedSources () {
  const { [KEYS.feedSources]: sources } = await browser.storage.local.get(KEYS.feedSources)
  return Array.isArray(sources) ? sources : []
}

export async function getFeedGroups () {
  const { [KEYS.feedGroups]: groups } = await browser.storage.local.get(KEYS.feedGroups)
  return Array.isArray(groups) ? groups : []
}

export async function getAllFeedCaches () {
  const all = await browser.storage.local.get(null)
  const out = {}
  for (const key of Object.keys(all || {})) {
    if (key.startsWith(FEED_CACHE_PREFIX)) out[key.slice(FEED_CACHE_PREFIX.length)] = all[key]
  }
  return out
}

// Vue makes objects placed in refs deeply reactive. Firefox storage uses the structured-clone
// algorithm, which rejects those Proxy wrappers with DataCloneError. Feed caches contain only JSON
// data, so serialize at this boundary to unwrap both the outer value and any nested reactive values.
function plainStorageValue (value) {
  return value == null ? value : JSON.parse(JSON.stringify(value))
}

export async function setFeedCaches (cachesBySourceId) {
  const writes = {}
  const plain = {}
  for (const [sourceId, cache] of Object.entries(cachesBySourceId || {})) {
    plain[sourceId] = plainStorageValue(cache)
    writes[FEED_CACHE_PREFIX + sourceId] = plain[sourceId]
  }
  if (Object.keys(writes).length) await browser.storage.local.set(writes)
  return plain
}

export async function setFeedCache (sourceId, cache) {
  return (await setFeedCaches({ [sourceId]: cache }))[sourceId]
}

function originPattern (url) {
  return normalizeTarget(url)?.originPattern || null
}

export function requiredOriginPatterns (hosts, sources) {
  return new Set([
    ...(hosts || []).map(item => originPattern(item.url)),
    ...(sources || []).map(item => originPattern(item.url))
  ].filter(Boolean))
}

async function revokeOriginIfUnused (url, hosts, sources) {
  const pattern = originPattern(url)
  if (!pattern || !browser.permissions?.remove || requiredOriginPatterns(hosts, sources).has(pattern)) return
  try {
    await browser.permissions.remove({ origins: [pattern] })
  } catch { /* Permission cleanup is best-effort. */ }
}

// Clean up a permission used only during discovery, while respecting saved sites and feeds.
export async function revokePermissionIfUnused (url) {
  const [hosts, sources] = await Promise.all([getHosts(), getFeedSources()])
  await revokeOriginIfUnused(url, hosts, sources)
}

export async function addHost (input) {
  const host = makeEntry(input)
  if (!host) throw new Error('Invalid site or URL')
  const hosts = await getHosts()
  // Dedupe on the full id, so two pages of the same host are kept as separate entries.
  if (hosts.some(h => h.id === host.id)) return hosts
  const { metricDefaults } = await getSettings()
  host.metrics = { ...metricDefaults }
  const next = [...hosts, host]
  await setHosts(next)
  return next
}

export async function removeHost (id) {
  const [hosts, sources] = await Promise.all([getHosts(), getFeedSources()])
  const removed = hosts.find(h => h.id === id)
  const next = hosts.filter(h => h.id !== id)
  await setHosts(next)
  await browser.storage.local.remove(RESULT_PREFIX + id)
  if (removed) await revokeOriginIfUnused(removed.url, next, sources)
  return next
}

function cleanGroupName (name) {
  const value = String(name || '').trim()
  if (!value) throw new Error('Enter a feed group name')
  return value.slice(0, 80)
}

function groupNameExists (groups, name, exceptId = null) {
  const key = name.toLocaleLowerCase()
  return groups.some(group => group.id !== exceptId && group.name.toLocaleLowerCase() === key)
}

function newGroupId () {
  const value = globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(16).slice(2)}`
  return `feed-group:${value}`
}

export function suggestGroupName (base, groups) {
  const root = String(base || '').trim() || 'Feed group'
  let name = root
  let suffix = 2
  while (groupNameExists(groups || [], name)) name = `${root} (${suffix++})`
  return name
}

export async function createFeedGroup (name) {
  const groups = await getFeedGroups()
  const clean = cleanGroupName(name)
  if (groupNameExists(groups, clean)) throw new Error('A feed group with this name already exists')
  const group = { id: newGroupId(), name: clean, addedAt: Date.now() }
  await browser.storage.local.set({ [KEYS.feedGroups]: [...groups, group] })
  return group
}

export async function renameFeedGroup (id, name) {
  const groups = await getFeedGroups()
  const clean = cleanGroupName(name)
  if (!groups.some(group => group.id === id)) throw new Error('Feed group not found')
  if (groupNameExists(groups, clean, id)) throw new Error('A feed group with this name already exists')
  const next = groups.map(group => group.id === id ? { ...group, name: clean } : group)
  await browser.storage.local.set({ [KEYS.feedGroups]: next })
  return next
}

function buildFeedAddition (sources, groups, items, { groupId = null, groupName = '' } = {}) {
  let group = groupId ? groups.find(item => item.id === groupId) : null
  let nextGroups = groups
  if (!group) {
    const clean = cleanGroupName(groupName)
    if (groupNameExists(groups, clean)) throw new Error('A feed group with this name already exists')
    group = { id: newGroupId(), name: clean, addedAt: Date.now() }
    nextGroups = [...groups, group]
  }

  const existingIds = new Set(sources.map(source => source.id))
  const now = Date.now()
  const added = []
  const writes = {}
  for (const item of (items || [])) {
    const normalized = normalizeHttpUrl(item.url)
    if (!normalized) throw new Error('Invalid RSS URL')
    const type = String(item.type || 'rss')
    const id = `${type}:${normalized}`
    if (existingIds.has(id)) continue
    existingIds.add(id)
    added.push({
      id, type, url: normalized, discoveredFrom: item.discoveredFrom || null,
      title: String(item.title || '').trim() || new URL(normalized).hostname,
      groupId: group.id, addedAt: now, display: feedSourceDisplay(item)
    })
    if (item.cache) writes[FEED_CACHE_PREFIX + id] = plainStorageValue(item.cache)
  }
  if (!added.length && !groupId) throw new Error('This RSS feed is already added')
  return { sources: [...sources, ...added], groups: nextGroups, group, added, writes }
}

export async function addFeedSources (items, options = {}) {
  const [sources, groups] = await Promise.all([getFeedSources(), getFeedGroups()])
  const result = buildFeedAddition(sources, groups, items, options)
  await browser.storage.local.set({
    [KEYS.feedSources]: result.sources,
    [KEYS.feedGroups]: result.groups,
    ...result.writes
  })
  return result
}

// Commit the user's Site / RSS / Both choice in one storage write after every permission and feed
// validation has succeeded. Either part may be omitted.
export async function addSiteAndFeedSources ({ siteInput = null, feeds = [], groupId = null, groupName = '' } = {}) {
  const [hosts, sources, groups, settings] = await Promise.all([
    getHosts(), getFeedSources(), getFeedGroups(), getSettings()
  ])
  let nextHosts = hosts
  if (siteInput) {
    const host = makeEntry(siteInput)
    if (!host) throw new Error('Invalid site or URL')
    if (!hosts.some(item => item.id === host.id)) {
      host.metrics = { ...settings.metricDefaults }
      nextHosts = [...hosts, host]
    }
  }
  let feedResult = { sources, groups, group: null, added: [], writes: {} }
  if (feeds.length) {
    try {
      feedResult = buildFeedAddition(sources, groups, feeds, { groupId, groupName })
    } catch (error) {
      // Choosing Both still adds a missing website when every selected feed already exists. An
      // RSS-only duplicate remains an actionable error instead of creating an empty group.
      if (!siteInput || !/already added/.test(error?.message || '')) throw error
    }
  }
  await browser.storage.local.set({
    [KEYS.hosts]: nextHosts,
    [KEYS.feedSources]: feedResult.sources,
    [KEYS.feedGroups]: feedResult.groups,
    ...feedResult.writes
  })
  return { hosts: nextHosts, ...feedResult }
}

export async function moveFeedSource (id, groupId) {
  const [sources, groups] = await Promise.all([getFeedSources(), getFeedGroups()])
  if (!groups.some(group => group.id === groupId)) throw new Error('Feed group not found')
  const next = sources.map(source => source.id === id ? { ...source, groupId } : source)
  await browser.storage.local.set({ [KEYS.feedSources]: next })
  return next
}

export async function setFeedSourceDisplay (id, patch) {
  const sources = await getFeedSources()
  if (!sources.some(source => source.id === id)) throw new Error('Feed source not found')
  const next = sources.map(source => source.id === id
    ? { ...source, display: feedSourceDisplay({ display: { ...feedSourceDisplay(source), ...(patch || {}) } }) }
    : source)
  await browser.storage.local.set({ [KEYS.feedSources]: next })
  return next
}

export async function removeFeedSource (id) {
  const [sources, hosts] = await Promise.all([getFeedSources(), getHosts()])
  const removed = sources.find(source => source.id === id)
  const next = sources.filter(source => source.id !== id)
  await browser.storage.local.set({ [KEYS.feedSources]: next })
  await browser.storage.local.remove(FEED_CACHE_PREFIX + id)
  if (removed) await revokeOriginIfUnused(removed.url, hosts, next)
  return next
}

export async function removeFeedGroup (id) {
  const [groups, sources, hosts] = await Promise.all([getFeedGroups(), getFeedSources(), getHosts()])
  const removedSources = sources.filter(source => source.groupId === id)
  const nextGroups = groups.filter(group => group.id !== id)
  const nextSources = sources.filter(source => source.groupId !== id)
  await browser.storage.local.set({ [KEYS.feedGroups]: nextGroups, [KEYS.feedSources]: nextSources })
  if (removedSources.length) await browser.storage.local.remove(removedSources.map(source => FEED_CACHE_PREFIX + source.id))
  const removedUrlsByPattern = new Map(removedSources.map(source => [originPattern(source.url), source.url]))
  for (const url of removedUrlsByPattern.values()) await revokeOriginIfUnused(url, hosts, nextSources)
  return { groups: nextGroups, sources: nextSources }
}

// Toggle one metric tile (cert | load) for a single host.
export async function setHostMetric (id, key, value) {
  const hosts = await getHosts()
  const next = hosts.map(h => (h.id === id ? { ...h, metrics: { ...h.metrics, [key]: value } } : h))
  await setHosts(next)
  return next
}

// Persist the whole wall in one write: `byId` is { [host id]: { x, y, w, h } } in grid units.
// A drag or resize moves the tiles it displaces too, so they are always saved together — and one
// write means one storage event, not one per tile.
export async function setHostLayouts (byId) {
  const hosts = await getHosts()
  const next = hosts.map((h) => {
    const layout = byId?.[h.id]
    return layout ? { ...h, layout: { x: layout.x, y: layout.y, w: layout.w, h: layout.h } } : h
  })
  await setHosts(next)
  return next
}

// Persist a mixed wall without changing the established host schema. Feed group IDs are namespaced,
// so one geometry map can update both collections safely in a single storage write.
export async function setTileLayouts (byId) {
  const [hosts, groups] = await Promise.all([getHosts(), getFeedGroups()])
  const withLayout = item => {
    const layout = byId?.[item.id]
    return layout ? { ...item, layout: { x: layout.x, y: layout.y, w: layout.w, h: layout.h } } : item
  }
  const nextHosts = hosts.map(withLayout)
  const nextGroups = groups.map(withLayout)
  await browser.storage.local.set({ [KEYS.hosts]: nextHosts, [KEYS.feedGroups]: nextGroups })
  return { hosts: nextHosts, groups: nextGroups }
}

// Drop every tile back to automatic placement and sizing.
export async function resetHostLayouts () {
  const hosts = await getHosts()
  const next = hosts.map(h => {
    const copy = { ...h }
    delete copy.layout
    return copy
  })
  await setHosts(next)
  return next
}

export async function resetTileLayouts () {
  const [hosts, groups] = await Promise.all([getHosts(), getFeedGroups()])
  const withoutLayout = item => {
    const copy = { ...item }
    delete copy.layout
    return copy
  }
  const nextHosts = hosts.map(withoutLayout)
  const nextGroups = groups.map(withoutLayout)
  await browser.storage.local.set({ [KEYS.hosts]: nextHosts, [KEYS.feedGroups]: nextGroups })
  return { hosts: nextHosts, groups: nextGroups }
}

// Toggle one metric tile (cert | load) for every host at once.
export async function setAllHostsMetric (key, value) {
  const hosts = await getHosts()
  const next = hosts.map(h => ({ ...h, metrics: { ...h.metrics, [key]: value } }))
  await setHosts(next)
  return next
}

// Collect every entry's history back into the `{ [id]: {...} }` shape the UI expects, reading the
// per-entry `result:<id>` keys (one storage read for all of them).
export async function getAllResults () {
  const all = await browser.storage.local.get(null)
  const out = {}
  for (const key of Object.keys(all || {})) {
    if (key.startsWith(RESULT_PREFIX)) out[key.slice(RESULT_PREFIX.length)] = all[key]
  }
  return out
}

// Append a measurement to an entry's rolling history (newest first, matching the old data shape
// so LineChart ports unchanged). Cert is "sticky": a sample without a fresh cert reading keeps
// the last known value rather than blanking the column. Each entry owns its own `result:<id>` key,
// so parallel preview iframes writing different entries can't clobber one another.
export async function pushResult (id, sample, maxSamples = DEFAULT_SETTINGS.maxSamples) {
  const key = RESULT_PREFIX + id
  const { [key]: prev0 } = await browser.storage.local.get(key)
  const prev = prev0 || { timestamp: [], elapsed: [], certExpiresInDays: [] }
  const cert = sample.certExpiresInDays ?? prev.certExpiresInDays?.[0] ?? null
  const next = {
    timestamp: [sample.timestamp, ...(prev.timestamp || [])].slice(0, maxSamples),
    elapsed: [sample.elapsed, ...(prev.elapsed || [])].slice(0, maxSamples),
    certExpiresInDays: [cert, ...(prev.certExpiresInDays || [])].slice(0, maxSamples),
    ok: sample.ok,
    error: sample.error || null,
    source: sample.source || 'fetch',
    lastTimestamp: sample.timestamp
  }
  await browser.storage.local.set({ [key]: next })
  return next
}

// One-time upgrade: fan the legacy monolithic `results` object out into per-entry `result:<id>` keys,
// then drop the old key. Idempotent — a no-op once the legacy key is gone.
export async function migrateResultsToPerKey () {
  const { [KEYS.results]: legacy } = await browser.storage.local.get(KEYS.results)
  if (!legacy || typeof legacy !== 'object') return
  const writes = {}
  for (const [id, value] of Object.entries(legacy)) writes[RESULT_PREFIX + id] = value
  if (Object.keys(writes).length) await browser.storage.local.set(writes)
  await browser.storage.local.remove(KEYS.results)
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
  const hosts = SEED_HOSTNAMES.map(makeEntry).filter(Boolean)
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
