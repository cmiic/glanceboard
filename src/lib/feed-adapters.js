import { fetchRss, parseRss } from './rss.js'

const adapters = new Map()

export function registerFeedAdapter (adapter) {
  if (!adapter?.type || typeof adapter.refresh !== 'function') throw new Error('Invalid feed adapter')
  adapters.set(adapter.type, Object.freeze({ ...adapter }))
}

export function getFeedAdapter (type) {
  return adapters.get(type) || null
}

export function listFeedAdapters () {
  return [...adapters.values()]
}

registerFeedAdapter({ type: 'rss', parse: parseRss, refresh: fetchRss })
