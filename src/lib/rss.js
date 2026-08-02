export const MAX_RSS_BYTES = 2 * 1024 * 1024
export const MAX_RSS_ITEMS = 50
export const MAX_GROUP_ITEMS = 30
export const MAX_RSS_DESCRIPTION_CHARS = 10000
export const MAX_FEED_BYTES = MAX_RSS_BYTES
export const MAX_FEED_ITEMS = MAX_RSS_ITEMS
export const MAX_FEED_DESCRIPTION_CHARS = MAX_RSS_DESCRIPTION_CHARS
const RDF_NAMESPACE = 'http://www.w3.org/1999/02/22-rdf-syntax-ns#'
const AUDIO_EXTENSIONS = /\.(?:mp3|m4a|aac|ogg|oga|opus|wav|flac)(?:$|[?#])/i

export function normalizeHttpUrl (value, base) {
  try {
    const input = String(value || '').trim()
    if (!input) return null
    const url = new URL(input, base)
    if ((url.protocol !== 'http:' && url.protocol !== 'https:') || !url.hostname || url.username || url.password) return null
    url.hash = ''
    return url.href
  } catch {
    return null
  }
}

export function directChildren (node, localName) {
  const wanted = String(localName).toLowerCase()
  return Array.from(node?.childNodes || []).filter(child =>
    child.nodeType === 1 && String(child.localName || child.nodeName).toLowerCase().split(':').pop() === wanted)
}

function firstChild (node, localName) {
  return directChildren(node, localName)[0] || null
}

export function childText (node, localName) {
  return firstChild(node, localName)?.textContent?.trim() || ''
}

// Namespace-agnostic matching is useful for RSS modules, but atom:link also has localName "link".
// RSS links carry their URL as text; skip href-based and empty elements so an Atom self-link cannot
// mask the later channel/item <link> element.
function childLinkText (node) {
  for (const child of directChildren(node, 'link')) {
    if (child.getAttribute?.('href')) continue
    const value = child.textContent?.trim()
    if (value) return value
  }
  return ''
}

export function safeDate (value) {
  if (!value) return null
  const timestamp = Date.parse(value)
  return Number.isFinite(timestamp) ? timestamp : null
}

export function parserFailed (document) {
  const rootName = String(document?.documentElement?.localName || document?.documentElement?.nodeName || '').toLowerCase()
  return !document?.documentElement || rootName === 'parsererror' || document.getElementsByTagName('parsererror').length > 0
}

function htmlDocument (markup, Parser) {
  const document = new Parser().parseFromString(`<body>${String(markup || '')}</body>`, 'text/html')
  for (const element of Array.from(document.querySelectorAll?.('script, style, noscript, template') || [])) element.remove()
  return document
}

export function descriptionText (markup, Parser) {
  if (!markup) return ''
  try {
    const document = htmlDocument(markup, Parser)
    return String(document.body?.textContent || document.documentElement?.textContent || '').replace(/\s+/g, ' ').trim()
  } catch {
    return String(markup).replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim()
  }
}

export function imageFromMarkup (markup, base, Parser) {
  if (!markup) return null
  try {
    const src = htmlDocument(markup, Parser).querySelector?.('img[src]')?.getAttribute('src')
    return normalizeHttpUrl(src, base)
  } catch {
    return null
  }
}

function itemImage (itemNode, descriptionMarkup, base, Parser) {
  const candidates = []
  for (const node of directChildren(itemNode, 'content')) {
    const type = String(node.getAttribute?.('type') || '').toLowerCase()
    const medium = String(node.getAttribute?.('medium') || '').toLowerCase()
    if (medium === 'image' || type.startsWith('image/')) candidates.push(node.getAttribute?.('url'))
  }
  for (const node of directChildren(itemNode, 'thumbnail')) candidates.push(node.getAttribute?.('url'))
  for (const node of directChildren(itemNode, 'enclosure')) {
    if (String(node.getAttribute?.('type') || '').toLowerCase().startsWith('image/')) candidates.push(node.getAttribute?.('url'))
  }
  for (const node of directChildren(itemNode, 'image')) {
    candidates.push(node.getAttribute?.('href'), node.getAttribute?.('url'), node.textContent)
  }
  for (const value of candidates) {
    const normalized = normalizeHttpUrl(value, base)
    if (normalized) return normalized
  }
  return imageFromMarkup(descriptionMarkup, base, Parser)
}

export function parseDurationSeconds (value) {
  const text = String(value ?? '').trim()
  if (!text) return null
  if (/^\d+(?:\.\d+)?$/.test(text)) {
    const seconds = Number(text)
    return Number.isFinite(seconds) && seconds >= 0 ? seconds : null
  }
  const parts = text.split(':')
  if (parts.length < 2 || parts.length > 3 || parts.some(part => !/^\d+(?:\.\d+)?$/.test(part))) return null
  const values = parts.map(Number)
  const seconds = parts.length === 3
    ? values[0] * 3600 + values[1] * 60 + values[2]
    : values[0] * 60 + values[1]
  return Number.isFinite(seconds) ? seconds : null
}

export function normalizeAudio (value, base) {
  const url = normalizeHttpUrl(value?.url, base)
  const mimeType = String(value?.mimeType || '').trim().toLowerCase() || null
  if (!url || (!mimeType?.startsWith('audio/') && !AUDIO_EXTENSIONS.test(url))) return null
  const hasByteLength = value?.byteLength != null && value.byteLength !== ''
  const hasDuration = value?.durationSeconds != null && value.durationSeconds !== ''
  const byteLength = hasByteLength ? Number(value.byteLength) : NaN
  const durationSeconds = hasDuration ? Number(value.durationSeconds) : NaN
  return {
    url,
    mimeType,
    byteLength: Number.isFinite(byteLength) && byteLength >= 0 ? byteLength : null,
    durationSeconds: Number.isFinite(durationSeconds) && durationSeconds >= 0 ? durationSeconds : null
  }
}

function itemAudio (itemNode, base) {
  const durationSeconds = parseDurationSeconds(childText(itemNode, 'duration'))
  for (const node of directChildren(itemNode, 'enclosure')) {
    const audio = normalizeAudio({
      url: node.getAttribute?.('url'),
      mimeType: node.getAttribute?.('type'),
      byteLength: node.getAttribute?.('length'),
      durationSeconds
    }, base)
    if (audio) return audio
  }
  return null
}

export function truncateFeedDescription (value, maxChars) {
  const text = String(value || '')
  const limit = Math.max(0, Math.floor(Number(maxChars) || 0))
  if (!limit) return text
  const characters = Array.from(text)
  return characters.length > limit ? `${characters.slice(0, limit).join('').trimEnd()}…` : text
}

// A DOCTYPE is legal only in the XML prolog, after the optional declaration, comments and
// processing instructions. Inspect that prefix without parsing so external/internal DTDs are
// rejected before DOMParser sees them, while literal "<!DOCTYPE" text inside CDATA remains valid.
export function hasPrologDoctype (xml) {
  let remaining = xml.trimStart()
  if (/^<\?xml(?:\s|\?>)/i.test(remaining)) {
    const end = remaining.indexOf('?>')
    if (end < 0) return false
    remaining = remaining.slice(end + 2).trimStart()
  }
  while (remaining.startsWith('<!--') || remaining.startsWith('<?')) {
    const closing = remaining.startsWith('<!--') ? '-->' : '?>'
    const end = remaining.indexOf(closing)
    if (end < 0) return false
    remaining = remaining.slice(end + closing.length).trimStart()
  }
  return /^<!DOCTYPE(?:\s|>)/i.test(remaining)
}

export function parseRss (xml, { url, Parser = globalThis.DOMParser } = {}) {
  if (typeof xml !== 'string' || !xml.trim()) throw new Error('Empty RSS response')
  if (hasPrologDoctype(xml)) throw new Error('RSS documents with a DOCTYPE are not supported')
  if (typeof Parser !== 'function') throw new Error('DOMParser is unavailable')

  const document = new Parser().parseFromString(xml, 'application/xml')
  if (parserFailed(document)) throw new Error('Malformed RSS XML')
  const root = document.documentElement
  const rootName = String(root.localName || root.nodeName).toLowerCase().split(':').pop()
  const isRss2 = rootName === 'rss'
  const isRss1 = rootName === 'rdf' && (
    root.namespaceURI === RDF_NAMESPACE ||
    root.getAttribute?.('xmlns:rdf') === RDF_NAMESPACE
  )
  if (!isRss1 && !isRss2) throw new Error('Only RSS feeds are supported')
  if (isRss2 && !/^2(?:\.|$)/.test(String(root.getAttribute?.('version') || ''))) {
    throw new Error('Only RSS 1.0 and 2.0 feeds are supported')
  }
  const channelNode = firstChild(root, 'channel')
  if (!channelNode) throw new Error('RSS channel is missing')

  const channelTitle = childText(channelNode, 'title') || new URL(url).hostname
  const channelLink = normalizeHttpUrl(childLinkText(channelNode), url)
  const seen = new Set()
  const items = []

  const itemNodes = isRss1 ? directChildren(root, 'item') : directChildren(channelNode, 'item')
  for (const itemNode of itemNodes) {
    const title = childText(itemNode, 'title') || 'Untitled'
    const guidNode = firstChild(itemNode, 'guid')
    const rdfAbout = itemNode.getAttribute?.('rdf:about') || itemNode.getAttributeNS?.(RDF_NAMESPACE, 'about') || ''
    const guid = guidNode?.textContent?.trim() || rdfAbout
    let link = normalizeHttpUrl(childLinkText(itemNode), url)
    if (!link && guid && guidNode?.getAttribute?.('isPermaLink') !== 'false') link = normalizeHttpUrl(guid, url)
    const publishedAt = safeDate(childText(itemNode, 'pubDate') || childText(itemNode, 'date'))
    const descriptionMarkup = childText(itemNode, 'description') || childText(itemNode, 'encoded')
    const description = Array.from(descriptionText(descriptionMarkup, Parser))
      .slice(0, MAX_RSS_DESCRIPTION_CHARS).join('')
    const imageUrl = itemImage(itemNode, descriptionMarkup, url, Parser)
    const audio = itemAudio(itemNode, url)
    const id = guid || link || `${publishedAt ?? ''}:${title}`
    if (seen.has(id)) continue
    seen.add(id)
    items.push({ id, title, url: link, publishedAt, description, imageUrl, audio })
    if (items.length >= MAX_RSS_ITEMS) break
  }

  return { channel: { title: channelTitle, url: channelLink }, items }
}

export function sniffRss (body, contentType = '') {
  if (/application\/(?:rss|rdf)\+xml/i.test(contentType)) return true
  return /^\s*(?:<\?xml[^>]*>\s*)?(?:<!--[^]*?-->\s*)?<(?:rss\b|(?:[\w-]+:)?RDF\b)/i.test(String(body || ''))
}

function decodeXml (buffer, contentType = '') {
  const headerEncoding = /charset\s*=\s*["']?([^;\s"']+)/i.exec(contentType)?.[1]
  const prefix = new TextDecoder('ascii').decode(buffer.slice(0, 256))
  const declarationEncoding = /<\?xml[^>]*encoding\s*=\s*["']([^"']+)/i.exec(prefix)?.[1]
  try {
    return new TextDecoder(headerEncoding || declarationEncoding || 'utf-8').decode(buffer)
  } catch {
    return new TextDecoder('utf-8').decode(buffer)
  }
}

async function readBoundedBytes (response, maxBytes) {
  const declared = response.headers.get('content-length')
  const length = declared == null ? null : Number(declared)
  if (Number.isFinite(length) && length > maxBytes) {
    try { await response.body?.cancel?.() } catch { /* Best-effort network cancellation. */ }
    throw new Error('Response is larger than 2 MB')
  }

  const reader = response.body?.getReader?.()
  if (!reader) {
    const buffer = await response.arrayBuffer()
    if (buffer.byteLength > maxBytes) throw new Error('Response is larger than 2 MB')
    return new Uint8Array(buffer)
  }

  const chunks = []
  let total = 0
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      total += value.byteLength
      if (total > maxBytes) {
        await reader.cancel().catch(() => {})
        throw new Error('Response is larger than 2 MB')
      }
      chunks.push(value)
    }
  } finally {
    reader.releaseLock()
  }

  const bytes = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) {
    bytes.set(chunk, offset)
    offset += chunk.byteLength
  }
  return bytes
}

export async function readBoundedResponseText (response, { maxBytes = MAX_RSS_BYTES } = {}) {
  const bytes = await readBoundedBytes(response, maxBytes)
  return decodeXml(bytes, response.headers.get('content-type') || '')
}

export async function fetchRss (url, {
  previous = null,
  fetchImpl = globalThis.fetch,
  Parser = globalThis.DOMParser,
  timeoutMs = 15000,
  maxBytes = MAX_RSS_BYTES,
  now = () => Date.now()
} = {}) {
  const requestedUrl = normalizeHttpUrl(url)
  if (!requestedUrl) throw new Error('Invalid RSS URL')
  const headers = { Accept: 'application/rss+xml, application/rdf+xml;q=0.95, application/xml;q=0.9, text/xml;q=0.8' }
  if (previous?.etag) headers['If-None-Match'] = previous.etag
  if (previous?.lastModified) headers['If-Modified-Since'] = previous.lastModified

  const response = await fetchImpl(requestedUrl, {
    method: 'GET', redirect: 'follow', cache: 'no-store', credentials: 'omit', headers,
    signal: AbortSignal.timeout(timeoutMs)
  })
  if (response.status === 304 && previous) {
    return { url: requestedUrl, notModified: true, cache: { ...previous, fetchedAt: now(), error: null } }
  }
  if (!response.ok) throw new Error(`RSS request failed (${response.status})`)
  const finalUrl = normalizeHttpUrl(response.url || requestedUrl)
  if (!finalUrl) throw new Error('RSS redirected to an unsupported URL')
  const parsed = parseRss(await readBoundedResponseText(response, { maxBytes }), { url: finalUrl, Parser })
  return {
    url: finalUrl,
    notModified: false,
    cache: {
      fetchedAt: now(),
      etag: response.headers.get('etag') || null,
      lastModified: response.headers.get('last-modified') || null,
      channel: parsed.channel,
      items: parsed.items,
      error: null
    }
  }
}

export function cacheWithError (previous, error, now = Date.now()) {
  return {
    ...(previous || { channel: null, items: [] }),
    error: { message: error?.message || String(error), at: now }
  }
}

export function mergeFeedItems (sources, caches, limit = MAX_GROUP_ITEMS) {
  const merged = []
  for (const [sourceOrder, source] of (sources || []).entries()) {
    const cache = caches?.[source.id]
    const sourceTitle = cache?.channel?.title || source.title || source.url
    for (const [itemOrder, item] of (cache?.items || []).entries()) {
      merged.push({ ...item, sourceId: source.id, sourceTitle, sourceOrder, itemOrder })
    }
  }
  merged.sort((a, b) => {
    const aDated = typeof a.publishedAt === 'number'
    const bDated = typeof b.publishedAt === 'number'
    if (aDated && bDated && a.publishedAt !== b.publishedAt) return b.publishedAt - a.publishedAt
    if (aDated !== bDated) return aDated ? -1 : 1
    return (a.sourceOrder - b.sourceOrder) || (a.itemOrder - b.itemOrder)
  })
  return merged.slice(0, limit)
}
