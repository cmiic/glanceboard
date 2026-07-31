// Pacing for anything that touches every monitored site in turn.
//
// Both the preview wall and the background checks used to hit their sites with no gap at all: the
// wall reloaded every iframe on the same tick, and the check loop fired each request the instant the
// previous one resolved. Spacing them keeps Glanceboard from arriving at a set of sites as a burst.

export const STEP_CAP_MS = 2000

// Gap between consecutive sites. The cap is the target, but a cycle must still fit inside the
// interval it repeats on — with enough sites, `intervalMs / count` is the tighter bound and wins.
// intervalMs <= 0 means "no repeating cycle" (a one-off sweep), so the cap applies unshortened.
export function stepDelay (count, intervalMs, cap = STEP_CAP_MS) {
  const n = Math.floor(Number(count) || 0)
  if (n <= 1) return 0
  const budget = Number(intervalMs) || 0
  if (budget <= 0) return Math.max(0, cap)
  return Math.max(0, Math.min(cap, Math.floor(budget / n)))
}

// How long to wait before starting the site at `index`, measured from when the cycle began rather
// than from the end of the previous request. Sleeping a full gap AFTER each request adds the
// request time on top of it: 30 hosts on a one-minute interval would spend 58s sleeping plus every
// request's duration, overrun the interval, and have the next cycle dropped by the run guard —
// halving the effective cadence. Anchoring to the start lets a slow request eat into its own gap.
export function delayUntilSlot (index, gapMs, startedAt, now) {
  const due = Number(startedAt) + Math.max(0, Math.floor(Number(index) || 0)) * (Number(gapMs) || 0)
  return Math.max(0, due - Number(now))
}

// Walk a list of sites one at a time: start each, then hold until it reports it finished or its
// step elapses — whichever comes first. Only one site is normally in flight, and a site that never
// reports back (or is deferred, e.g. a hovered tile) can hold the sweep up for one step at most.
//
// The waiting is injected so the caller owns what "finished" means and which clock is used; that
// also keeps this loop testable without a DOM.
export async function pacedSweep (ids, { stepMs, start, waitForDone, cancelled }) {
  const list = Array.isArray(ids) ? ids : []
  for (let i = 0; i < list.length; i++) {
    if (cancelled?.()) return
    start(list[i])
    // Nothing follows the last one, so don't hold the sweep open waiting on it.
    if (i < list.length - 1) await waitForDone(list[i], stepMs)
  }
}
