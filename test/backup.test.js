import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildExportDocument, normalizeImportFeed, parseImportDocument } from '../src/lib/backup.js'

test('normalizeImportFeed persists the same canonical URL that validation accepts', () => {
  assert.equal(normalizeImportFeed({ url: 'example.com/feed' }).url, 'https://example.com/feed')
  assert.equal(normalizeImportFeed({ url: 'http://example.com/feed#fragment' }).url, 'http://example.com/feed')
  assert.equal(normalizeImportFeed({ url: 'ftp://example.com/feed' }), null)
  assert.equal(normalizeImportFeed({ url: 'javascript:alert(1)' }), null)
})

test('versioned export preserves sites, empty groups and feed membership', () => {
  const document = buildExportDocument(
    [{ url: 'https://example.com' }],
    [{ id: 'g1', name: 'Security' }, { id: 'g2', name: 'Empty' }],
    [{ type: 'rss', url: 'https://example.com/feed', title: 'News', discoveredFrom: 'https://example.com', groupId: 'g1', display: { showImage: false, showDescription: true, descriptionMaxChars: 120 } }]
  )
  assert.deepEqual(document, {
    version: 3,
    sites: ['https://example.com'],
    feedGroups: [
      { name: 'Security', feeds: [{ type: 'rss', url: 'https://example.com/feed', title: 'News', discoveredFrom: 'https://example.com', display: { showImage: false, showDescription: true, descriptionMaxChars: 120 } }] },
      { name: 'Empty', feeds: [] }
    ]
  })
})

test('import accepts versioned and legacy arrays / hosts objects', () => {
  assert.deepEqual(parseImportDocument(['https://a.com', { url: 'https://b.com' }]), {
    sites: ['https://a.com', 'https://b.com'], feedGroups: []
  })
  assert.deepEqual(parseImportDocument({ hosts: ['https://old.com'] }), {
    sites: ['https://old.com'], feedGroups: []
  })
  assert.deepEqual(parseImportDocument({
    version: 2,
    sites: ['https://site.com'],
    feedGroups: [{ name: ' News ', feeds: [
      { type: 'rss', url: 'https://site.com/feed', title: 'Site', display: { showDescription: false, descriptionMaxChars: 80 } },
      { type: 'atom', url: 'https://site.com/atom' }
    ] }]
  }), {
    sites: ['https://site.com'],
    feedGroups: [{ name: 'News', feeds: [{ type: 'rss', url: 'https://site.com/feed', title: 'Site', discoveredFrom: null, display: { showImage: true, showDescription: false, descriptionMaxChars: 80 } }] }]
  })
})
