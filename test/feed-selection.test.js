import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  NEW_GROUP, feedSourceInput, retargetCandidate, selectedOriginPatterns, selectionError, siteAndFeedsRequest
} from '../src/lib/feed-selection.js'

const feed = (url, extra = {}) => ({ type: 'rss', url, title: 'Feed', ...extra })

test('selectionError: a site-only add needs nothing selected', () => {
  assert.equal(selectionError({ wantsFeeds: false, selected: [], groupChoice: NEW_GROUP, groupName: '' }), '')
})

test('selectionError: feeds need a selection and, for a new group, a non-blank name', () => {
  assert.equal(selectionError({ wantsFeeds: true, selected: [], groupChoice: NEW_GROUP, groupName: 'News' }),
    'Select at least one feed')
  assert.equal(selectionError({ wantsFeeds: true, selected: [feed('https://a.test/rss')], groupChoice: NEW_GROUP, groupName: '  ' }),
    'Enter a feed group name')
  assert.equal(selectionError({ wantsFeeds: true, selected: [feed('https://a.test/rss')], groupChoice: NEW_GROUP, groupName: 'News' }), '')
  // An existing group needs no name.
  assert.equal(selectionError({ wantsFeeds: true, selected: [feed('https://a.test/rss')], groupChoice: 'feed-group:1', groupName: '' }), '')
})

test('selectedOriginPatterns: one exact-origin pattern per origin, invalid URLs skipped', () => {
  assert.deepEqual(selectedOriginPatterns([
    feed('https://a.test/rss'), feed('https://a.test/atom'), feed('http://b.test/feed'), feed('not a url ://')
  ]), ['https://a.test/*', 'http://b.test/*'])
  assert.deepEqual(selectedOriginPatterns([]), [])
})

test('retargetCandidate: the redirected feed is offered, and kept selected, at its new URL', () => {
  const review = {
    candidates: [feed('https://a.test/rss'), feed('https://a.test/comments')],
    selectedUrls: ['https://a.test/rss']
  }
  const result = { url: 'https://b.test/rss', cache: { channel: { title: 'B' }, items: [] } }
  const next = retargetCandidate(review, 'https://a.test/rss', result)
  assert.deepEqual(next.candidates, [
    feed('https://b.test/rss', { validated: result.cache }), feed('https://a.test/comments')
  ])
  assert.deepEqual(next.selectedUrls, ['https://b.test/rss'])
  // The review it came from is left alone; the component assigns the result.
  assert.equal(review.candidates[0].url, 'https://a.test/rss')
})

test('feedSourceInput: the validated URL and channel title win, the discovered title is the fallback', () => {
  const item = feed('https://a.test/rss', { title: 'Discovered' })
  const cache = { channel: { title: 'Channel' }, items: [] }
  assert.deepEqual(feedSourceInput(item, { url: 'https://a.test/feed.xml', cache }, 'https://a.test/'), {
    type: 'rss', url: 'https://a.test/feed.xml', title: 'Channel', discoveredFrom: 'https://a.test/', cache
  })
  const untitled = { channel: {}, items: [] }
  assert.equal(feedSourceInput(item, { url: item.url, cache: untitled }, null).title, 'Discovered')
})

test('siteAndFeedsRequest: the site is added only when chosen and the review is not a direct feed', () => {
  const review = { direct: false, pageUrl: 'https://a.test/' }
  const base = { review, wantsFeeds: false, groupChoice: NEW_GROUP, groupName: '', feeds: [] }
  assert.equal(siteAndFeedsRequest({ ...base, choice: 'site' }).siteInput, 'https://a.test/')
  assert.equal(siteAndFeedsRequest({ ...base, choice: 'both' }).siteInput, 'https://a.test/')
  assert.equal(siteAndFeedsRequest({ ...base, choice: 'feed' }).siteInput, null)
  assert.equal(siteAndFeedsRequest({ ...base, review: { ...review, direct: true }, choice: 'both' }).siteInput, null)
})

test('siteAndFeedsRequest: feeds go to the chosen group, or to a new one by name', () => {
  const review = { direct: false, pageUrl: 'https://a.test/' }
  const feeds = [{ url: 'https://a.test/rss' }]
  assert.deepEqual(siteAndFeedsRequest({
    review, choice: 'feed', wantsFeeds: true, groupChoice: 'feed-group:1', groupName: 'ignored', feeds
  }), { siteInput: null, feeds, groupId: 'feed-group:1', groupName: '' })
  assert.deepEqual(siteAndFeedsRequest({
    review, choice: 'both', wantsFeeds: true, groupChoice: NEW_GROUP, groupName: 'News', feeds
  }), { siteInput: 'https://a.test/', feeds, groupId: null, groupName: 'News' })
  // Without feeds, no group is touched.
  assert.deepEqual(siteAndFeedsRequest({
    review, choice: 'site', wantsFeeds: false, groupChoice: 'feed-group:1', groupName: 'News', feeds: []
  }), { siteInput: 'https://a.test/', feeds: [], groupId: null, groupName: '' })
})

test('siteAndFeedsRequest: switching to Website while feeds validate adds the site alone', () => {
  // The radios stay enabled during validation, so wantsFeeds can turn false after feeds were resolved.
  const review = { direct: false, pageUrl: 'https://a.test/' }
  assert.deepEqual(siteAndFeedsRequest({
    review, choice: 'site', wantsFeeds: false, groupChoice: NEW_GROUP, groupName: 'News',
    feeds: [{ url: 'https://a.test/rss' }]
  }), { siteInput: 'https://a.test/', feeds: [], groupId: null, groupName: '' })
})
