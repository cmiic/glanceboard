// Red-state thresholds, ported from the old dashboard (MonitorPanels.vue).
export const CERT_WARN_DAYS = 10
export const LOAD_WARN_MS = 1000
export const STALE_MS = 10 * 60 * 1000 // 10 minutes

export const isCertExpiringSoon = (days) =>
  typeof days === 'number' && days < CERT_WARN_DAYS

export const isLoadSlow = (ms) =>
  typeof ms === 'number' && ms > LOAD_WARN_MS

export const isStale = (timestamp, now = Date.now()) =>
  typeof timestamp === 'number' && timestamp < now - STALE_MS

// Whole days until the leaf certificate of a webRequest.getSecurityInfo() result expires; negative
// once it has. Only TLS connections — state 'secure' or 'weak' — have one: any other state, or a
// certificate without an end date, gives null.
export function certDaysFromSecurityInfo (info, now = Date.now()) {
  if (info?.state !== 'secure' && info?.state !== 'weak') return null
  const end = info.certificates?.[0]?.validity?.end
  if (!end) return null
  return Math.floor((end - now) / 86400000)
}
