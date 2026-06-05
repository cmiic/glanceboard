import { test, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { checkHost } from '../src/lib/monitor.js'

const realFetch = globalThis.fetch
afterEach(() => { globalThis.fetch = realFetch })

test('ok response → ok:true with a numeric elapsed', async () => {
  globalThis.fetch = async () => ({ ok: true })
  const r = await checkHost('https://example.com', { timeoutMs: 50 })
  assert.equal(r.ok, true)
  assert.equal(typeof r.elapsed, 'number')
  assert.equal(r.error, null)
  assert.equal(r.source, 'fetch')
})

test('network error → ok:false with the message', async () => {
  globalThis.fetch = async () => { throw new Error('boom') }
  const r = await checkHost('https://example.com', { timeoutMs: 50 })
  assert.equal(r.ok, false)
  assert.equal(r.elapsed, null)
  assert.equal(r.error, 'boom')
})

test('timeout → ok:false with "Timeout"', async () => {
  globalThis.fetch = async () => {
    const e = new Error('aborted')
    e.name = 'TimeoutError'
    throw e
  }
  const r = await checkHost('https://example.com', { timeoutMs: 50 })
  assert.equal(r.ok, false)
  assert.equal(r.error, 'Timeout')
})
