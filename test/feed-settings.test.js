import { test } from 'node:test'
import assert from 'node:assert/strict'
import { feedGroupNameKey, syncFeedGroupDrafts } from '../src/lib/feed-settings.js'

test('feed group name keys use locale-independent case folding', () => {
  assert.equal(feedGroupNameKey('Security'), 'security')
  assert.equal(feedGroupNameKey('I'), 'i')
  assert.notEqual(feedGroupNameKey('I'), feedGroupNameKey('ı'))
})

test('feed group drafts adopt remote renames unless locally edited', () => {
  const previousNames = { a: 'Security', b: 'Fun' }
  const drafts = { a: 'Security', b: 'My unsaved name', removed: 'Old' }
  const groups = [{ id: 'a', name: 'Infosec' }, { id: 'b', name: 'Entertainment' }]

  assert.deepEqual(syncFeedGroupDrafts(groups, drafts, previousNames), {
    a: 'Infosec',
    b: 'My unsaved name'
  })
})
