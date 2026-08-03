import { test } from 'node:test'
import assert from 'node:assert/strict'
import { DOMParser } from 'linkedom'
import {
  parseRss, fetchRss, cacheWithError, mergeFeedItems, normalizeHttpUrl,
  truncateFeedDescription, MAX_FEED_BYTES, MAX_FEED_ITEMS, MAX_FEED_DESCRIPTION_CHARS
} from '../src/lib/rss.js'

const rss = `<?xml version="1.0"?>
<rss version="2.0" xmlns:itunes="http://www.itunes.com/dtds/podcast-1.0.dtd">
  <channel>
    <title>Example show</title><link>https://example.com/show</link>
    <item><guid isPermaLink="false">one</guid><title>Newest</title><link>/posts/one</link><pubDate>Tue, 28 Jul 2026 10:00:00 GMT</pubDate><itunes:duration>30</itunes:duration></item>
    <item><guid isPermaLink="false">one</guid><title>Duplicate</title></item>
    <item><title>No date</title><link>https://example.com/posts/two</link></item>
    <item><title>Unsafe</title><link>javascript:alert(1)</link></item>
  </channel>
</rss>`

test('parseRss: normalizes RSS 2.0, relative links and duplicate GUIDs', () => {
  const parsed = parseRss(rss, { url: 'https://example.com/feed.xml', Parser: DOMParser })
  assert.deepEqual(parsed.channel, { title: 'Example show', url: 'https://example.com/show' })
  assert.equal(parsed.items.length, 3)
  assert.equal(parsed.items[0].url, 'https://example.com/posts/one')
  assert.equal(parsed.items[1].publishedAt, null)
  assert.equal(parsed.items[2].url, null)
})

test('parseRss: caps items and rejects malformed, DOCTYPE and non-RSS documents', () => {
  const items = Array.from({ length: MAX_FEED_ITEMS + 5 }, (_, i) => `<item><guid>${i}</guid><title>${i}</title></item>`).join('')
  assert.equal(parseRss(`<rss version="2.0"><channel><title>x</title>${items}</channel></rss>`, {
    url: 'https://x.test/feed', Parser: DOMParser
  }).items.length, MAX_FEED_ITEMS)
  class ErrorParser {
    parseFromString () {
      return { documentElement: { localName: 'parsererror' }, getElementsByTagName: () => [{}] }
    }
  }
  assert.throws(() => parseRss('<rss><channel>', { url: 'https://x.test', Parser: ErrorParser }), /Malformed/)
  assert.throws(() => parseRss('<?xml version="1.0"?><!-- prolog --><!DOCTYPE rss><rss><channel/></rss>', {
    url: 'https://x.test', Parser: DOMParser
  }), /DOCTYPE/)
  assert.throws(() => parseRss('<feed xmlns="http://www.w3.org/2005/Atom"/>', { url: 'https://x.test', Parser: DOMParser }), /RSS/)
  assert.throws(() => parseRss('<rss version="0.91"><channel/></rss>', { url: 'https://x.test', Parser: DOMParser }), /RSS 1.0 and 2.0/)
})

test('parseRss: allows literal DOCTYPE text inside item CDATA', () => {
  const literal = `<rss version="2.0"><channel><title>x</title><item><guid>one</guid><title>Example</title>
    <description><![CDATA[Literal <!DOCTYPE html> text]]></description></item></channel></rss>`
  const parsed = parseRss(literal, { url: 'https://x.test/feed', Parser: DOMParser })
  assert.equal(parsed.items.length, 1)
  assert.match(parsed.items[0].description, /^Literal/)
})

