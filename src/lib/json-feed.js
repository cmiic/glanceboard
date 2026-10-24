import {
  MAX_FEED_BYTES, MAX_FEED_DESCRIPTION_CHARS,
  collectFeedItems, descriptionText, normalizeAudio, normalizeHttpUrl, readBoundedResponseText, safeDate
} from './rss.js'

const SUPPORTED_VERSIONS = new Set([
  'https://jsonfeed.org/version/1',
  'https://jsonfeed.org/version/1.1'
])

function parseJsonFeedDocument (text) {
  if (typeof text !== 'string' || !text.trim()) throw new Error('Empty JSON Feed response')
  let document
  try { document = JSON.parse(text) } catch { throw new Error('Malformed JSON Feed') }
  if (!document || typeof document !== 'object' || !SUPPORTED_VERSIONS.has(document.version) || !Array.isArray(document.items)) {
    throw new Error('Not a supported JSON Feed')
  }
  return document
}

// summary and content_text are plain text; only content_html needs its markup removed.
function jsonFeedDescription (item, Parser) {
  const content = item.summary ?? item.content_text ?? item.content_html ?? ''
  const isPlainText = item.summary != null || item.content_text != null
  const value = isPlainText ? String(content).replace(/\s+/g, ' ').trim() : descriptionText(content, Parser)
  return Array.from(value).slice(0, MAX_FEED_DESCRIPTION_CHARS).join('')
}

// The first attachment that is playable audio.
function attachmentAudio (attachments, url) {
  for (const attachment of (Array.isArray(attachments) ? attachments : [])) {
    const audio = normalizeAudio({
      url: attachment?.url,
      mimeType: attachment?.mime_type,
      byteLength: attachment?.size_in_bytes,
      durationSeconds: attachment?.duration_in_seconds
    }, url)
    if (audio) return audio
  }
  return null
}

// Null for an entry that is not an object, or that has neither an id nor a usable link to stand in.
function parseJsonFeedItem (item, url, Parser) {
  if (!item || typeof item !== 'object') return null
  const link = normalizeHttpUrl(item.url, url) || normalizeHttpUrl(item.external_url, url)
  const id = String(item.id ?? '').trim() || link
  if (!id) return null
  return {
    id,
    title: String(item.title || '').trim() || 'Untitled',
    url: link,
    publishedAt: safeDate(item.date_published || item.date_modified),
    description: jsonFeedDescription(item, Parser),
    imageUrl: normalizeHttpUrl(item.image, url) || normalizeHttpUrl(item.banner_image, url),
    audio: attachmentAudio(item.attachments, url)
  }
}

export function parseJsonFeed (text, { url, Parser = globalThis.DOMParser } = {}) {
  const document = parseJsonFeedDocument(text)
  const channel = {
    title: String(document.title || '').trim() || new URL(url).hostname,
    url: normalizeHttpUrl(document.home_page_url, url)
  }
  return { channel, items: collectFeedItems(document.items, item => parseJsonFeedItem(item, url, Parser)) }
}

export function sniffJsonFeed (body, contentType = '') {
  if (/application\/feed\+json\b/i.test(contentType)) return true
  try {
    const document = JSON.parse(String(body || ''))
    return !!document && typeof document === 'object' &&
      SUPPORTED_VERSIONS.has(document.version) && Array.isArray(document.items)
  } catch {
    return false
  }
}

export async function fetchJsonFeed (url, {
  previous = null, fetchImpl = globalThis.fetch, Parser = globalThis.DOMParser,
  timeoutMs = 15000, maxBytes = MAX_FEED_BYTES, now = () => Date.now()
} = {}) {
  const requestedUrl = normalizeHttpUrl(url)
  if (!requestedUrl) throw new Error('Invalid JSON Feed URL')
  const headers = { Accept: 'application/feed+json, application/json;q=0.9' }
  if (previous?.etag) headers['If-None-Match'] = previous.etag
  if (previous?.lastModified) headers['If-Modified-Since'] = previous.lastModified
  const response = await fetchImpl(requestedUrl, {
    method: 'GET', redirect: 'follow', cache: 'no-store', credentials: 'omit', headers,
    signal: AbortSignal.timeout(timeoutMs)
  })
  if (response.status === 304 && previous) return { url: requestedUrl, notModified: true, cache: { ...previous, fetchedAt: now(), error: null } }
  if (!response.ok) throw new Error(`JSON Feed request failed (${response.status})`)
  const finalUrl = normalizeHttpUrl(response.url || requestedUrl)
  if (!finalUrl) throw new Error('JSON Feed redirected to an unsupported URL')
  const parsed = parseJsonFeed(await readBoundedResponseText(response, { maxBytes }), { url: finalUrl, Parser })
  return { url: finalUrl, notModified: false, cache: {
    fetchedAt: now(), etag: response.headers.get('etag') || null,
    lastModified: response.headers.get('last-modified') || null,
    channel: parsed.channel, items: parsed.items, error: null
  } }
}
