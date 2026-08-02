import { test, beforeEach } from 'node:test'
import assert from 'node:assert/strict'

// In-memory browser.storage.local mock. It must exist BEFORE importing storage.js, because
// browser.js binds `globalThis.browser` at module-evaluation time. We mutate (not replace) this
// `data` object so the binding captured below stays valid across tests.
const data = {}
const revokedOrigins = []
const storageSetCalls = []
globalThis.browser = {
  storage: {
    local: {
      async get (key) {
        if (key == null) return { ...data }
        if (typeof key === 'string') return key in data ? { [key]: data[key] } : {}
        return {}
      },
      // Firefox storage structured-clones values and rejects Proxy objects. Mirroring that here
      // catches reactive Vue data accidentally crossing the persistence boundary.
      async set (obj) {
        storageSetCalls.push(Object.keys(obj))
        Object.assign(data, structuredClone(obj))
      },
      async remove (key) { for (const k of (Array.isArray(key) ? key : [key])) delete data[k] }
    },
    onChanged: { addListener () {}, removeListener () {} }
  },
  permissions: {
    async remove ({ origins }) { revokedOrigins.push(...(origins || [])); return true }
  }
}

const storage = await import('../src/lib/storage.js')

beforeEach(() => {
  for (const k of Object.keys(data)) delete data[k]
  revokedOrigins.length = 0
  storageSetCalls.length = 0
})

test('addHost: dedupes identical entries and applies metric defaults', async () => {
  await storage.setSettings({ metricDefaults: { cert: true, load: false } })
  await storage.addHost('example.com')
  await storage.addHost('https://example.com/') // same normalized id → dedup
  const hosts = await storage.getHosts()
  assert.equal(hosts.length, 1)
  assert.equal(hosts[0].id, 'https://example.com')
  assert.deepEqual(hosts[0].metrics, { cert: true, load: false })
})

test('addHost: a page is its own entry alongside the host root', async () => {
  await storage.addHost('example.com')
  await storage.addHost('example.com/blog')
  await storage.addHost('example.com/status')
  const hosts = await storage.getHosts()
  assert.deepEqual(hosts.map(h => h.id), [
    'https://example.com', 'https://example.com/blog', 'https://example.com/status'
  ])
  assert.deepEqual(hosts.map(h => h.label), [
    'example.com', 'example.com/blog', 'example.com/status'
  ])
  assert.ok(hosts.every(h => h.origin === 'https://example.com')) // one origin, three entries
})

test('pages of one host keep separate histories', async () => {
  await storage.pushResult('https://example.com/blog', { ok: true, elapsed: 10, timestamp: 1 })
  await storage.pushResult('https://example.com/status', { ok: false, elapsed: null, timestamp: 2 })
  const r = await storage.getAllResults()
  assert.deepEqual(r['https://example.com/blog'].elapsed, [10])
  assert.equal(r['https://example.com/status'].ok, false)
})

test('entryOrigin / entryLabel: derived for entries stored before page support', async () => {
  const legacy = { id: 'https://example.com', url: 'https://example.com', hostname: 'example.com' }
  assert.equal(storage.entryOrigin(legacy), 'https://example.com')
  assert.equal(storage.entryLabel(legacy), 'example.com')
  const page = { url: 'https://example.com/blog' }
  assert.equal(storage.entryOrigin(page), 'https://example.com') // origin, not the page id
  assert.equal(storage.entryLabel(page), 'example.com/blog')
})

test('removeHost: deletes results and revokes the host permission', async () => {
  await storage.addHost('example.com')
  await storage.pushResult('https://example.com', { ok: true, elapsed: 100, timestamp: 1, certExpiresInDays: 30 })
  await storage.removeHost('https://example.com')
  assert.deepEqual(await storage.getHosts(), [])
  assert.deepEqual(await storage.getAllResults(), {})
  assert.deepEqual(revokedOrigins, ['https://example.com/*'])
})

test('removeHost: keeps the permission while another page of the same host remains', async () => {
  await storage.addHost('example.com/blog')
  await storage.addHost('example.com/status')
  await storage.removeHost('https://example.com/blog')
  assert.deepEqual(revokedOrigins, []) // /status still needs the origin
  await storage.removeHost('https://example.com/status')
  assert.deepEqual(revokedOrigins, ['https://example.com/*'])
})

test('removeHost: keeps the permission while another host shares the origin pattern', async () => {
  await storage.addHost('http://localhost:8080')
  await storage.addHost('http://localhost:3000') // same match pattern: http://localhost/*
  await storage.removeHost('http://localhost:8080')
  assert.deepEqual(revokedOrigins, []) // still needed by localhost:3000
  await storage.removeHost('http://localhost:3000')
  assert.deepEqual(revokedOrigins, ['http://localhost/*']) // now revoked
})

