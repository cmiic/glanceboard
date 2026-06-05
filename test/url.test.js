import { test } from 'node:test'
import assert from 'node:assert/strict'
import { normalizeHost } from '../src/lib/url.js'

test('bare host defaults to an https origin', () => {
  const n = normalizeHost('example.com')
  assert.equal(n.id, 'https://example.com')
  assert.equal(n.url, 'https://example.com')
  assert.equal(n.hostname, 'example.com')
  assert.equal(n.origin, 'https://example.com')
  assert.equal(n.originPattern, 'https://example.com/*')
})

test('a full URL is reduced to its origin', () => {
  const n = normalizeHost('https://example.com/some/path?q=1#x')
  assert.equal(n.url, 'https://example.com')
  assert.equal(n.originPattern, 'https://example.com/*')
})

test('http scheme is preserved; match pattern is port-agnostic', () => {
  const n = normalizeHost('http://localhost:8080')
  assert.equal(n.url, 'http://localhost:8080') // origin keeps the port
  assert.equal(n.hostname, 'localhost')
  assert.equal(n.originPattern, 'http://localhost/*') // match patterns omit the port
})

test('surrounding whitespace is trimmed', () => {
  assert.equal(normalizeHost('  example.com  ').url, 'https://example.com')
})

test('host is lower-cased', () => {
  assert.equal(normalizeHost('HTTPS://EXAMPLE.COM').hostname, 'example.com')
})

test('long hostnames pass through unchanged', () => {
  const h = 'gfc3ae31add3942-fnpucubcfrlycwrw.adb.eu-frankfurt-1.oraclecloudapps.com'
  assert.equal(normalizeHost(h).hostname, h)
})

test('invalid input returns null', () => {
  assert.equal(normalizeHost(''), null)
  assert.equal(normalizeHost('   '), null)
  assert.equal(normalizeHost(null), null)
  assert.equal(normalizeHost(undefined), null)
  assert.equal(normalizeHost('has a space'), null)
  assert.equal(normalizeHost('javascript:alert(1)'), null)
})
