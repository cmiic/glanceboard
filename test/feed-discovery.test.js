import { test } from 'node:test'
import assert from 'node:assert/strict'
import { DOMParser } from 'linkedom'
import {
  discoverFromHtml, discoverFromLinkHeader, discoverFromOrf, discoveryPermissionPatterns,
  inspectTarget, defaultCandidateIds, orfDiscoveryRequest
} from '../src/lib/feed-discovery.js'
import { MAX_FEED_BYTES } from '../src/lib/rss.js'

const rss = '<rss version="2.0"><channel><title>News</title><item><title>Hello</title><link>https://example.com/hello</link></item></channel></rss>'

test('HTML and Link header discovery resolve supported alternates and skip generic JSON or stylesheets', () => {
  const html = '<link rel="alternate stylesheet" type="application/rss+xml" title="Theme" href="/theme-feed"><link rel="alternate" type="application/rss+xml" title="News" href="/feed"><link rel="alternate" type="application/atom+xml" href="/atom"><link rel="alternate" type="application/feed+json" href="/feed.json"><link rel="alternate" type="application/json" href="/wp-json/wp/v2/posts/1">'
  assert.deepEqual(discoverFromHtml(html, 'https://example.com/blog', DOMParser), [
    { type: 'rss', url: 'https://example.com/feed', title: 'News' },
    { type: 'atom', url: 'https://example.com/atom', title: '' },
    { type: 'jsonfeed', url: 'https://example.com/feed.json', title: '' }
  ])
  assert.deepEqual(discoverFromLinkHeader('</feed>; rel="alternate"; type="application/rss+xml", </atom>; rel="alternate"; type="application/atom+xml", </feed.json>; rel="alternate"; type="application/feed+json", </api>; rel="alternate"; type="application/json"', 'https://example.com'), [
    { type: 'rss', url: 'https://example.com/feed', title: '' },
    { type: 'atom', url: 'https://example.com/atom', title: '' },
    { type: 'jsonfeed', url: 'https://example.com/feed.json', title: '' }
  ])
})

test('inspectTarget recognizes direct Atom and JSON Feed documents', async () => {
  const documents = [
    ['atom', 'application/atom+xml', '<feed xmlns="http://www.w3.org/2005/Atom"><title>Atom News</title></feed>'],
    ['jsonfeed', 'application/feed+json', JSON.stringify({ version: 'https://jsonfeed.org/version/1.1', title: 'JSON News', items: [] })]
  ]
  for (const [type, contentType, body] of documents) {
    const result = await inspectTarget('https://example.com/feed', {
      Parser: DOMParser, includeOrf: false,
      fetchImpl: async () => new Response(body, { headers: { 'content-type': contentType } })
    })
    assert.equal(result.kind, 'feed')
    assert.equal(result.candidates[0].type, type)
  }
})

test('inspectTarget canonicalizes a direct feed URL before returning it', async () => {
  const body = JSON.stringify({ version: 'https://jsonfeed.org/version/1.1', title: 'JSON News', items: [] })
  const result = await inspectTarget('https://example.com/feed.json#section', {
    Parser: DOMParser, includeOrf: false,
    fetchImpl: async () => new Response(body, { headers: { 'content-type': 'application/json' } })
  })
  assert.equal(result.pageUrl, 'https://example.com/feed.json')
  assert.equal(result.candidates[0].url, 'https://example.com/feed.json')
})

test('inspectTarget does not classify a generic JSON endpoint as JSON Feed', async () => {
  const result = await inspectTarget('https://example.com/api', {
    Parser: DOMParser, includeOrf: false,
    fetchImpl: async url => String(url).endsWith('/api')
      ? new Response('{"status":"ok"}', { headers: { 'content-type': 'application/json' } })
      : new Response('missing', { status: 404 })
  })
  assert.deepEqual(result, { kind: 'page', pageUrl: 'https://example.com/api', candidates: [] })
})

