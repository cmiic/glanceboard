// Normalize free-form user input ("example.com", "https://example.com/blog?tag=x#top") into the
// pieces the rest of the extension needs. Bare hosts default to https; a path, query or fragment is
// kept, so a single *page* can be monitored and not just the site root.
export function normalizeTarget (input) {
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

  // A bare site root keeps the plain-origin id it has always had, so entries added before page
  // support — and their `result:<id>` history — carry over untouched. The fragment is part of the
  // identity because hash-routed SPAs have no other way to address a page.
  const path = u.pathname === '/' && !u.search && !u.hash ? '' : u.pathname + u.search + u.hash

  return {
    id: u.origin + path, // unique key for a monitored site or page
    url: u.origin + path,
    hostname: u.hostname,
    origin: u.origin,
    path,
    // What tiles and list rows display: bare hostname for a site root, hostname + path for a page.
    label: u.hostname + path,
    // Match pattern for permissions.request() and webRequest URL filtering. Deliberately
    // origin-wide even for a page: previewing one page still needs access to its whole host.
    originPattern: `${u.protocol}//${u.hostname}/*`
  }
}
