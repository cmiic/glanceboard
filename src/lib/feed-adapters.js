import { fetchRss, parseRss, sniffRss } from './rss.js'
import { fetchAtom, parseAtom, sniffAtom } from './atom.js'
import { fetchJsonFeed, parseJsonFeed, sniffJsonFeed } from './json-feed.js'

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

export function matchingFeedAdapters (body, contentType = '') {
  return listFeedAdapters().filter(adapter => adapter.sniff?.(body, contentType))
}

registerFeedAdapter({
  type: 'rss', mediaTypes: ['application/rss+xml', 'application/rdf+xml'],
  sniff: sniffRss, parse: parseRss, refresh: fetchRss
})
registerFeedAdapter({
  type: 'atom', mediaTypes: ['application/atom+xml'],
  sniff: sniffAtom, parse: parseAtom, refresh: fetchAtom
})
registerFeedAdapter({
  type: 'jsonfeed', mediaTypes: ['application/feed+json', 'application/json'],
  sniff: sniffJsonFeed, parse: parseJsonFeed, refresh: fetchJsonFeed
})
