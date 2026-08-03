import {
  MAX_FEED_BYTES, MAX_FEED_DESCRIPTION_CHARS, MAX_FEED_ITEMS,
  descriptionText, directChildren, hasPrologDoctype, imageFromMarkup,
  normalizeAudio, normalizeHttpUrl, parserFailed, readBoundedResponseText, safeDate
} from './rss.js'

const ATOM_NAMESPACE = 'http://www.w3.org/2005/Atom'

function atomChildren (node, name) {
  return directChildren(node, name).filter(child => {
    if (!child.namespaceURI || child.namespaceURI === ATOM_NAMESPACE) return true
    const root = node?.ownerDocument?.documentElement || node
    const parserLostDefaultNamespace = root?.namespaceURI !== ATOM_NAMESPACE &&
      root?.getAttribute?.('xmlns') === ATOM_NAMESPACE
    if (!parserLostDefaultNamespace || child.namespaceURI !== 'http://www.w3.org/1999/xhtml') return false
    const qualified = String(child.nodeName || '').toLowerCase()
    // linkedom loses XML default namespaces and assigns XHTML instead. Limit this fallback to DOMs
    // where the root exhibits that bug, so real browser DOMs never widen Atom child matching.
    return !qualified.includes(':') || qualified.startsWith('atom:')
  })
}

function firstAtom (node, name) {
  return atomChildren(node, name)[0] || null
}

function baseFor (node, fallback) {
  const chain = []
  for (let current = node; current?.nodeType === 1; current = current.parentNode) chain.unshift(current)
  let base = fallback
  for (const element of chain) {
    const value = element.getAttribute?.('xml:base') || element.getAttributeNS?.('http://www.w3.org/XML/1998/namespace', 'base')
    if (value) base = normalizeHttpUrl(value, base) || base
  }
  return base
}

function textConstruct (node, Parser) {
  if (!node) return ''
  const type = String(node.getAttribute?.('type') || 'text').toLowerCase()
  if (type === 'xhtml') return String(node.textContent || '').replace(/\s+/g, ' ').trim()
  const value = String(node.textContent || '')
  return type === 'html' ? descriptionText(value, Parser) : value.replace(/\s+/g, ' ').trim()
}

function atomLink (node, rel, documentUrl, { htmlOnly = false } = {}) {
  const links = atomChildren(node, 'link').filter(link => String(link.getAttribute?.('rel') || 'alternate').toLowerCase() === rel)
  const ordered = htmlOnly
    ? [...links.filter(link => !link.getAttribute?.('type') || /^text\/html\b/i.test(link.getAttribute('type'))),
        ...links.filter(link => link.getAttribute?.('type') && !/^text\/html\b/i.test(link.getAttribute('type')))]
    : links
  for (const link of ordered) {
    const url = normalizeHttpUrl(link.getAttribute?.('href'), baseFor(link, documentUrl))
    if (url) return url
  }
  return null
}

function itemImage (entry, markup, documentUrl, Parser) {
  for (const node of directChildren(entry, 'thumbnail')) {
    const url = normalizeHttpUrl(node.getAttribute?.('url'), baseFor(node, documentUrl))
    if (url) return url
  }
  for (const node of directChildren(entry, 'image')) {
    const url = normalizeHttpUrl(node.getAttribute?.('href') || node.getAttribute?.('url') || node.textContent, baseFor(node, documentUrl))
    if (url) return url
  }
  return imageFromMarkup(markup, baseFor(entry, documentUrl), Parser)
}

function itemAudio (entry, documentUrl) {
  for (const link of atomChildren(entry, 'link')) {
    if (String(link.getAttribute?.('rel') || '').toLowerCase() !== 'enclosure') continue
    const audio = normalizeAudio({
      url: link.getAttribute?.('href'),
      mimeType: link.getAttribute?.('type'),
      byteLength: link.getAttribute?.('length')
    }, baseFor(link, documentUrl))
    if (audio) return audio
  }
  return null
}

