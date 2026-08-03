import { browser } from './browser.js'
import { getFeedAdapter } from './feed-adapters.js'
import { feedIsDue, scheduleFailedFeedCache, scheduleSuccessfulFeedCache } from './feed-polling.js'
import {
  getFeedCaches, getFeedSources, setFeedCachesForExistingSources
} from './storage.js'
import { normalizeTarget } from './url.js'

async function hasSourcePermission (source) {
  const target = normalizeTarget(source.url)
  if (!target) return false
  if (!browser.permissions?.contains) return true
  return browser.permissions.contains({ origins: [target.originPattern] })
}

export async function refreshFeedSources (sourceIds = null, {
  force = false, pollingEnabled = true, now = () => Date.now()
} = {}) {
  const sources = await getFeedSources()
  const requested = sourceIds == null ? null : new Set(sourceIds)
  const candidates = sources.filter(source => !requested || requested.has(source.id))
  const caches = await getFeedCaches(candidates.map(source => source.id))
  const selected = candidates.filter(source =>
    force || feedIsDue(source, caches[source.id], now(), { pollingEnabled }))
  const updates = {}
  const failures = []
  for (const source of selected) {
    const previous = caches[source.id] || null
    try {
      if (!(await hasSourcePermission(source))) throw new Error('Feed access permission is missing; grant access in Feeds')
      const adapter = getFeedAdapter(source.type)
      if (!adapter) throw new Error(`Unsupported feed type: ${source.type}`)
      const result = await adapter.refresh(source.url, { previous })
      updates[source.id] = scheduleSuccessfulFeedCache(source, previous, result, now())
    } catch (error) {
      updates[source.id] = scheduleFailedFeedCache(source, previous, error, now())
      failures.push({ sourceId: source.id, message: error?.message || String(error) })
    }
  }
  const written = await setFeedCachesForExistingSources(updates)
  return { refreshed: Object.keys(written), failures }
}
