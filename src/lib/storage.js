import { browser } from './browser.js'
import { normalizeTarget } from './url.js'
import { normalizeAudio, normalizeHttpUrl } from './rss.js'
import { feedGroupNameKey, feedSourceDisplay, feedSourceRefresh } from './feed-settings.js'

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
//   settings:   { intervalMinutes, previewIntervalMinutes, feedPollingEnabled, mode, notificationsEnabled, maxSamples, cardMinWidth, metricDefaults }
//   feedSources:[{ id, type, url, discoveredFrom, title, groupId, addedAt,
//                  display:{showImage,showDescription,descriptionMaxChars}, refresh:{mode,intervalMinutes} }]
//   feedGroups: [{ id, name, addedAt, layout:{x,y,w,h} }]
//   feed-cache:<id>: { fetchedAt, etag, lastModified, channel, items, error }
//   readLater:  compact feed-item snapshots (max 500)
//   podcastProgress: { [audio URL]: { positionSeconds, durationSeconds, updatedAt } }
//   seeded:     true once the (currently empty) default host list has been written
const KEYS = {
  hosts: 'hosts', results: 'results', settings: 'settings', seeded: 'seeded',
  feedSources: 'feedSources', feedGroups: 'feedGroups', readLater: 'readLater', podcastProgress: 'podcastProgress'
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
  feedPollingEnabled: false,
  mode: 'auto', // 'auto' | 'desktop' | 'mobile'
  notificationsEnabled: false,
  maxSamples: 60,
  cardMinWidth: 320, // px — min preview-tile width for the responsive desktop grid
  metricDefaults: { cert: false, load: false } // default visibility of the cert/load tiles for new hosts
}

export const MAX_READ_LATER_ITEMS = 500
export const MAX_READ_LATER_DESCRIPTION_CHARS = 2000
export const MAX_PODCAST_PROGRESS_ITEMS = 100

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

export async function getFeedCaches (sourceIds) {
  const ids = [...new Set((sourceIds || []).filter(id => typeof id === 'string' && id))]
  if (!ids.length) return {}
  const keys = ids.map(id => FEED_CACHE_PREFIX + id)
  const stored = await browser.storage.local.get(keys)
  return Object.fromEntries(ids.flatMap(id => {
    const cache = stored?.[FEED_CACHE_PREFIX + id]
    return cache == null ? [] : [[id, cache]]
  }))
}

