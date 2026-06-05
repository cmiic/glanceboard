// Strip framing-protection headers so monitored sites can be embedded in the dashboard preview.
// SECURITY: the background invokes this only for `sub_frame` requests whose embedder is our own
// extension page (see isFromOwnExtension) — i.e. our dashboard's preview iframes — of hosts the user
// explicitly added. So neither the user's normal top-level browsing of a monitored host, nor another
// site embedding one, has its clickjacking protection weakened.

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

// True when the request was triggered by a document loaded from our own extension (an iframe inside
// our dashboard), not by another site embedding a monitored host.
export function isFromOwnExtension (details, extensionBaseUrl) {
  return [details.originUrl, details.documentUrl].some(
    (u) => typeof u === 'string' && u.startsWith(extensionBaseUrl)
  )
}
