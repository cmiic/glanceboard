import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  certDaysFromSecurityInfo,
  isCertExpiringSoon,
  isLoadSlow,
  isStale,
  CERT_WARN_DAYS,
  LOAD_WARN_MS,
  STALE_MS
} from '../src/lib/thresholds.js'

test('isCertExpiringSoon: true below 10 days', () => {
  assert.equal(isCertExpiringSoon(0), true)
  assert.equal(isCertExpiringSoon(9), true)
  assert.equal(isCertExpiringSoon(10), false)
  assert.equal(isCertExpiringSoon(11), false)
  assert.equal(isCertExpiringSoon(null), false)
  assert.equal(isCertExpiringSoon(undefined), false)
})

test('isLoadSlow: true above 1000ms', () => {
  assert.equal(isLoadSlow(1001), true)
  assert.equal(isLoadSlow(1000), false)
  assert.equal(isLoadSlow(0), false)
  assert.equal(isLoadSlow(null), false)
})

test('isStale: true older than 10 minutes', () => {
  const now = 1_000_000_000_000
  assert.equal(isStale(now, now), false)
  assert.equal(isStale(now - STALE_MS + 1, now), false)
  assert.equal(isStale(now - STALE_MS - 1, now), true)
  assert.equal(isStale(null, now), false)
})

test('threshold constants are the documented values', () => {
  assert.equal(CERT_WARN_DAYS, 10)
  assert.equal(LOAD_WARN_MS, 1000)
  assert.equal(STALE_MS, 600000)
})

test('certDaysFromSecurityInfo: whole days until the leaf certificate expires, TLS only', () => {
  const now = 1_000_000_000_000
  const day = 86400000
  const info = (state, end) => ({ state, certificates: [{ validity: { start: now - day, end } }, { validity: { end: now } }] })
  assert.equal(certDaysFromSecurityInfo(info('secure', now + 30 * day + 1), now), 30)
  assert.equal(certDaysFromSecurityInfo(info('weak', now + day - 1), now), 0)
  assert.equal(certDaysFromSecurityInfo(info('secure', now - 1), now), -1)
  assert.equal(certDaysFromSecurityInfo(info('insecure', now + 30 * day), now), null)
  assert.equal(certDaysFromSecurityInfo(info('broken', now + 30 * day), now), null)
  assert.equal(certDaysFromSecurityInfo({ state: 'secure', certificates: [] }, now), null)
  assert.equal(certDaysFromSecurityInfo({ state: 'secure', certificates: [{ validity: {} }] }, now), null)
  assert.equal(certDaysFromSecurityInfo(null, now), null)
  assert.equal(certDaysFromSecurityInfo(undefined, now), null)
})