test('feed groups: create, rename, enforce unique names and move sources', async () => {
  const first = await storage.createFeedGroup('Security')
  const second = await storage.createFeedGroup('Fun')
  await assert.rejects(storage.createFeedGroup(' security '), /already exists/)
  await storage.addFeedSources([{ url: 'https://example.com/feed', title: 'Example' }], { groupId: first.id })
  let sources = await storage.getFeedSources()
  assert.equal(sources[0].id, 'rss:https://example.com/feed')
  assert.equal(sources[0].groupId, first.id)
  assert.deepEqual(sources[0].display, { showImage: true, showDescription: true, descriptionMaxChars: 240 })
  await storage.setFeedSourceDisplay(sources[0].id, { showImage: false, descriptionMaxChars: 90 })
  sources = await storage.getFeedSources()
  assert.deepEqual(sources[0].display, { showImage: false, showDescription: true, descriptionMaxChars: 90 })
  await storage.moveFeedSource(sources[0].id, second.id)
  sources = await storage.getFeedSources()
  assert.equal(sources[0].groupId, second.id)
  await storage.renameFeedGroup(second.id, 'Entertainment')
  assert.equal((await storage.getFeedGroups()).find(group => group.id === second.id).name, 'Entertainment')
})

test('Site + RSS + group commit together and a duplicate feed does not create an empty group', async () => {
  await storage.setSettings({ metricDefaults: { cert: true, load: false } })
  await storage.addSiteAndFeedSources({
    siteInput: 'example.com/news',
    feeds: [{ type: 'rss', url: 'https://feeds.example.com/news.xml', title: 'Example News', cache: { items: [{ id: '1' }] } }],
    groupName: 'News'
  })
  assert.equal((await storage.getHosts())[0].id, 'https://example.com/news')
  assert.deepEqual((await storage.getHosts())[0].metrics, { cert: true, load: false })
  assert.equal((await storage.getFeedGroups())[0].name, 'News')
  assert.equal((await storage.getFeedSources())[0].groupId, (await storage.getFeedGroups())[0].id)
  assert.equal(Object.keys(await storage.getAllFeedCaches()).length, 1)

  await storage.addSiteAndFeedSources({
    siteInput: 'second.example.com',
    feeds: [{ type: 'rss', url: 'https://feeds.example.com/news.xml' }],
    groupName: 'Would be empty'
  })
  assert.equal((await storage.getHosts()).length, 2)
  assert.equal((await storage.getFeedGroups()).length, 1)
})

test('feed cache writes unwrap reactive Proxy objects before Firefox storage', async () => {
  const group = await storage.createFeedGroup('Proxied')
  const cache = new Proxy({
    channel: new Proxy({ title: 'Proxy News' }, {}),
    items: [new Proxy({ id: 'one', title: 'Headline' }, {})]
  }, {})
  await storage.addFeedSources([{ url: 'https://example.com/feed', cache }], { groupId: group.id })
  let stored = (await storage.getAllFeedCaches())['rss:https://example.com/feed']
  assert.deepEqual(stored, { channel: { title: 'Proxy News' }, items: [{ id: 'one', title: 'Headline' }] })

  await storage.setFeedCache('rss:https://example.com/feed', new Proxy({ channel: null, items: [] }, {}))
  stored = (await storage.getAllFeedCaches())['rss:https://example.com/feed']
  assert.deepEqual(stored, { channel: null, items: [] })
})

test('setFeedCaches persists a whole refreshed group in one storage write', async () => {
  const before = storageSetCalls.length
  await storage.setFeedCaches({
    a: new Proxy({ channel: { title: 'A' }, items: [] }, {}),
    b: new Proxy({ channel: { title: 'B' }, items: [] }, {})
  })
  assert.equal(storageSetCalls.length - before, 1)
  assert.deepEqual(new Set(storageSetCalls.at(-1)), new Set(['feed-cache:a', 'feed-cache:b']))
})

test('site and feed permission references do not revoke each other', async () => {
  const group = await storage.createFeedGroup('Example')
  await storage.addHost('example.com')
  await storage.addFeedSources([{ url: 'https://example.com/feed' }], { groupId: group.id })
  await storage.removeHost('https://example.com')
  assert.deepEqual(revokedOrigins, [])
  await storage.removeFeedSource('rss:https://example.com/feed')
  assert.deepEqual(revokedOrigins, ['https://example.com/*'])
})

test('removeFeedGroup deletes member caches and revokes no-longer-used origins', async () => {
  const group = await storage.createFeedGroup('News')
  const added = await storage.addFeedSources([
    { url: 'https://a.com/feed', cache: { items: [{ id: '1' }] } },
    { url: 'https://b.com/feed', cache: { items: [{ id: '2' }] } }
  ], { groupId: group.id })
  assert.equal(Object.keys(await storage.getAllFeedCaches()).length, 2)
  await storage.removeFeedGroup(group.id)
  assert.deepEqual(await storage.getFeedSources(), [])
  assert.deepEqual(await storage.getAllFeedCaches(), {})
  assert.deepEqual(new Set(revokedOrigins), new Set(['https://a.com/*', 'https://b.com/*']))
  assert.equal(added.added.length, 2)
})

