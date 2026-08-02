import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  getFeedAdapter, listFeedAdapters, registerFeedAdapter
} from '../src/lib/feed-adapters.js'
import {
  listDiscoveryStrategies, registerDiscoveryStrategy
} from '../src/lib/feed-discovery.js'

test('feed adapter registry ships RSS, Atom and JSON Feed and accepts future typed adapters', () => {
  assert.equal(getFeedAdapter('rss').type, 'rss')
  assert.equal(getFeedAdapter('atom').type, 'atom')
  assert.equal(getFeedAdapter('jsonfeed').type, 'jsonfeed')
  registerFeedAdapter({ type: 'test-feed', refresh: async () => ({}) })
  assert.equal(getFeedAdapter('test-feed').type, 'test-feed')
  assert.ok(listFeedAdapters().some(adapter => adapter.type === 'rss'))
  assert.ok(listFeedAdapters().every(adapter => typeof adapter.refresh === 'function'))
})

test('discovery registry ships ORF and accepts future strategies', () => {
  assert.ok(listDiscoveryStrategies().some(strategy => strategy.id === 'orf-podcast'))
  registerDiscoveryStrategy({ id: 'test-discovery', discover: async () => [] })
  assert.ok(listDiscoveryStrategies().some(strategy => strategy.id === 'test-discovery'))
})