export function parseAtom (xml, { url, Parser = globalThis.DOMParser } = {}) {
  if (typeof xml !== 'string' || !xml.trim()) throw new Error('Empty Atom response')
  if (hasPrologDoctype(xml)) throw new Error('Atom documents with a DOCTYPE are not supported')
  if (typeof Parser !== 'function') throw new Error('DOMParser is unavailable')
  const document = new Parser().parseFromString(xml, 'application/xml')
  if (parserFailed(document)) throw new Error('Malformed Atom XML')
  const root = document.documentElement
  const namespace = root?.namespaceURI === ATOM_NAMESPACE || root?.getAttribute?.('xmlns') === ATOM_NAMESPACE
  if (String(root?.localName || '').toLowerCase() !== 'feed' || !namespace) {
    throw new Error('Not an Atom feed')
  }

  const channel = {
    title: textConstruct(firstAtom(root, 'title'), Parser) || new URL(url).hostname,
    url: atomLink(root, 'alternate', url, { htmlOnly: true })
  }
  const seen = new Set()
  const items = []
  for (const entry of atomChildren(root, 'entry')) {
    const title = textConstruct(firstAtom(entry, 'title'), Parser) || 'Untitled'
    const link = atomLink(entry, 'alternate', url, { htmlOnly: true })
    const publishedAt = safeDate(firstAtom(entry, 'published')?.textContent || firstAtom(entry, 'updated')?.textContent)
    const summary = firstAtom(entry, 'summary')
    const content = firstAtom(entry, 'content')
    const descriptionNode = summary || content
    const rawMarkup = descriptionNode?.textContent || ''
    const description = Array.from(textConstruct(descriptionNode, Parser)).slice(0, MAX_FEED_DESCRIPTION_CHARS).join('')
    const imageUrl = itemImage(entry, rawMarkup, url, Parser)
    const audio = itemAudio(entry, url)
    const id = String(firstAtom(entry, 'id')?.textContent || '').trim() || link || `${publishedAt ?? ''}:${title}`
    if (seen.has(id)) continue
    seen.add(id)
    items.push({ id, title, url: link, publishedAt, description, imageUrl, audio })
    if (items.length >= MAX_FEED_ITEMS) break
  }
  return { channel, items }
}

export function sniffAtom (body, contentType = '') {
  if (/application\/atom\+xml/i.test(contentType)) return true
  return /^\s*(?:<\?xml[^>]*>\s*)?(?:<!--[^]*?-->\s*)?<(?:atom:)?feed\b[^>]*xmlns(?::atom)?=["']http:\/\/www\.w3\.org\/2005\/Atom["']/i.test(String(body || ''))
}

export async function fetchAtom (url, {
  previous = null, fetchImpl = globalThis.fetch, Parser = globalThis.DOMParser,
  timeoutMs = 15000, maxBytes = MAX_FEED_BYTES, now = () => Date.now()
} = {}) {
  const requestedUrl = normalizeHttpUrl(url)
  if (!requestedUrl) throw new Error('Invalid Atom URL')
  const headers = { Accept: 'application/atom+xml, application/xml;q=0.9, text/xml;q=0.8' }
  if (previous?.etag) headers['If-None-Match'] = previous.etag
  if (previous?.lastModified) headers['If-Modified-Since'] = previous.lastModified
  const response = await fetchImpl(requestedUrl, {
    method: 'GET', redirect: 'follow', cache: 'no-store', credentials: 'omit', headers,
    signal: AbortSignal.timeout(timeoutMs)
  })
  if (response.status === 304 && previous) return { url: requestedUrl, notModified: true, cache: { ...previous, fetchedAt: now(), error: null } }
  if (!response.ok) throw new Error(`Atom request failed (${response.status})`)
  const finalUrl = normalizeHttpUrl(response.url || requestedUrl)
  if (!finalUrl) throw new Error('Atom feed redirected to an unsupported URL')
  const parsed = parseAtom(await readBoundedResponseText(response, { maxBytes }), { url: finalUrl, Parser })
  return { url: finalUrl, notModified: false, cache: {
    fetchedAt: now(), etag: response.headers.get('etag') || null,
    lastModified: response.headers.get('last-modified') || null,
    channel: parsed.channel, items: parsed.items, error: null
  } }
}
