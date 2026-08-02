import { normalizeHttpUrl, readBoundedResponseText } from './rss.js'
import { getFeedAdapter, matchingFeedAdapters } from './feed-adapters.js'

export const COMMON_FEED_PATHS = [
  '/feed/', '/feed', '/rss.xml', '/rss', '/feed.xml', '/atom.xml', '/feed.atom', '/feed.json'
]
export const COMMON_RSS_PATHS = COMMON_FEED_PATHS
const discoveryStrategies = []
const TYPE_BY_MEDIA = new Map([
  ['application/rss+xml', 'rss'],
  ['application/rdf+xml', 'rss'],
  ['application/atom+xml', 'atom'],
  ['application/feed+json', 'jsonfeed'],
  ['application/json', 'jsonfeed']
])

export function registerDiscoveryStrategy (strategy) {
  if (!strategy?.id || typeof strategy.discover !== 'function') throw new Error('Invalid discovery strategy')
  const existing = discoveryStrategies.findIndex(item => item.id === strategy.id)
  if (existing >= 0) discoveryStrategies.splice(existing, 1, strategy)
  else discoveryStrategies.push(strategy)
}

export function listDiscoveryStrategies () {
  return discoveryStrategies.slice()
}

function candidate (url, title = '', type = 'rss') {
  const normalized = normalizeHttpUrl(url)
  return normalized ? { type, url: normalized, title: String(title || '').trim() } : null
}

export function dedupeCandidates (candidates) {
  const seen = new Set()
  return (candidates || []).filter(item => {
    if (!item?.url || seen.has(item.url)) return false
    seen.add(item.url)
    return true
  })
}

function splitLinkHeader (value) {
  const parts = []
  let start = 0
  let quoted = false
  let angled = false
  for (let i = 0; i < String(value || '').length; i++) {
    const char = value[i]
    if (char === '"') quoted = !quoted
    else if (!quoted && char === '<') angled = true
    else if (!quoted && char === '>') angled = false
    else if (!quoted && !angled && char === ',') { parts.push(value.slice(start, i)); start = i + 1 }
  }
  parts.push(String(value || '').slice(start))
  return parts
}

