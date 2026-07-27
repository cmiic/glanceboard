import { test } from 'node:test'
import assert from 'node:assert/strict'
import { normalizeTarget } from '../src/lib/url.js'

test('bare host defaults to an https origin', () => {
  const n = normalizeTarget('example.com')
  assert.equal(n.id, 'https://example.com')
  assert.equal(n.url, 'https://example.com')
  assert.equal(n.hostname, 'example.com')
  assert.equal(n.origin, 'https://example.com')
  assert.equal(n.path, '')
  assert.equal(n.label, 'example.com')
  assert.equal(n.originPattern, 'https://example.com/*')
})

test('a path is kept, so a single page can be monitored', () => {
  const n = normalizeTarget('https://example.com/blog/latest')
  assert.equal(n.id, 'https://example.com/blog/latest')
  assert.equal(n.url, 'https://example.com/blog/latest')
  assert.equal(n.origin, 'https://example.com') // origin stays the host root
  assert.equal(n.label, 'example.com/blog/latest')
  assert.equal(n.originPattern, 'https://example.com/*') // permission is still origin-wide
})

test('query and fragment are part of a page identity', () => {
  assert.equal(normalizeTarget('example.com/search?q=1').id, 'https://example.com/search?q=1')
  // Hash-routed SPAs have no other way to address a page.
  assert.equal(normalizeTarget('example.com/app#/reports').id, 'https://example.com/app#/reports')
})

test('an explicit root path normalizes to the bare origin (back-compat with pre-page entries)', () => {
  assert.equal(normalizeTarget('https://example.com/').id, 'https://example.com')
  assert.equal(normalizeTarget('https://example.com').id, 'https://example.com')
})

test('pages of one host are distinct entries, and differ from the host root', () => {
  const ids = ['example.com', 'example.com/a', 'example.com/b'].map(u => normalizeTarget(u).id)
  assert.equal(new Set(ids).size, 3)
})

test('path case and trailing slash are significant; scheme and host are not', () => {
  assert.equal(normalizeTarget('EXAMPLE.com/Blog').id, 'https://example.com/Blog') // host lowered, path kept
  assert.notEqual(normalizeTarget('example.com/blog/').id, normalizeTarget('example.com/blog').id)
})

test('http scheme is preserved; match pattern is port-agnostic', () => {
  const n = normalizeTarget('http://localhost:8080/status')
  assert.equal(n.url, 'http://localhost:8080/status') // origin keeps the port
  assert.equal(n.hostname, 'localhost')
  assert.equal(n.originPattern, 'http://localhost/*') // match patterns omit the port
})

test('surrounding whitespace is trimmed', () => {
  assert.equal(normalizeTarget('  example.com  ').url, 'https://example.com')
})

test('host is lower-cased', () => {
  assert.equal(normalizeTarget('HTTPS://EXAMPLE.COM').hostname, 'example.com')
})

test('long hostnames pass through unchanged', () => {
  const h = 'gfc3ae31add3942-fnpucubcfrlycwrw.adb.eu-frankfurt-1.oraclecloudapps.com'
  assert.equal(normalizeTarget(h).hostname, h)
})

test('invalid input returns null', () => {
  assert.equal(normalizeTarget(''), null)
  assert.equal(normalizeTarget('   '), null)
  assert.equal(normalizeTarget(null), null)
  assert.equal(normalizeTarget(undefined), null)
  assert.equal(normalizeTarget('has a space'), null)
  assert.equal(normalizeTarget('javascript:alert(1)'), null)
})