test('parseRss: supports RSS 1.0/RDF feeds such as rss.orf.at', () => {
  const rdf = `<?xml version="1.0"?>
  <rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#"
    xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns="http://purl.org/rss/1.0/">
    <channel rdf:about="https://orf.at/"><title>news.ORF.at</title><link>https://orf.at/</link></channel>
    <item rdf:about="https://orf.at/stories/1/"><title>Headline</title><description>Summary</description>
      <link>https://orf.at/stories/1/</link><dc:date>2026-08-02T12:00:00+02:00</dc:date></item>
  </rdf:RDF>`
  const parsed = parseRss(rdf, { url: 'https://rss.orf.at/news.xml', Parser: DOMParser })
  assert.equal(parsed.channel.title, 'news.ORF.at')
  assert.equal(parsed.items[0].id, 'https://orf.at/stories/1/')
  assert.equal(parsed.items[0].url, 'https://orf.at/stories/1/')
  assert.equal(parsed.items[0].description, 'Summary')
  assert.equal(parsed.items[0].publishedAt, Date.parse('2026-08-02T12:00:00+02:00'))
})

test('parseRss: Atom self-links do not shadow RSS channel and item links', () => {
  const wordpress = `<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom"><channel>
    <title>WordPress</title><atom:link href="https://example.com/feed" rel="self"/><link>https://example.com/</link>
    <item><guid isPermaLink="false">one</guid><title>Post</title><atom:link href="https://example.com/feed#one"/><link>/post</link></item>
  </channel></rss>`
  const parsed = parseRss(wordpress, { url: 'https://example.com/feed', Parser: DOMParser })
  assert.equal(parsed.channel.url, 'https://example.com/')
  assert.equal(parsed.items[0].url, 'https://example.com/post')
})

test('parseRss: extracts plain-text descriptions and safe item images', () => {
  const rich = `<rss version="2.0" xmlns:media="http://search.yahoo.com/mrss/"
    xmlns:content="http://purl.org/rss/1.0/modules/content/"
    xmlns:itunes="http://www.itunes.com/dtds/podcast-1.0.dtd"><channel><title>Rich</title>
    <item><guid>one</guid><title>Media</title><description><![CDATA[<p>Hello <strong>world</strong>.</p><script>ignore me</script>]]></description><media:thumbnail url="/thumb.jpg"/></item>
    <item><guid>two</guid><title>Enclosure</title><content:encoded><![CDATA[Second &amp; safe]]></content:encoded><enclosure url="https://cdn.example/two.png" type="image/png"/></item>
    <item><guid>three</guid><title>Markup image</title><description><![CDATA[Text<img src="/three.jpg">]]></description></item>
    <item><guid>four</guid><title>Unsafe image</title><itunes:image href="javascript:alert(1)"/></item>
  </channel></rss>`
  const items = parseRss(rich, { url: 'https://example.com/feed.xml', Parser: DOMParser }).items
  assert.equal(items[0].description, 'Hello world.')
  assert.equal(items[0].imageUrl, 'https://example.com/thumb.jpg')
  assert.equal(items[1].description, 'Second & safe')
  assert.equal(items[1].imageUrl, 'https://cdn.example/two.png')
  assert.equal(items[2].imageUrl, 'https://example.com/three.jpg')
  assert.equal(items[3].imageUrl, null)
})

test('parseRss extracts podcast audio and common duration formats', () => {
  const podcast = `<rss version="2.0" xmlns:itunes="http://www.itunes.com/dtds/podcast-1.0.dtd"><channel><title>Show</title>
    <item><guid>one</guid><title>Episode</title><itunes:duration>1:02:03</itunes:duration>
      <enclosure url="/episode.mp3" type="audio/mpeg" length="1234"/></item>
    <item><guid>two</guid><title>Unsafe</title><enclosure url="javascript:alert(1)" type="audio/mpeg"/></item>
  </channel></rss>`
  const items = parseRss(podcast, { url: 'https://example.com/feed.xml', Parser: DOMParser }).items
  assert.deepEqual(items[0].audio, {
    url: 'https://example.com/episode.mp3', mimeType: 'audio/mpeg', byteLength: 1234, durationSeconds: 3723
  })
  assert.equal(items[1].audio, null)
})

test('normalizeHttpUrl: allows HTTP(S), resolves relatives and rejects credentials or scripts', () => {
  assert.equal(normalizeHttpUrl('/feed#top', 'https://example.com/page'), 'https://example.com/feed')
  assert.equal(normalizeHttpUrl('', 'https://example.com/page'), null)
  assert.equal(normalizeHttpUrl('javascript:alert(1)', 'https://example.com'), null)
  assert.equal(normalizeHttpUrl('https://me:secret@example.com/feed'), null)
})

