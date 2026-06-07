// Strip framing-protection headers so monitored sites can be embedded in the dashboard preview.
// SECURITY: the background invokes this only when ALL of these hold (see background.js onHeadersReceived):
//   1. the request is a `sub_frame` load,
//   2. the embedder is our own extension page (isFromOwnExtension) — i.e. our dashboard's preview iframe,
//   3. the target origin is one the user explicitly added (isApprovedTarget).
// So neither the user's normal top-level browsing of a monitored host, another site embedding one, nor a
// monitored host redirecting to an unrelated origin has its clickjacking protection weakened.

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
  // A CSP value may carry several comma-separated policies; each is a ';'-separated directive list.
  // Strip frame-ancestors per-policy so an adjacent policy's directives are never collaterally dropped
  // (splitting on ';' alone would treat "frame-ancestors 'none', default-src 'self'" as one token).
  return cspValue
    .split(',')
    .map(policy => policy
      .split(';')
      .map(d => d.trim())
      .filter(d => d && !/^frame-ancestors\b/i.test(d))
      .join('; '))
    .map(p => p.trim())
    .filter(Boolean)
    .join(', ')
}

// True when the request was triggered by a document loaded from our own extension (an iframe inside
// our dashboard), not by another site embedding a monitored host.
export function isFromOwnExtension (details, extensionBaseUrl) {
  return [details.originUrl, details.documentUrl].some(
    (u) => typeof u === 'string' && u.startsWith(extensionBaseUrl)
  )
}

// True when the framed target's origin is one the user explicitly added. Guards the strip path against
// any request the listener still sees but the user never approved — e.g. a monitored host that
// cross-origin-redirects elsewhere, or an over-broad/stale host permission. `approvedOrigins` is a Set
// of origins (protocol//host[:port]), matching the host `id` shape from url.js.
export function isApprovedTarget (url, approvedOrigins) {
  if (!approvedOrigins || approvedOrigins.size === 0) return false
  try {
    return approvedOrigins.has(new URL(url).origin)
  } catch {
    return false
  }
}
