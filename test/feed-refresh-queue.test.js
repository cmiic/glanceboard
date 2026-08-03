import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createFeedRefreshQueue } from '../src/lib/feed-refresh-queue.js'

function deferred () {
  let resolve
  const promise = new Promise(done => { resolve = done })
  return { promise, resolve }
}

test('feed refresh queue coalesces pending peers and scopes each result', async () => {
  const settingsReady = deferred()
  const calls = []
  const queue = createFeedRefreshQueue({
    getSettings: () => settingsReady.promise,
    refreshFeedSources: async (sourceIds, options) => {
      calls.push({ sourceIds, options })
      return { refreshed: ['a', 'b'], failures: [{ sourceId: 'b', message: 'failed' }] }
    },
    scheduleFeedRefresh: async () => {}
  })

  const first = queue.enqueue(['a'], { force: true })
  const second = queue.enqueue(['b'], { force: true })
  settingsReady.resolve({ feedPollingEnabled: false })

  assert.deepEqual(await first, { refreshed: ['a'], failures: [] })
  assert.deepEqual(await second, { refreshed: ['b'], failures: [{ sourceId: 'b', message: 'failed' }] })
  assert.deepEqual(calls, [{
    sourceIds: ['a', 'b'], options: { force: true, pollingEnabled: false }
  }])
})

test('feed refresh queue reconstructs scheduling after refresh failures', async () => {
  const scheduled = []
  const errors = []
  const settings = { feedPollingEnabled: true }
  const queue = createFeedRefreshQueue({
    getSettings: async () => settings,
    refreshFeedSources: async () => { throw new Error('storage quota') },
    scheduleFeedRefresh: async value => { scheduled.push(value) },
    onError: (message, error) => errors.push(`${message}: ${error.message}`)
  })

  await assert.rejects(queue.enqueue(['a']), /storage quota/)
  assert.deepEqual(scheduled, [settings])
  assert.match(errors[0], /feed refresh failed: storage quota/)
})

test('feed refresh queue does not reject successful work when alarm scheduling fails', async () => {
  const errors = []
  const queue = createFeedRefreshQueue({
    getSettings: async () => ({ feedPollingEnabled: true }),
    refreshFeedSources: async () => ({ refreshed: ['a'], failures: [] }),
    scheduleFeedRefresh: async () => { throw new Error('alarm unavailable') },
    onError: (message, error) => errors.push(`${message}: ${error.message}`)
  })

  assert.deepEqual(await queue.enqueue(['a']), { refreshed: ['a'], failures: [] })
  assert.match(errors[0], /rescheduling failed: alarm unavailable/)
})