test('truncateFeedDescription applies an optional character limit and ellipsis', () => {
  assert.equal(truncateFeedDescription('A short summary', 0), 'A short summary')
  assert.equal(truncateFeedDescription('A short summary', 7), 'A short…')
  assert.equal(truncateFeedDescription('Three 🦊 foxes', 7), 'Three 🦊…')
  assert.equal(truncateFeedDescription('short', 20), 'short')
})

test('parseRss bounds normalized descriptions stored in the cache', () => {
  const description = 'x'.repeat(MAX_FEED_DESCRIPTION_CHARS + 10)
  const parsed = parseRss(`<rss version="2.0"><channel><title>x</title><item><guid>1</guid><description>${description}</description></item></channel></rss>`, {
    url: 'https://example.com/feed', Parser: DOMParser
  })
  assert.equal(parsed.items[0].description.length, MAX_FEED_DESCRIPTION_CHARS)
})

test('fetchRss: returns metadata, sends validators and handles 304', async () => {
  let requested
  const first = await fetchRss('https://example.com/feed.xml', {
    Parser: DOMParser,
    now: () => 10,
    fetchImpl: async (_url, init) => {
      requested = init
      return new Response(rss, { headers: { 'content-type': 'application/rss+xml', etag: 'abc', 'last-modified': 'yesterday' } })
    }
  })
  assert.equal(first.cache.fetchedAt, 10)
  assert.equal(first.cache.etag, 'abc')
  const second = await fetchRss('https://example.com/feed.xml', {
    previous: first.cache,
    Parser: DOMParser,
    now: () => 20,
    fetchImpl: async (_url, init) => {
      requested = init
      return new Response(null, { status: 304 })
    }
  })
  assert.equal(requested.headers['If-None-Match'], 'abc')
  assert.equal(second.cache.fetchedAt, 20)
  assert.equal(second.cache.items.length, first.cache.items.length)
})

test('fetchRss: enforces the response-size limit', async () => {
  await assert.rejects(fetchRss('https://example.com/feed.xml', {
    Parser: DOMParser,
    fetchImpl: async () => new Response('x', { headers: { 'content-length': String(MAX_FEED_BYTES + 1) } })
  }), /larger than 2 MB/)
})

test('fetchRss: stops a chunked response as soon as it crosses the size limit', async () => {
  let cancelled = false
  const stream = new ReadableStream({
    start (controller) {
      controller.enqueue(new Uint8Array(4))
      controller.enqueue(new Uint8Array(4))
    },
    cancel () { cancelled = true }
  })
  await assert.rejects(fetchRss('https://example.com/feed.xml', {
    Parser: DOMParser,
    maxBytes: 5,
    fetchImpl: async () => new Response(stream, { headers: { 'content-type': 'application/rss+xml' } })
  }), /larger than 2 MB/)
  assert.equal(cancelled, true)
})

test('mergeFeedItems: dated items first, newest-first, then stable undated items', () => {
  const sources = [
    { id: 'a', title: 'A' },
    { id: 'b', title: 'B' }
  ]
  const caches = {
    a: { channel: { title: 'Source A' }, items: [{ id: 'a0', title: 'old', publishedAt: 1 }, { id: 'a1', title: 'undated a', publishedAt: null }] },
    b: { channel: { title: 'Source B' }, items: [{ id: 'b0', title: 'new', publishedAt: 2 }, { id: 'b1', title: 'undated b', publishedAt: null }] }
  }
  assert.deepEqual(mergeFeedItems(sources, caches).map(item => item.id), ['b0', 'a0', 'a1', 'b1'])
  assert.equal(mergeFeedItems(sources, caches)[0].sourceTitle, 'Source B')
})

test('cacheWithError preserves stale items for partial group failures', () => {
  const previous = { fetchedAt: 1, channel: { title: 'A' }, items: [{ id: 'kept' }] }
  const failed = cacheWithError(previous, new Error('offline'), 2)
  assert.deepEqual(failed.items, previous.items)
  assert.deepEqual(failed.error, { message: 'offline', at: 2 })
})
