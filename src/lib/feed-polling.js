import { feedSourceRefresh } from './feed-settings.js'

export const AUTO_MIN_MINUTES = 60
export const AUTO_MAX_MINUTES = 24 * 60
export const AUTO_FALLBACK_MINUTES = 6 * 60

function clamp (value, min, max) {
  return Math.min(max, Math.max(min, value))
}

export function estimateFeedCadence (items, now = Date.now()) {
  const dates = [...new Set((items || [])
    .map(item => item?.publishedAt)
    .filter(value => typeof value === 'number' && Number.isFinite(value) && value <= now + 5 * 60000))]
    .sort((a, b) => b - a)
    .slice(0, 10)
  if (dates.length < 3) return AUTO_FALLBACK_MINUTES
  const gaps = []
  for (let i = 1; i < dates.length; i++) {
    const gap = (dates[i - 1] - dates[i]) / 60000
    if (gap > 0) gaps.push(gap)
  }
  if (gaps.length < 2) return AUTO_FALLBACK_MINUTES
  gaps.sort((a, b) => a - b)
  const middle = Math.floor(gaps.length / 2)
  const median = gaps.length % 2 ? gaps[middle] : (gaps[middle - 1] + gaps[middle]) / 2
  return Math.round(clamp(median, AUTO_MIN_MINUTES, AUTO_MAX_MINUTES))
}

export function feedHasNewItems (previous, next) {
  if (!previous?.items?.length) return !!next?.items?.length
  const oldIds = new Set(previous.items.map(item => String(item.id)))
  return (next?.items || []).some(item => !oldIds.has(String(item.id)))
}

function configuredBaseMinutes (source, items, now) {
  const refresh = feedSourceRefresh(source)
  if (refresh.mode === 'off') return null
  if (refresh.mode === 'fixed') return refresh.intervalMinutes
  return estimateFeedCadence(items, now)
}

export function scheduleSuccessfulFeedCache (source, previous, result, now = Date.now()) {
  const hasNew = !result.notModified && feedHasNewItems(previous, result.cache)
  const priorUnchanged = Number(previous?.schedule?.unchangedCount) || 0
  const unchangedCount = previous && !hasNew ? priorUnchanged + 1 : 0
  const cadenceMinutes = estimateFeedCadence(result.cache.items, now)
  const base = configuredBaseMinutes(source, result.cache.items, now)
  const multiplier = feedSourceRefresh(source).mode === 'auto' ? 2 ** Math.floor(unchangedCount / 3) : 1
  const interval = base == null ? null : Math.min(AUTO_MAX_MINUTES, base * multiplier)
  return {
    ...result.cache,
    schedule: {
      lastAttemptAt: now,
      nextRefreshAt: interval == null ? null : now + interval * 60000,
      cadenceMinutes,
      unchangedCount,
      failureCount: 0
    }
  }
}

export function scheduleFailedFeedCache (source, previous, error, now = Date.now()) {
  const failureCount = (Number(previous?.schedule?.failureCount) || 0) + 1
  const cadenceMinutes = Number(previous?.schedule?.cadenceMinutes) || estimateFeedCadence(previous?.items, now)
  const configured = feedSourceRefresh(source)
  const base = configured.mode === 'off'
    ? null
    : configured.mode === 'fixed' ? configured.intervalMinutes : cadenceMinutes
  const retryMinutes = base == null
    ? null
    : Math.min(AUTO_MAX_MINUTES, Math.max(base, AUTO_MIN_MINUTES * 2 ** (failureCount - 1)))
  return {
    ...(previous || { fetchedAt: null, etag: null, lastModified: null, channel: null, items: [] }),
    error: { message: error?.message || String(error), at: now },
    schedule: {
      lastAttemptAt: now,
      nextRefreshAt: retryMinutes == null ? null : now + retryMinutes * 60000,
      cadenceMinutes,
      unchangedCount: Number(previous?.schedule?.unchangedCount) || 0,
      failureCount
    }
  }
}

export function feedIsDue (source, cache, now = Date.now(), { pollingEnabled = true } = {}) {
  if (!pollingEnabled || feedSourceRefresh(source).mode === 'off') return false
  return !cache?.schedule?.nextRefreshAt || cache.schedule.nextRefreshAt <= now
}

export function nextFeedRefreshAt (sources, caches, now = Date.now()) {
  const due = (sources || [])
    .filter(source => feedSourceRefresh(source).mode !== 'off')
    .map(source => caches?.[source.id]?.schedule?.nextRefreshAt || now)
    .filter(Number.isFinite)
  return due.length ? Math.min(...due) : null
}
