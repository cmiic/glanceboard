// Shaping of a monitored entry's rolling history into the series LineChart renders.
//
// Kept out of the component (which has no test harness) so the ordering, the cap and the
// label/value pairing are covered by node:test. Time formatting stays in the UI — this module
// returns raw timestamps so its behaviour doesn't depend on the runner's locale.

export const MAX_POINTS = 12

// `result:<id>` history is newest-first; a chart reads oldest -> newest, left to right.
// Returns { timestamps, values }, both oldest-first and always the same length.
export function chartSeries (labels, elapsed, max = MAX_POINTS) {
  const times = Array.isArray(labels) ? labels : []
  const values = Array.isArray(elapsed) ? elapsed : []
  // Pair by index before slicing, rather than slicing and reversing each array on its own: index i
  // is one sample in both arrays (pushResult writes them together), so if the two ever differ in
  // length, independent reversal would pair the newest values with the oldest timestamps.
  const count = Math.max(0, Math.min(times.length, values.length, max))
  const out = { timestamps: [], values: [] }
  for (let i = count - 1; i >= 0; i--) {
    out.timestamps.push(times[i])
    out.values.push(values[i])
  }
  return out
}

// Stable string for change detection. The dashboard replaces its whole results object on every
// storage write, so LineChart compares content — rebuilding the chart re-renders it, which
// dismisses an open tooltip mid-hover.
export function seriesSignature (series) {
  return `${(series?.timestamps || []).join(',')}|${(series?.values || []).join(',')}`
}