test('ORF adapter recognizes podcast pages and returns the API feed candidate', async () => {
  const page = 'https://sound.orf.at/podcast/oe1/oe1-matrix'
  assert.equal(orfDiscoveryRequest(page).apiUrl, 'https://audioapi.orf.at/radiothek/api/2.0/podcast/oe1/oe1-matrix')
  assert.deepEqual(discoveryPermissionPatterns(page), ['https://audioapi.orf.at/*'])
  const found = await discoverFromOrf(page, async () => ({
    ok: true,
    async json () { return { payload: { title: 'Ö1 matrix', urls: { feed: 'https://podcast.orf.at/matrix.xml' } } } }
  }))
  assert.deepEqual(found, [{ type: 'rss', url: 'https://podcast.orf.at/matrix.xml', title: 'Ö1 matrix' }])
})

test('inspectTarget: reports redirects before reading the page', async () => {
  const result = await inspectTarget('https://example.com', {
    Parser: DOMParser,
    fetchImpl: async () => new Response(null, { status: 302, headers: { location: 'https://www.example.com/' } })
  })
  assert.deepEqual(result, { kind: 'redirect', url: 'https://www.example.com/' })
})

test('inspectTarget: captures Firefox opaque manual redirects through webRequest', async () => {
  let listener = null
  let removed = false
  const webRequest = {
    onBeforeRedirect: {
      addListener (callback) { listener = callback },
      removeListener (callback) { removed = callback === listener }
    }
  }
  const result = await inspectTarget('https://example.com', {
    Parser: DOMParser,
    webRequest,
    fetchImpl: async url => {
      listener({ url, redirectUrl: 'https://www.example.com/landing' })
      return { type: 'opaqueredirect', status: 0, ok: false, headers: new Headers() }
    }
  })
  assert.deepEqual(result, { kind: 'redirect', url: 'https://www.example.com/landing' })
  assert.equal(removed, true)
})

test('inspectTarget: rejects declared oversized responses before reading their body', async () => {
  let bodyRead = false
  await assert.rejects(inspectTarget('https://example.com/feed', {
    Parser: DOMParser,
    webRequest: null,
    fetchImpl: async () => ({
      type: 'basic', status: 200, ok: true, url: 'https://example.com/feed',
      headers: new Headers({ 'content-type': 'application/rss+xml', 'content-length': String(MAX_FEED_BYTES + 1) }),
      async arrayBuffer () { bodyRead = true; return new ArrayBuffer(0) }
    })
  }), /larger than 2 MB/)
  assert.equal(bodyRead, false)
})

test('inspectTarget: recognizes a directly entered RSS document', async () => {
  const result = await inspectTarget('https://example.com/feed', {
    Parser: DOMParser,
    fetchImpl: async () => new Response(rss, { headers: { 'content-type': 'application/rss+xml' } }),
    includeOrf: false
  })
  assert.equal(result.kind, 'feed')
  assert.equal(result.candidates[0].title, 'News')
  assert.ok(result.candidates[0].validated)
})

test('inspectTarget: preserves non-UTF-8 text in a directly entered RSS document', async () => {
  const legacy = '<?xml version="1.0" encoding="iso-8859-1"?><rss version="2.0"><channel><title>Österreich</title></channel></rss>'
  const bytes = Uint8Array.from(legacy, character => character.charCodeAt(0))
  const result = await inspectTarget('https://example.com/legacy.xml', {
    Parser: DOMParser,
    fetchImpl: async () => new Response(bytes, {
      headers: { 'content-type': 'application/rss+xml; charset=iso-8859-1' }
    }),
    includeOrf: false
  })
  assert.equal(result.kind, 'feed')
  assert.equal(result.candidates[0].title, 'Österreich')
})

test('inspectTarget: recognizes direct RSS 1.0 served as generic XML', async () => {
  const rdf = `<rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#" xmlns="http://purl.org/rss/1.0/">
    <channel rdf:about="https://orf.at/"><title>news.ORF.at</title><link>https://orf.at/</link></channel>
    <item rdf:about="https://orf.at/stories/1/"><title>Headline</title><link>https://orf.at/stories/1/</link></item>
  </rdf:RDF>`
  const result = await inspectTarget('https://rss.orf.at/news.xml', {
    Parser: DOMParser,
    fetchImpl: async () => new Response(rdf, { headers: { 'content-type': 'application/xml; charset=utf-8' } }),
    includeOrf: false
  })
  assert.equal(result.kind, 'feed')
  assert.equal(result.candidates[0].title, 'news.ORF.at')
  assert.equal(result.candidates[0].url, 'https://rss.orf.at/news.xml')
})