test('mixed tile layouts persist and reset across hosts and feed groups', async () => {
  await storage.addHost('example.com')
  const group = await storage.createFeedGroup('News')
  await storage.setTileLayouts({
    'https://example.com': { x: 1, y: 2, w: 3, h: 4 },
    [group.id]: { x: 5, y: 6, w: 7, h: 8 }
  })
  assert.deepEqual((await storage.getHosts())[0].layout, { x: 1, y: 2, w: 3, h: 4 })
  assert.deepEqual((await storage.getFeedGroups())[0].layout, { x: 5, y: 6, w: 7, h: 8 })
  await storage.resetTileLayouts()
  assert.equal((await storage.getHosts())[0].layout, undefined)
  assert.equal((await storage.getFeedGroups())[0].layout, undefined)
})

test('pushResult: newest-first, capped, sticky cert', async () => {
  const id = 'https://example.com'
  await storage.pushResult(id, { ok: true, elapsed: 100, timestamp: 1, certExpiresInDays: 30 }, 2)
  await storage.pushResult(id, { ok: true, elapsed: 200, timestamp: 2, certExpiresInDays: null }, 2)
  await storage.pushResult(id, { ok: true, elapsed: 300, timestamp: 3, certExpiresInDays: null }, 2)
  const r = (await storage.getAllResults())[id]
  assert.deepEqual(r.elapsed, [300, 200]) // newest first, capped at 2
  assert.equal(r.certExpiresInDays[0], 30) // null samples carry the last known value
  assert.equal(r.lastTimestamp, 3)
})

test('pushResult: concurrent writes to different hosts do not clobber each other', async () => {
  // Each host owns its own result:<id> key, so interleaved read-modify-writes can't lose data
  // (the old monolithic single-object write dropped whichever sample committed first).
  await Promise.all([
    storage.pushResult('https://a.com', { ok: true, elapsed: 10, timestamp: 1, certExpiresInDays: null }),
    storage.pushResult('https://b.com', { ok: true, elapsed: 20, timestamp: 2, certExpiresInDays: null })
  ])
  const r = await storage.getAllResults()
  assert.deepEqual(r['https://a.com']?.elapsed, [10])
  assert.deepEqual(r['https://b.com']?.elapsed, [20])
})

test('migrateResultsToPerKey: fans the legacy results object out to per-host keys, idempotently', async () => {
  await browser.storage.local.set({
    results: { 'https://x.com': { timestamp: [1], elapsed: [5], certExpiresInDays: [null], ok: true, lastTimestamp: 1 } }
  })
  await storage.migrateResultsToPerKey()
  assert.deepEqual((await storage.getAllResults())['https://x.com']?.elapsed, [5])
  assert.equal((await browser.storage.local.get('results')).results, undefined) // legacy key cleared
  await storage.migrateResultsToPerKey() // second run is a no-op
  assert.deepEqual((await storage.getAllResults())['https://x.com']?.elapsed, [5])
})

test('setHostMetric / setAllHostsMetric', async () => {
  await storage.addHost('a.com')
  await storage.addHost('b.com')
  await storage.setHostMetric('https://a.com', 'cert', true)
  let hosts = await storage.getHosts()
  assert.equal(hosts.find(h => h.id === 'https://a.com').metrics.cert, true)
  assert.equal(hosts.find(h => h.id === 'https://b.com').metrics.cert, false)
  await storage.setAllHostsMetric('load', true)
  hosts = await storage.getHosts()
  assert.ok(hosts.every(h => h.metrics.load === true))
})

test('getSettings: merges defaults; checks default to off', async () => {
  const s = await storage.getSettings()
  assert.equal(s.intervalMinutes, 0)
  assert.equal(s.previewIntervalMinutes, 0)
  assert.deepEqual(s.metricDefaults, { cert: false, load: false })
  await storage.setSettings({ intervalMinutes: 5 })
  assert.equal((await storage.getSettings()).intervalMinutes, 5)
  await storage.setSettings({ previewIntervalMinutes: 10 })
  assert.equal((await storage.getSettings()).previewIntervalMinutes, 10)
})

test('setSettings: a partial metricDefaults write keeps the other key (deep-merge)', async () => {
  await storage.setSettings({ metricDefaults: { cert: true } })
  assert.deepEqual((await storage.getSettings()).metricDefaults, { cert: true, load: false })
})

test('ensureSeeded: sets the flag with an empty default host list', async () => {
  await storage.ensureSeeded()
  assert.deepEqual(await storage.getHosts(), [])
})
