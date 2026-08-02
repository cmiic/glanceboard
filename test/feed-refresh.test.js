import { test, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { DOMParser } from 'linkedom'

const data = {}
const setCalls = []
globalThis.DOMParser = DOMParser
globalThis.browser = {
  storage: {
    local: {
      async get (key) {
        if (key == null) return { ...data }
        if (typeof key === 'string') return key in data ? { [key]: data[key] } : {}
        return {}
      },
      async set (values) { setCalls.push(Object.keys(values)); Object.assign(data, structuredClone(values)) },
      async remove (keys) { for (const key of (Array.isArray(keys) ? keys : [keys])) delete data[key] }
    },
    onChanged: { addListener () {}, removeListener () {} }
  },
  permissions: { async contains () { return true } }
}

const { refreshFeedSources } = await import('../src/lib/feed-refresh.js')

beforeEach(() => {
  for (const key of Object.keys(data)) delete data[key]
  setCalls.length = 0
})

test('refreshFeedSources refreshes sequentially and batches successful caches', async () => {
  data.feedSources = [
    { id: 'rss:https://a.test/feed', type: 'rss', url: 'https://a.test/feed', refresh: { mode: 'auto' } },
    { id: 'rss:https://b.test/feed', type: 'rss', url: 'https://b.test/feed', refresh: { mode: 'auto' } }
  ]
  let active = 0
  let maximum = 0
  const originalFetch = globalThis.fetch
  globalThis.fetch = async url => {
    active++
    maximum = Math.max(maximum, active)
    await new Promise(resolve => setTimeout(resolve, 2))
    active--
    return new Response(`<rss version="2.0"><channel><title>${new URL(url).hostname}</title><item><guid>one</guid></item></channel></rss>`, {
      headers: { 'content-type': 'application/rss+xml' }
    })
  }
  try {
    const result = await refreshFeedSources(null, { force: true, now: () => 1000 })
    assert.equal(maximum, 1)
    assert.equal(result.refreshed.length, 2)
    assert.equal(result.failures.length, 0)
    assert.ok(data['feed-cache:rss:https://a.test/feed'].schedule.nextRefreshAt > 1000)
    assert.deepEqual(new Set(setCalls.at(-1)), new Set([
      'feed-cache:rss:https://a.test/feed', 'feed-cache:rss:https://b.test/feed'
    ]))
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('refreshFeedSources keeps stale items and isolates a missing permission', async () => {
  data.feedSources = [
    { id: 'rss:https://a.test/feed', type: 'rss', url: 'https://a.test/feed', refresh: { mode: 'auto' } }
  ]
  data['feed-cache:rss:https://a.test/feed'] = { channel: { title: 'Stale' }, items: [{ id: 'kept' }] }
  browser.permissions.contains = async () => false
  const result = await refreshFeedSources(null, { force: true, now: () => 2000 })
  browser.permissions.contains = async () => true
  assert.equal(result.failures.length, 1)
  assert.equal(data['feed-cache:rss:https://a.test/feed'].items[0].id, 'kept')
  assert.match(data['feed-cache:rss:https://a.test/feed'].error.message, /permission/)
})
