// Normalize free-form user input ("example.com", "https://example.com/path") into the pieces the
// rest of the extension needs. We monitor the origin root and default bare hosts to https.
export function normalizeHost (input) {
  const raw = String(input ?? '').trim()
  if (!raw) return null

  let candidate = raw
  if (!/^https?:\/\//i.test(candidate)) {
    candidate = 'https://' + candidate
  }

  let u
  try {
    u = new URL(candidate)
  } catch {
    return null
  }

  if ((u.protocol !== 'https:' && u.protocol !== 'http:') || !u.hostname) return null

  return {
    id: u.origin, // unique key for a monitored host
    url: u.origin, // we monitor the origin root
    hostname: u.hostname,
    origin: u.origin,
    // Match pattern for permissions.request() and webRequest URL filtering.
    originPattern: `${u.protocol}//${u.hostname}/*`
  }
}
