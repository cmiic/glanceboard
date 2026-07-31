import { test } from 'node:test'
import assert from 'node:assert/strict'
import { stepDelay, pacedSweep, STEP_CAP_MS } from '../src/lib/schedule.js'

const MINUTE = 60000

test('stepDelay: a single site (or none) is never delayed', () => {
  assert.equal(stepDelay(1, 5 * MINUTE), 0)
  assert.equal(stepDelay(0, 5 * MINUTE), 0)
  assert.equal(stepDelay(undefined, 5 * MINUTE), 0)
})

test('stepDelay: uses the cap when the cycle comfortably fits', () => {
  assert.equal(stepDelay(10, 5 * MINUTE), STEP_CAP_MS) // 20s of sweep inside 5 minutes
  assert.equal(stepDelay(2, MINUTE), STEP_CAP_MS)
})

test('stepDelay: shrinks so the sweep always fits inside its interval', () => {
  // 60 sites at the 2s cap would take two minutes — longer than the minute they repeat on.
  assert.equal(stepDelay(60, MINUTE), 1000)
  assert.equal(stepDelay(120, MINUTE), 500)
  assert.ok(stepDelay(60, MINUTE) * 60 <= MINUTE)
})

test('stepDelay: a one-off sweep has no interval to fit into, so it gets the full cap', () => {
  assert.equal(stepDelay(50, 0), STEP_CAP_MS)
  assert.equal(stepDelay(50, undefined), STEP_CAP_MS)
})

test('stepDelay: never returns a negative or fractional delay', () => {
  assert.equal(stepDelay(7, 1), 0) // an absurdly short interval floors at 0, not -1
  assert.equal(stepDelay(3, 1000), 333) // whole milliseconds only
  assert.ok(Number.isInteger(stepDelay(9, 7 * MINUTE)))
})

test('stepDelay: an explicit cap overrides the default', () => {
  assert.equal(stepDelay(5, 10 * MINUTE, 500), 500)
})

// A sweep harness that records what happened, with each site "finishing" after a scripted delay.
function harness (loadTimes) {
  const log = []
  let clock = 0
  const inFlight = new Set()
  return {
    log,
    peakConcurrent: () => Math.max(0, ...log.filter(e => e.concurrent != null).map(e => e.concurrent)),
    opts: {
      stepMs: 2000,
      start (id) {
        inFlight.add(id)
        log.push({ id, at: clock, concurrent: inFlight.size })
      },
      async waitForDone (id, stepMs) {
        const finishes = loadTimes[id]
        // Whichever comes first: the site finishing, or the step running out.
        const waited = Math.min(finishes ?? Infinity, stepMs)
        clock += waited
        if (waited === finishes) inFlight.delete(id)
      }
    }
  }
}

test('pacedSweep: starts sites one at a time, in order, never as a burst', async () => {
  const h = harness({ a: 100, b: 100, c: 100 })
  await pacedSweep(['a', 'b', 'c'], h.opts)
  assert.deepEqual(h.log.map(e => e.id), ['a', 'b', 'c'])
  assert.deepEqual(h.log.map(e => e.at), [0, 100, 200]) // chained on completion, not on the cap
  assert.equal(h.peakConcurrent(), 1)
})

test('pacedSweep: a slow site is held to one step, so it cannot stall the sweep', async () => {
  const h = harness({ a: 30000, b: 100, c: 100 })
  await pacedSweep(['a', 'b', 'c'], h.opts)
  assert.deepEqual(h.log.map(e => e.at), [0, 2000, 2100]) // 'a' gets the 2s cap, not 30s
  assert.equal(h.peakConcurrent(), 2) // 'a' is still loading when 'b' starts — bounded, not a burst
})

test('pacedSweep: a site that never finishes still only costs one step', async () => {
  const h = harness({ a: undefined, b: 50 }) // 'a' never reports back at all
  await pacedSweep(['a', 'b'], h.opts)
  assert.deepEqual(h.log.map(e => e.at), [0, 2000])
})

test('pacedSweep: does not wait after the last site', async () => {
  const h = harness({ a: 100, b: 30000 })
  await pacedSweep(['a', 'b'], h.opts)
  assert.equal(h.log.at(-1).at, 100) // returns immediately once the last one is started
})

test('pacedSweep: stops when cancelled, and tolerates an empty list', async () => {
  const h = harness({ a: 10, b: 10, c: 10 })
  let started = 0
  await pacedSweep(['a', 'b', 'c'], { ...h.opts, cancelled: () => ++started > 2 })
  assert.deepEqual(h.log.map(e => e.id), ['a', 'b'])
  await pacedSweep([], h.opts) // must not throw
  await pacedSweep(undefined, h.opts)
})
