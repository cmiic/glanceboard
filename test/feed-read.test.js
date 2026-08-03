import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  feedGroupItemFilter, nextFeedItemFilter, normalizeFeedReadItems, prepareFeedItems,
  MAX_FEED_READ_ITEMS
} from '../src/lib/feed-read.js'
import { createFeedReadQueue } from '../src/lib/feed-read-queue.js'

test('feed filters default to unread and cycle unread, read, all', () => {
  assert.equal(feedGroupItemFilter({}), 'unread')
  assert.equal(feedGroupItemFilter({ itemFilter: 'invalid' }), 'unread')
  assert.equal(nextFeedItemFilter('unread'), 'read')
  assert.equal(nextFeedItemFilter('read'), 'all')
  assert.equal(nextFeedItemFilter('all'), 'unread')
})

test('read markers are validated, deduplicated, newest-first and capped', () => {
  const items = [
    ...Array.from({ length: MAX_FEED_READ_ITEMS + 2 }, (_, id) => ({ id: String(id), readAt: id })),
    { id: '10', readAt: 9999 },
    { id: '', readAt: 5 },
    { id: 'invalid', readAt: 'never' }
  ]
  const normalized = normalizeFeedReadItems(items)
  assert.equal(normalized.length, MAX_FEED_READ_ITEMS)
  assert.deepEqual(normalized[0], { id: '10', readAt: 9999 })
  assert.equal(normalized.some(item => item.id === '0'), false)
  assert.equal(normalized.some(item => item.id === 'invalid'), false)
})

test('group preparation counts all cached items and filters before the 30-item display limit', () => {
  const items = Array.from({ length: 40 }, (_, index) => ({
    sourceId: 'source', id: String(index), publishedAt: 100 - index
  }))
  const states = {
    source: { items: Array.from({ length: 30 }, (_, index) => ({ id: String(index), readAt: index })) }
  }
  const unread = prepareFeedItems(items, states, 'unread')
  assert.deepEqual(unread.counts, { unread: 10, read: 30, all: 40 })
  assert.deepEqual(unread.items.map(item => item.id), ['30', '31', '32', '33', '34', '35', '36', '37', '38', '39'])
  assert.ok(unread.items.every(item => !item.isRead))

  const read = prepareFeedItems(items, states, 'read')
  assert.equal(read.items.length, 30)
  assert.ok(read.items.every(item => item.isRead))
  const all = prepareFeedItems(items, states, 'all')
  assert.equal(all.items.length, 30)
})

test('read mutation queue serializes rapid cross-tab requests and continues after failure', async () => {
  let releaseFirst
  const calls = []
  const queue = createFeedReadQueue({
    setFeedItemRead: async (sourceId, itemId, read) => {
      calls.push({ sourceId, itemId, read, phase: 'start' })
      if (itemId === 'one') await new Promise(resolve => { releaseFirst = resolve })
      if (itemId === 'bad') throw new Error('write failed')
      calls.push({ sourceId, itemId, read, phase: 'end' })
      return { items: [] }
    }
  })
  const first = queue.enqueue('source', 'one', true)
  const second = queue.enqueue('source', 'two', true)
  await Promise.resolve()
  assert.deepEqual(calls.map(call => call.itemId), ['one'])
  releaseFirst()
  await Promise.all([first, second])
  await assert.rejects(queue.enqueue('source', 'bad', true), /write failed/)
  await queue.enqueue('source', 'three', false)
  assert.deepEqual(calls.filter(call => call.phase === 'start').map(call => call.itemId), ['one', 'two', 'bad', 'three'])
})
