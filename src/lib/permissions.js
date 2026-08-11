import { browser } from './browser.js'

// Firefox only allows `permissions.request()` while the user's click is still being handled:
// `isHandlingUserInput` is false again as soon as an `await` hands control back to the event loop,
// and the call then rejects with "permissions.request may only be called from a user input
// handler". The check runs *before* Firefox looks at whether anything is actually missing, so even
// a request for origins that are already granted fails once the gesture is gone.
//
// These helpers exist so callers can do both things a click handler needs — skip the request when
// nothing new is required, and issue it without an await in front of it.

// Origin patterns the extension does not hold yet, deduped and in input order. `grantedOrigins` is
// a synchronously readable snapshot (see `loadGrantedOrigins`) precisely because asking the browser
// would itself be an await. Matching is exact: every pattern the UI produces comes from
// `normalizeTarget().originPattern`, and a broader wildcard the user granted by hand only costs a
// redundant request that resolves without a prompt.
export function missingOrigins (patterns, grantedOrigins) {
  const granted = new Set(grantedOrigins || [])
  return [...new Set(patterns || [])].filter(pattern => pattern && !granted.has(pattern))
}

// Request the missing subset of `patterns`. Must be the first awaited call in a click handler:
// everything up to the `browser.permissions.request()` below runs synchronously with the caller,
// so the user gesture is still intact. Resolves `{ granted, origins }`, where `origins` are the
// patterns that were actually requested — the ones a caller may have to clean up again.
export async function requestMissingOrigins (patterns, grantedOrigins) {
  const origins = missingOrigins(patterns, grantedOrigins)
  if (!origins.length) return { granted: true, origins }
  const granted = await browser.permissions.request({ origins })
  return { granted, origins }
}

// Snapshot of the currently granted origin patterns, for the caches the helpers above read.
export async function loadGrantedOrigins () {
  if (!browser.permissions?.getAll) return []
  try {
    return (await browser.permissions.getAll())?.origins || []
  } catch {
    return []
  }
}
