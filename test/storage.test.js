import { test, beforeEach } from 'node:test'
import assert from 'node:assert/strict'

// In-memory browser.storage.local mock. It must exist BEFORE importing storage.js, because
// browser.js binds `globalThis.browser` at module-evaluation time. We mutate (not replace) this
// `data` object so the binding captured below stays valid across tests.
const data = {}
globalThis.browser = {
  storage: {
    local: {
      async get (key) {
        if (key == null) return { ...data }
        if (typeof key === 'string') return key in data ? { [key]: data[key] } : {}
        return {}
      },
      async set (obj) { Object.assign(data, obj) }
    },
    onChanged: { addListener () {}, removeListener () {} }
  }
}

const storage = await import('../src/lib/storage.js')

beforeEach(() => { for (const k of Object.keys(data)) delete data[k] })

test('addHost: dedupes and applies metric defaults', async () => {
  await storage.setSettings({ metricDefaults: { cert: true, load: false } })
  await storage.addHost('example.com')
  await storage.addHost('https://example.com/path') // same origin → dedup
  const hosts = await storage.getHosts()
  assert.equal(hosts.length, 1)
  assert.equal(hosts[0].id, 'https://example.com')
  assert.deepEqual(hosts[0].metrics, { cert: true, load: false })
})

test('removeHost: also deletes the host results', async () => {
  await storage.addHost('example.com')
  await storage.pushResult('https://example.com', { ok: true, elapsed: 100, timestamp: 1, certExpiresInDays: 30 })
  await storage.removeHost('https://example.com')
  assert.deepEqual(await storage.getHosts(), [])
  assert.deepEqual(await storage.getAllResults(), {})
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
  assert.deepEqual(s.metricDefaults, { cert: false, load: false })
  await storage.setSettings({ intervalMinutes: 5 })
  assert.equal((await storage.getSettings()).intervalMinutes, 5)
})

test('ensureSeeded: sets the flag with an empty default host list', async () => {
  await storage.ensureSeeded()
  assert.deepEqual(await storage.getHosts(), [])
})
