import { test } from 'node:test'
import assert from 'node:assert/strict'
import { stripFramingHeaders, isFromOwnExtension } from '../src/lib/headers.js'

const names = (hdrs) => hdrs.map(h => h.name.toLowerCase())

test('removes X-Frame-Options regardless of case', () => {
  const out = stripFramingHeaders([
    { name: 'Content-Type', value: 'text/html' },
    { name: 'X-Frame-Options', value: 'DENY' }
  ])
  assert.ok(!names(out).includes('x-frame-options'))
  assert.ok(names(out).includes('content-type'))
})

test('strips frame-ancestors from CSP but keeps other directives', () => {
  const out = stripFramingHeaders([
    { name: 'content-security-policy', value: "default-src 'self'; frame-ancestors 'none'; img-src *" }
  ])
  const csp = out.find(h => h.name.toLowerCase() === 'content-security-policy')
  assert.ok(csp, 'CSP header is kept')
  assert.ok(!/frame-ancestors/i.test(csp.value))
  assert.ok(/default-src 'self'/.test(csp.value))
  assert.ok(/img-src \*/.test(csp.value))
})

test('drops the CSP header entirely when frame-ancestors was the only directive', () => {
  const out = stripFramingHeaders([
    { name: 'Content-Security-Policy', value: "frame-ancestors 'self'" }
  ])
  assert.equal(out.length, 0)
})

test('handles Content-Security-Policy-Report-Only too', () => {
  const out = stripFramingHeaders([
    { name: 'Content-Security-Policy-Report-Only', value: "frame-ancestors 'none'; default-src 'self'" }
  ])
  assert.equal(out.length, 1)
  assert.ok(!/frame-ancestors/i.test(out[0].value))
  assert.ok(/default-src/.test(out[0].value))
})

test('leaves unrelated headers untouched', () => {
  const input = [{ name: 'Cache-Control', value: 'no-store' }, { name: 'ETag', value: 'abc' }]
  assert.deepEqual(stripFramingHeaders(input), input)
})

test('non-array input is returned as-is', () => {
  assert.equal(stripFramingHeaders(undefined), undefined)
  assert.equal(stripFramingHeaders(null), null)
})

test('isFromOwnExtension: only true when the embedder is our extension', () => {
  const base = 'moz-extension://abc-123/'
  assert.equal(isFromOwnExtension({ documentUrl: 'moz-extension://abc-123/dashboard.html' }, base), true)
  assert.equal(isFromOwnExtension({ originUrl: 'moz-extension://abc-123/dashboard.html' }, base), true)
  assert.equal(isFromOwnExtension({ documentUrl: 'https://evil.example/' }, base), false)
  assert.equal(isFromOwnExtension({ originUrl: 'https://evil.example/' }, base), false)
  assert.equal(isFromOwnExtension({}, base), false)
})
