// Client-side availability + latency probe: time a fetch to the host's origin.
//
// This is a *response-latency* proxy (TTFB→body of the top document), not full-page render
// time. It's used to keep metrics fresh for hosts whose live preview isn't currently rendered.
// The richer full-page load time comes from the preview iframe's `load` event in the UI.
//
// Cross-origin fetch only works when the user has granted host permission for the origin;
// the extension then bypasses CORS. The SSL cert for this request is captured separately by
// the background webRequest listener.
export async function checkHost (url, { timeoutMs = 15000 } = {}) {
  const start = performance.now()
  try {
    await fetch(url, {
      method: 'GET',
      redirect: 'follow',
      cache: 'no-store',
      credentials: 'omit',
      signal: AbortSignal.timeout(timeoutMs)
    })
    return {
      ok: true,
      elapsed: Math.round(performance.now() - start),
      timestamp: Date.now(),
      source: 'fetch',
      error: null
    }
  } catch (error) {
    return {
      ok: false,
      elapsed: null,
      timestamp: Date.now(),
      source: 'fetch',
      error: error?.name === 'TimeoutError' ? 'Timeout' : (error?.message || String(error))
    }
  }
}
