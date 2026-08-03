import { MAX_GROUP_ITEMS } from './rss.js'

export const MAX_FEED_READ_ITEMS = 500
export const FEED_ITEM_FILTERS = ['unread', 'read', 'all']

export function feedGroupItemFilter (group) {
  return FEED_ITEM_FILTERS.includes(group?.itemFilter) ? group.itemFilter : 'unread'
}

export function nextFeedItemFilter (filter) {
  const current = FEED_ITEM_FILTERS.includes(filter) ? filter : 'unread'
  return FEED_ITEM_FILTERS[(FEED_ITEM_FILTERS.indexOf(current) + 1) % FEED_ITEM_FILTERS.length]
}

export function normalizeFeedReadItems (items, limit = MAX_FEED_READ_ITEMS) {
  const byId = new Map()
  for (const item of (Array.isArray(items) ? items : [])) {
    const id = item?.id == null ? '' : String(item.id)
    const readAt = Number(item?.readAt)
    if (!id || !Number.isFinite(readAt) || readAt < 0) continue
    const previous = byId.get(id)
    if (!previous || readAt > previous.readAt) byId.set(id, { id, readAt })
  }
  return [...byId.values()]
    .sort((a, b) => b.readAt - a.readAt)
    .slice(0, Math.max(0, Number(limit) || 0))
}

export function prepareFeedItems (items, states, filter = 'unread', limit = MAX_GROUP_ITEMS) {
  const readIdsBySource = new Map()
  let readCount = 0
  const annotated = (items || []).map(item => {
    let readIds = readIdsBySource.get(item.sourceId)
    if (!readIds) {
      readIds = new Set(normalizeFeedReadItems(states?.[item.sourceId]?.items).map(entry => entry.id))
      readIdsBySource.set(item.sourceId, readIds)
    }
    const isRead = readIds.has(String(item.id))
    if (isRead) readCount++
    return { ...item, isRead }
  })
  const counts = {
    unread: annotated.length - readCount,
    read: readCount,
    all: annotated.length
  }
  const active = FEED_ITEM_FILTERS.includes(filter) ? filter : 'unread'
  const matching = active === 'all'
    ? annotated
    : annotated.filter(item => active === 'read' ? item.isRead : !item.isRead)
  return { items: matching.slice(0, Math.max(0, Number(limit) || 0)), counts }
}
