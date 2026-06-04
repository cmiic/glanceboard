// Strip framing-protection headers so monitored sites can be embedded in the dashboard.
// SECURITY: this only ever runs for hosts the user explicitly added — Firefox dispatches the
// webRequest listener solely for origins we hold (per-host) permission for, so ordinary browsing
// is never affected.

export function stripFramingHeaders (responseHeaders) {
  if (!Array.isArray(responseHeaders)) return responseHeaders
  const out = []
  for (const header of responseHeaders) {
    const name = (header.name || '').toLowerCase()
    if (name === 'x-frame-options') continue // drop entirely
    if (name === 'content-security-policy' || name === 'content-security-policy-report-only') {
      const stripped = removeFrameAncestors(header.value)
      // Keep the rest of the CSP intact; only drop the framing restriction.
      if (stripped) out.push({ ...header, value: stripped })
      continue
    }
    out.push(header)
  }
  return out
}

function removeFrameAncestors (cspValue) {
  if (!cspValue) return cspValue
  return cspValue
    .split(';')
    .map(d => d.trim())
    .filter(d => d && !/^frame-ancestors\b/i.test(d))
    .join('; ')
}
