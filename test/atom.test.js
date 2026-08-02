import { test } from 'node:test'
import assert from 'node:assert/strict'
import { DOMParser } from 'linkedom'
import { fetchAtom, parseAtom } from '../src/lib/atom.js'

const atom = `<?xml version="1.0"?>
<feed xmlns="http://www.w3.org/2005/Atom" xml:base="https://example.com/">
  <title type="text">Example Atom</title><link rel="alternate" href="/home"/>
  <entry xml:base="episodes/"><id>one</id><title>Episode one</title><link href="story"/>
    <published>2026-08-01T12:00:00Z</published><summary type="html">&lt;b&gt;Hello&lt;/b&gt; world</summary>
    <link rel="enclosure" href="audio.mp3" type="audio/mpeg" length="123"/></entry>
  <entry><id>one</id><title>Duplicate</title><updated>2026-08-02T12:00:00Z</updated></entry>
</feed>`

test('parseAtom resolves xml:base, normalizes text, dates and podcast enclosures', () => {
  const parsed = parseAtom(atom, { url: 'https://example.com/feed.atom', Parser: DOMParser })
  assert.deepEqual(parsed.channel, { title: 'Example Atom', url: 'https://example.com/home' })
  assert.equal(parsed.items.length, 1)
  assert.equal(parsed.items[0].url, 'https://example.com/episodes/story')
  assert.equal(parsed.items[0].description, 'Hello world')
  assert.deepEqual(parsed.items[0].audio, {
    url: 'https://example.com/episodes/audio.mp3', mimeType: 'audio/mpeg', byteLength: 123, durationSeconds: null
  })
})

test('parseAtom rejects malformed, DOCTYPE and non-Atom XML', () => {
  assert.throws(() => parseAtom('<!DOCTYPE feed><feed/>', { url: 'https://x.test', Parser: DOMParser }), /DOCTYPE/)
  assert.throws(() => parseAtom('<feed>', { url: 'https://x.test', Parser: DOMParser }), /Malformed|Atom/)
  assert.throws(() => parseAtom('<rss version="2.0"/>', { url: 'https://x.test', Parser: DOMParser }), /Atom/)
})

test('fetchAtom uses validators and preserves cache on 304', async () => {
  const first = await fetchAtom('https://example.com/feed.atom', {
    Parser: DOMParser, now: () => 10,
    fetchImpl: async () => new Response(atom, { headers: { etag: 'atom-tag' } })
  })
  let init
  const second = await fetchAtom('https://example.com/feed.atom', {
    Parser: DOMParser, previous: first.cache, now: () => 20,
    fetchImpl: async (_url, options) => { init = options; return new Response(null, { status: 304 }) }
  })
  assert.equal(init.headers['If-None-Match'], 'atom-tag')
  assert.equal(second.notModified, true)
  assert.equal(second.cache.fetchedAt, 20)
})
