import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  estimateFeedCadence, feedIsDue, nextFeedRefreshAt,
  scheduleFailedFeedCache, scheduleSuccessfulFeedCache
} from '../src/lib/feed-polling.js'

const hour = 60 * 60000

test('adaptive cadence uses dated-item median, bounds and fallback', () => {
  const now = Date.parse('2026-08-03T12:00:00Z')
  assert.equal(estimateFeedCadence([{ publishedAt: now }, { publishedAt: now - hour }, { publishedAt: now - 2 * hour }], now), 60)
  assert.equal(estimateFeedCadence([{ publishedAt: now }], now), 360)
  assert.equal(estimateFeedCadence([{ publishedAt: now }, { publishedAt: now - 2 * 86400000 }, { publishedAt: now - 4 * 86400000 }], now), 1440)
  assert.equal(estimateFeedCadence([{ publishedAt: now + hour }, { publishedAt: now }, { publishedAt: now - hour }], now), 360)
})

test('successful scheduling slows after every three unchanged checks and resets on new items', () => {
  const source = { refresh: { mode: 'auto' } }
  const now = 100000000
  let previous = { items: [{ id: 'one', publishedAt: now }], schedule: { unchangedCount: 2 } }
  let next = scheduleSuccessfulFeedCache(source, previous, {
    notModified: true, cache: { ...previous, fetchedAt: now, items: previous.items }
  }, now)
  assert.equal(next.schedule.unchangedCount, 3)
  assert.equal(next.schedule.nextRefreshAt, now + 12 * hour)
  previous = next
  next = scheduleSuccessfulFeedCache(source, previous, {
    notModified: false, cache: { ...previous, items: [{ id: 'two', publishedAt: now }, ...previous.items] }
  }, now)
  assert.equal(next.schedule.unchangedCount, 0)
  assert.equal(next.schedule.failureCount, 0)
})

test('fixed/off modes, failures and due selection are respected', () => {
  const now = 1000
  const fixed = { id: 'fixed', refresh: { mode: 'fixed', intervalMinutes: 15 } }
  const off = { id: 'off', refresh: { mode: 'off' } }
  const failed = scheduleFailedFeedCache(fixed, null, new Error('offline'), now)
  assert.equal(failed.schedule.failureCount, 1)
  assert.equal(failed.schedule.nextRefreshAt, now + 15 * 60000)
  const failedAgain = scheduleFailedFeedCache(fixed, failed, new Error('offline'), now)
  assert.equal(failedAgain.schedule.failureCount, 2)
  assert.equal(failedAgain.schedule.nextRefreshAt, now + 30 * 60000)
  assert.equal(feedIsDue(off, null, now), false)
  assert.equal(feedIsDue(fixed, { schedule: { nextRefreshAt: now } }, now), true)
  assert.equal(feedIsDue(fixed, null, now, { pollingEnabled: false }), false)
  assert.equal(nextFeedRefreshAt([fixed, off], { fixed: { schedule: { nextRefreshAt: 5000 } } }, now), 5000)
})