test('inspectTarget: does not downgrade malformed direct RSS into a website', async () => {
  await assert.rejects(inspectTarget('https://example.com/feed', {
    Parser: DOMParser,
    fetchImpl: async () => new Response('<not-rss/>', { headers: { 'content-type': 'application/rss+xml' } }),
    includeOrf: false
  }), /RSS|Malformed/)
})

test('inspectTarget uses validated content when a feed MIME type is mislabeled', async () => {
  const result = await inspectTarget('https://example.com/feed', {
    Parser: DOMParser,
    fetchImpl: async () => new Response('<feed xmlns="http://www.w3.org/2005/Atom"><title>Atom</title></feed>', {
      headers: { 'content-type': 'application/rss+xml' }
    }),
    includeOrf: false
  })
  assert.equal(result.candidates[0].type, 'atom')
})

test('inspectTarget: validates advertised feeds and probes common paths as fallback', async () => {
  const calls = []
  const fetchImpl = async (url) => {
    calls.push(String(url))
    if (String(url).endsWith('/feed/')) return new Response(rss, { headers: { 'content-type': 'application/rss+xml' } })
    if (String(url).endsWith('/feed')) return new Response(rss, { headers: { 'content-type': 'application/rss+xml' } })
    if (String(url).endsWith('/page')) return new Response('<html><head><link rel="alternate" type="application/rss+xml" href="/feed"></head></html>', { headers: { 'content-type': 'text/html' } })
    return new Response('no', { status: 404 })
  }
  const advertised = await inspectTarget('https://example.com/page', { Parser: DOMParser, fetchImpl, includeOrf: false })
  assert.equal(advertised.candidates[0].url, 'https://example.com/feed')

  const fallback = await inspectTarget('https://other.test/home', {
    Parser: DOMParser,
    includeOrf: false,
    fetchImpl: async (url) => String(url).endsWith('/feed/')
      ? new Response(rss, { headers: { 'content-type': 'application/rss+xml' } })
      : new Response('<html></html>', { headers: { 'content-type': 'text/html' } })
  })
  assert.equal(fallback.candidates[0].url, 'https://other.test/feed/')
})

test('common-path probing can discover Atom after the RSS paths fail', async () => {
  const atom = '<feed xmlns="http://www.w3.org/2005/Atom"><title>Fallback Atom</title></feed>'
  const result = await inspectTarget('https://example.com/home', {
    Parser: DOMParser, includeOrf: false,
    fetchImpl: async url => {
      if (String(url).endsWith('/home')) return new Response('<html></html>', { headers: { 'content-type': 'text/html' } })
      if (String(url).endsWith('/atom.xml')) return new Response(atom, { headers: { 'content-type': 'application/atom+xml' } })
      return new Response('missing', { status: 404 })
    }
  })
  assert.equal(result.candidates[0].type, 'atom')
  assert.equal(result.candidates[0].url, 'https://example.com/atom.xml')
})

test('unpermitted cross-origin advertisements remain selectable for later validation', async () => {
  const result = await inspectTarget('https://example.com/page', {
    Parser: DOMParser,
    includeOrf: false,
    canFetch: async url => new URL(url).origin === 'https://example.com',
    fetchImpl: async () => new Response('<link rel="alternate" type="application/rss+xml" title="Comments" href="https://feeds.test/comments"><link rel="alternate" type="application/rss+xml" title="Main" href="https://feeds.test/main">', { headers: { 'content-type': 'text/html' } })
  })
  assert.equal(result.candidates.length, 2)
  assert.deepEqual(defaultCandidateIds(result.candidates), ['https://feeds.test/main'])
})