export function discoverFromLinkHeader (value, pageUrl) {
  const found = []
  for (const part of splitLinkHeader(value)) {
    const href = /<([^>]+)>/.exec(part)?.[1]
    const rel = /;\s*rel\s*=\s*["']?([^;"']+)/i.exec(part)?.[1] || ''
    const mediaType = (/;\s*type\s*=\s*["']?([^;"']+)/i.exec(part)?.[1] || '').toLowerCase()
    const type = TYPE_BY_MEDIA.get(mediaType)
    if (!href || !type || !rel.toLowerCase().split(/\s+/).includes('alternate')) continue
    const item = candidate(normalizeHttpUrl(href, pageUrl), '', type)
    if (item) found.push(item)
  }
  return dedupeCandidates(found)
}

export function discoverFromHtml (html, pageUrl, Parser = globalThis.DOMParser) {
  if (typeof Parser !== 'function') throw new Error('DOMParser is unavailable')
  const document = new Parser().parseFromString(String(html || ''), 'text/html')
  const found = []
  for (const link of Array.from(document.querySelectorAll('link[rel][href]'))) {
    const rels = String(link.getAttribute('rel') || '').toLowerCase().split(/\s+/)
    const mediaType = String(link.getAttribute('type') || '').toLowerCase().split(';')[0].trim()
    const type = TYPE_BY_MEDIA.get(mediaType)
    if (!rels.includes('alternate') || rels.includes('stylesheet') || !type) continue
    const url = normalizeHttpUrl(link.getAttribute('href'), pageUrl)
    const item = candidate(url, link.getAttribute('title'), type)
    if (item) found.push(item)
  }
  return dedupeCandidates(found)
}

export function orfDiscoveryRequest (pageUrl) {
  try {
    const url = new URL(pageUrl)
    const match = /^\/podcast\/([^/]+)\/([^/?#]+)\/?$/.exec(url.pathname)
    if (url.hostname !== 'sound.orf.at' || !match) return null
    return {
      apiUrl: `https://audioapi.orf.at/radiothek/api/2.0/podcast/${encodeURIComponent(match[1])}/${encodeURIComponent(match[2])}`,
      permission: 'https://audioapi.orf.at/*'
    }
  } catch {
    return null
  }
}

export function discoveryPermissionPatterns (pageUrl) {
  return [...new Set(discoveryStrategies.flatMap(strategy => strategy.permissionPatterns?.(pageUrl) || []))]
}

export async function discoverFromOrf (pageUrl, fetchImpl = globalThis.fetch) {
  const request = orfDiscoveryRequest(pageUrl)
  if (!request) return []
  const response = await fetchImpl(request.apiUrl, { credentials: 'omit', cache: 'no-store', signal: AbortSignal.timeout(15000) })
  if (!response.ok) return []
  const payload = (await response.json())?.payload
  const item = candidate(payload?.urls?.feed, payload?.title)
  return item ? [item] : []
}

registerDiscoveryStrategy({
  id: 'orf-podcast',
  permissionPatterns: pageUrl => {
    const request = orfDiscoveryRequest(pageUrl)
    return request ? [request.permission] : []
  },
  discover: (pageUrl, { fetchImpl }) => discoverFromOrf(pageUrl, fetchImpl)
})

function redirectFilterPattern (url) {
  try {
    const parsed = new URL(url)
    return `${parsed.protocol}//${parsed.hostname}/*`
  } catch {
    return null
  }
}

async function fetchForInspection (pageUrl, { fetchImpl, webRequest }) {
  const requestedUrl = normalizeHttpUrl(pageUrl)
  const redirectEvent = webRequest?.onBeforeRedirect
  const filterPattern = redirectFilterPattern(pageUrl)
  let observedRedirect = null
  let listening = false
  const listener = details => {
    if (details?.type && details.type !== 'xmlhttprequest') return
    if (normalizeHttpUrl(details?.url) !== requestedUrl) return
    observedRedirect ||= normalizeHttpUrl(details.redirectUrl, requestedUrl)
  }

  if (redirectEvent?.addListener && filterPattern) {
    try {
      redirectEvent.addListener(listener, { urls: [filterPattern] })
      listening = true
    } catch { /* Synthetic fetches and restricted environments may not expose webRequest. */ }
  }
  try {
    const response = await fetchImpl(pageUrl, {
      method: 'GET', redirect: 'manual', cache: 'no-store', credentials: 'omit',
      signal: AbortSignal.timeout(15000)
    })
    return { response, observedRedirect }
  } finally {
    if (listening) redirectEvent.removeListener(listener)
  }
}

function cacheFromParsedResponse (parsed, response, now = Date.now()) {
  return {
    fetchedAt: now,
    etag: response.headers.get('etag') || null,
    lastModified: response.headers.get('last-modified') || null,
    channel: parsed.channel,
    items: parsed.items,
    error: null
  }
}

function parseDetectedFeed (body, contentType, url, response, Parser) {
  const matching = matchingFeedAdapters(body, contentType)
  let firstError = null
  for (const adapter of matching) {
    try {
      const parsed = adapter.parse(body, { url, Parser })
      return { type: adapter.type, url, cache: cacheFromParsedResponse(parsed, response) }
    } catch (error) {
      firstError ||= error
    }
  }
  if (firstError) throw firstError
  return null
}

async function inspectFeedResponse (response, requestedUrl, Parser) {
  if (!response.ok) throw new Error(`Feed request failed (${response.status})`)
  const url = normalizeHttpUrl(response.url || requestedUrl)
  if (!url) throw new Error('Feed redirected to an unsupported URL')
  const contentType = response.headers.get('content-type') || ''
  const body = await readBoundedResponseText(response)
  return { body, contentType, result: parseDetectedFeed(body, contentType, url, response, Parser) }
}

async function probeFeed (url, { fetchImpl, Parser, timeoutMs = 5000 }) {
  const response = await fetchImpl(url, {
    method: 'GET', redirect: 'follow', cache: 'no-store', credentials: 'omit',
    headers: { Accept: 'application/rss+xml, application/atom+xml, application/feed+json, application/json;q=0.9, application/xml;q=0.8' },
    signal: AbortSignal.timeout(timeoutMs)
  })
  return (await inspectFeedResponse(response, url, Parser)).result
}

export async function inspectTarget (pageUrl, {
  fetchImpl = globalThis.fetch,
  Parser = globalThis.DOMParser,
  canFetch = async () => true,
  includeOrf = true,
  webRequest = globalThis.browser?.webRequest
} = {}) {
  const { response, observedRedirect } = await fetchForInspection(pageUrl, { fetchImpl, webRequest })
  const headerRedirect = response.status >= 300 && response.status < 400
    ? normalizeHttpUrl(response.headers.get('location'), pageUrl)
    : null
  const redirectUrl = observedRedirect || headerRedirect
  if (redirectUrl) return { kind: 'redirect', url: redirectUrl }
  if (response.type === 'opaqueredirect' || response.status === 0) {
    throw new Error('The redirect target could not be determined')
  }
  if (!response.ok) throw new Error(`Site request failed (${response.status})`)

  const finalPageUrl = response.url || pageUrl
  const contentType = response.headers.get('content-type') || ''
  const body = await readBoundedResponseText(response)
  let directError
  try {
    const direct = parseDetectedFeed(body, contentType, finalPageUrl, response, Parser)
    if (direct) return {
      kind: 'feed', pageUrl: finalPageUrl,
      candidates: [{ type: direct.type, url: direct.url, title: direct.cache.channel.title, validated: direct.cache }]
    }
  } catch (error) {
    directError = error
  }
  // A response explicitly declaring a feed media type must not silently become a website tile when
  // malformed. Generic XML/JSON is treated as a feed only after a successful content validation.
  const looksLikeFeed = matchingFeedAdapters(body, '').length > 0
  if (/application\/(?:rss|rdf|atom)\+xml|application\/feed\+json/i.test(contentType) || looksLikeFeed) throw directError

  let found = [
    ...discoverFromLinkHeader(response.headers.get('link'), finalPageUrl),
    ...(contentType.includes('html') ? discoverFromHtml(body, finalPageUrl, Parser) : [])
  ]
  for (const strategy of discoveryStrategies) {
    if (!includeOrf && strategy.id === 'orf-podcast') continue
    found.push(...await strategy.discover(finalPageUrl, { fetchImpl, Parser }).catch(() => []))
  }
  found = dedupeCandidates(found)

  const validated = []
  for (const item of found) {
    if (!(await canFetch(item.url))) { validated.push(item); continue }
    try {
      const result = await getFeedAdapter(item.type)?.refresh(item.url, { fetchImpl, Parser })
      if (!result) continue
      validated.push({ ...item, url: result.url, title: result.cache.channel.title || item.title, validated: result.cache })
    } catch { /* An advertised URL is only offered when it validates as its declared feed type. */ }
  }
  if (!validated.length) {
    const base = new URL(finalPageUrl).origin
    for (const path of COMMON_FEED_PATHS) {
      const url = base + path
      if (!(await canFetch(url))) continue
      try {
        const result = await probeFeed(url, { fetchImpl, Parser })
        if (!result) continue
        validated.push({ type: result.type, url: result.url, title: result.cache.channel.title, validated: result.cache })
        break
      } catch { /* Try the next conventional path. */ }
    }
  }
  return { kind: 'page', pageUrl: finalPageUrl, candidates: dedupeCandidates(validated) }
}

export function defaultCandidateIds (candidates) {
  const main = (candidates || []).find(item => !/comments?|kommentar/i.test(`${item.title} ${item.url}`)) || candidates?.[0]
  return main ? [main.url] : []
}