export async function getAllFeedCaches () {
  const sources = await getFeedSources()
  return getFeedCaches(sources.map(source => source.id))
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

// A feed can be removed while its in-flight refresh is still finishing. Filter immediately before
// the write, then check again afterward to cover either ordering of the storage operations. The
// normal removal path also deletes its cache, so no interleaving can leave an orphan behind.
export async function setFeedCachesForExistingSources (cachesBySourceId) {
  const requested = cachesBySourceId || {}
  const existingBefore = new Set((await getFeedSources()).map(source => source.id))
  const current = Object.fromEntries(Object.entries(requested).filter(([id]) => existingBefore.has(id)))
  const written = await setFeedCaches(current)
  if (!Object.keys(written).length) return written

  const existingAfter = new Set((await getFeedSources()).map(source => source.id))
  const orphaned = Object.keys(written).filter(id => !existingAfter.has(id))
  if (orphaned.length) {
    await browser.storage.local.remove(orphaned.map(id => FEED_CACHE_PREFIX + id))
    for (const id of orphaned) delete written[id]
  }
  return written
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

// Discovery grants are normally cleaned up by the add form. If its tab is closed mid-flow there is
// no reliable unload hook, so background startup reconciles every exact HTTP(S) origin permission
// against persisted sites and feeds. Broad wildcard permissions are deliberately left untouched.
export async function reconcileOriginPermissions () {
  if (!browser.permissions?.getAll || !browser.permissions?.remove) return []
  const [hosts, sources, permissions] = await Promise.all([
    getHosts(), getFeedSources(), browser.permissions.getAll()
  ])
  const required = requiredOriginPatterns(hosts, sources)
  const orphaned = (permissions?.origins || []).filter(pattern =>
    /^https?:\/\/[^*/]+\/\*$/i.test(pattern) && !required.has(pattern))
  if (!orphaned.length) return []
  try {
    return await browser.permissions.remove({ origins: orphaned }) ? orphaned : []
  } catch {
    return []
  }
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
  const key = feedGroupNameKey(name)
  return groups.some(group => group.id !== exceptId && feedGroupNameKey(group.name) === key)
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
  if (groupId && !group) throw new Error('Feed group not found')
  if (!group) {
    const clean = cleanGroupName(groupName)
    if (groupNameExists(groups, clean)) throw new Error('A feed group with this name already exists')
    group = { id: newGroupId(), name: clean, addedAt: Date.now() }
    nextGroups = [...groups, group]
  }

  const existingUrls = new Set(sources.map(source => normalizeHttpUrl(source.url)).filter(Boolean))
  const now = Date.now()
  const added = []
  const writes = {}
  for (const item of (items || [])) {
    const normalized = normalizeHttpUrl(item.url)
    if (!normalized) throw new Error('Invalid feed URL')
    const type = String(item.type || 'rss')
    const id = `${type}:${normalized}`
    if (existingUrls.has(normalized)) continue
    existingUrls.add(normalized)
    added.push({
      id, type, url: normalized, discoveredFrom: item.discoveredFrom || null,
      title: String(item.title || '').trim() || new URL(normalized).hostname,
      groupId: group.id, addedAt: now, display: feedSourceDisplay(item), refresh: feedSourceRefresh(item)
    })
    if (item.cache) writes[FEED_CACHE_PREFIX + id] = plainStorageValue(item.cache)
  }
  if (!added.length && !groupId) throw new Error('This feed is already added')
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

// Commit the user's Site / Feed / Both choice in one storage write after every permission and feed
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
      // A feed-only duplicate remains an actionable error instead of creating an empty group.
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
  if (!sources.some(source => source.id === id)) throw new Error('Feed source not found')
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

export async function setFeedSourceRefresh (id, patch) {
  const sources = await getFeedSources()
  if (!sources.some(source => source.id === id)) throw new Error('Feed source not found')
  const next = sources.map(source => source.id === id
    ? { ...source, refresh: feedSourceRefresh({ refresh: { ...feedSourceRefresh(source), ...(patch || {}) } }) }
    : source)
  const source = next.find(item => item.id === id)
  const key = FEED_CACHE_PREFIX + id
  const { [key]: cache } = await browser.storage.local.get(key)
  const writes = { [KEYS.feedSources]: next }
  if (cache) {
    writes[key] = {
      ...cache,
      schedule: {
        ...(cache.schedule || {}),
        nextRefreshAt: source.refresh.mode === 'off' ? null : Date.now()
      }
    }
  }
  await browser.storage.local.set(writes)
  return next
}

export function readLaterId (source, item) {
  return `read-later:${source.id}\u001f${String(item.id)}`
}

function compactReadLaterItem (source, item, savedAt = Date.now()) {
  const url = normalizeHttpUrl(item.url)
  const audio = normalizeAudio(item.audio)
  if (!url && !audio) throw new Error('This item has no safe link or audio URL')
  return {
    id: readLaterId(source, item),
    sourceId: String(source.id),
    source: {
      id: String(source.id), type: String(source.type || 'rss'),
      url: normalizeHttpUrl(source.url), title: String(item.sourceTitle || source.title || source.url || '').trim()
    },
    itemId: String(item.id), title: String(item.title || 'Untitled').trim() || 'Untitled',
    url, publishedAt: typeof item.publishedAt === 'number' ? item.publishedAt : null,
    savedAt: Number(savedAt) || Date.now(), imageUrl: normalizeHttpUrl(item.imageUrl),
    description: Array.from(String(item.description || '')).slice(0, MAX_READ_LATER_DESCRIPTION_CHARS).join(''),
    audio
  }
}

export async function getReadLater () {
  const { [KEYS.readLater]: items } = await browser.storage.local.get(KEYS.readLater)
  return Array.isArray(items) ? items : []
}

export async function saveReadLater (source, item) {
  const items = await getReadLater()
  const snapshot = compactReadLaterItem(source, item)
  if (items.some(existing => existing.id === snapshot.id)) return items
  if (items.length >= MAX_READ_LATER_ITEMS) throw new Error(`Read Later is limited to ${MAX_READ_LATER_ITEMS} items`)
  const next = [snapshot, ...items]
  await browser.storage.local.set({ [KEYS.readLater]: next })
  return next
}

export async function removeReadLater (id) {
  const items = await getReadLater()
  const next = items.filter(item => item.id !== id)
  await browser.storage.local.set({ [KEYS.readLater]: next })
  return next
}

export async function clearReadLater () {
  await browser.storage.local.set({ [KEYS.readLater]: [] })
  return []
}

function mergedReadLaterItems (current, imported) {
  const byId = new Map(current.map(item => [item.id, item]))
  for (const raw of imported || []) {
    const source = raw?.source || { id: raw?.sourceId, type: raw?.sourceType, url: raw?.sourceUrl, title: raw?.sourceTitle }
    if (!source?.id || raw?.itemId == null) continue
    try {
      const item = compactReadLaterItem(source, { ...raw, id: raw.itemId }, raw.savedAt)
      if (!byId.has(item.id)) byId.set(item.id, item)
    } catch { /* Skip invalid imported snapshots. */ }
  }
  if (byId.size > MAX_READ_LATER_ITEMS) throw new Error(`Import would exceed the ${MAX_READ_LATER_ITEMS}-item Read Later limit`)
  return [...byId.values()].sort((a, b) => b.savedAt - a.savedAt)
}

export async function previewReadLaterMerge (imported) {
  return mergedReadLaterItems(await getReadLater(), imported)
}

export async function mergeReadLater (imported) {
  const next = await previewReadLaterMerge(imported)
  await browser.storage.local.set({ [KEYS.readLater]: next })
  return next
}

export async function getPodcastProgress () {
  const { [KEYS.podcastProgress]: progress } = await browser.storage.local.get(KEYS.podcastProgress)
  return progress && typeof progress === 'object' && !Array.isArray(progress) ? progress : {}
}

export async function setPodcastProgress (audioUrl, positionSeconds, durationSeconds, updatedAt = Date.now()) {
  const url = normalizeHttpUrl(audioUrl)
  if (!url) return getPodcastProgress()
  const current = await getPodcastProgress()
  const rawPosition = Number(positionSeconds)
  const rawDuration = Number(durationSeconds)
  const position = Number.isFinite(rawPosition) ? Math.max(0, rawPosition) : 0
  const duration = Number.isFinite(rawDuration) && rawDuration > 0 ? rawDuration : null
  const complete = duration != null &&
    (position / duration >= 0.95 || (duration > 30 && duration - position < 30))
  if (complete || position < 1) delete current[url]
  else current[url] = { positionSeconds: position, durationSeconds: duration, updatedAt }
  const kept = Object.entries(current)
    .sort((a, b) => (b[1]?.updatedAt || 0) - (a[1]?.updatedAt || 0))
    .slice(0, MAX_PODCAST_PROGRESS_ITEMS)
  const next = Object.fromEntries(kept)
  await browser.storage.local.set({ [KEYS.podcastProgress]: next })
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
