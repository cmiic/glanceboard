import { test } from 'node:test'
import assert from 'node:assert/strict'
import { DOMParser } from 'linkedom'
import { fetchJsonFeed, parseJsonFeed } from '../src/lib/json-feed.js'

test('parseJsonFeed supports 1.0/1.1 content, images, dates and audio attachments', () => {
  for (const version of ['https://jsonfeed.org/version/1', 'https://jsonfeed.org/version/1.1']) {
    const parsed = parseJsonFeed(JSON.stringify({
      version, title: 'JSON News', home_page_url: '/home', items: [
        { id: 'one', title: 'Episode', url: '/post', content_html: '<p>Hello <b>world</b></p>',
          image: '/image.jpg', date_published: '2026-08-01T12:00:00Z',
          attachments: [{ url: '/audio.m4a', mime_type: 'audio/mp4', size_in_bytes: 12, duration_in_seconds: 30 }] },
        { id: 'one', title: 'Duplicate' }
      ]
    }), { url: 'https://example.com/feed.json', Parser: DOMParser })
    assert.equal(parsed.items.length, 1)
    assert.equal(parsed.items[0].description, 'Hello world')
    assert.equal(parsed.items[0].imageUrl, 'https://example.com/image.jpg')
    assert.deepEqual(parsed.items[0].audio, {
      url: 'https://example.com/audio.m4a', mimeType: 'audio/mp4', byteLength: 12, durationSeconds: 30
    })
  }
})

test('parseJsonFeed rejects malformed JSON and unsupported documents', () => {
  assert.throws(() => parseJsonFeed('{', { url: 'https://x.test', Parser: DOMParser }), /Malformed/)
  assert.throws(() => parseJsonFeed('{}', { url: 'https://x.test', Parser: DOMParser }), /supported JSON Feed/)
  assert.throws(() => parseJsonFeed(JSON.stringify({ version: 'https://jsonfeed.org/version/2', items: [] }), { url: 'https://x.test', Parser: DOMParser }), /supported JSON Feed/)
})

test('fetchJsonFeed enforces conditional 304 behavior', async () => {
  const cache = { etag: 'json-tag', channel: { title: 'kept' }, items: [] }
  let init
  const result = await fetchJsonFeed('https://example.com/feed.json', {
    previous: cache, now: () => 30,
    fetchImpl: async (_url, options) => { init = options; return new Response(null, { status: 304 }) }
  })
  assert.equal(init.headers['If-None-Match'], 'json-tag')
  assert.equal(result.notModified, true)
  assert.equal(result.cache.channel.title, 'kept')
})
