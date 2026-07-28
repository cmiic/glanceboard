import { test } from 'node:test'
import assert from 'node:assert/strict'
import { chartSeries, seriesSignature, MAX_POINTS } from '../src/lib/chart.js'

test('chartSeries: newest-first history is charted oldest -> newest', () => {
  const s = chartSeries([300, 200, 100], [30, 20, 10])
  assert.deepEqual(s.timestamps, [100, 200, 300])
  assert.deepEqual(s.values, [10, 20, 30])
})

test('chartSeries: caps at MAX_POINTS, keeping the newest samples', () => {
  const times = Array.from({ length: 20 }, (_, i) => 20 - i) // 20 .. 1, newest first
  const s = chartSeries(times, times.map(t => t * 10))
  assert.equal(s.timestamps.length, MAX_POINTS)
  assert.equal(s.timestamps[0], 9) // oldest of the newest 12
  assert.equal(s.timestamps[MAX_POINTS - 1], 20) // newest sample, at the right edge
  assert.equal(s.values[MAX_POINTS - 1], 200)
})

test('chartSeries: a value keeps its own timestamp when the arrays differ in length', () => {
  // Slicing and reversing each array independently would pair the two newest values with the two
  // OLDEST timestamps.
  const s = chartSeries([400, 300, 200, 100], [40, 30])
  assert.deepEqual(s.timestamps, [300, 400])
  assert.deepEqual(s.values, [30, 40])
})

test('chartSeries: null samples are kept so gaps stay visible', () => {
  assert.deepEqual(chartSeries([2, 1], [null, 10]).values, [10, null])
})

test('chartSeries: tolerates missing or non-array input', () => {
  for (const bad of [undefined, null, 'nope', 42]) {
    assert.deepEqual(chartSeries(bad, bad), { timestamps: [], values: [] })
  }
  assert.deepEqual(chartSeries([1, 2], undefined), { timestamps: [], values: [] })
})

test('seriesSignature: identical content matches, a changed sample does not', () => {
  const a = chartSeries([2, 1], [20, 10])
  const b = chartSeries([2, 1], [20, 10]) // same values, different array instances
  assert.equal(seriesSignature(a), seriesSignature(b))
  assert.notEqual(seriesSignature(a), seriesSignature(chartSeries([2, 1], [21, 10])))
  assert.notEqual(seriesSignature(a), seriesSignature(chartSeries([3, 1], [20, 10])))
})

test('seriesSignature: a null value is distinguishable from a missing sample', () => {
  assert.notEqual(
    seriesSignature(chartSeries([2, 1], [null, 10])),
    seriesSignature(chartSeries([1], [10]))
  )
})
