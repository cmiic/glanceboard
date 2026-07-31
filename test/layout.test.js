import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  collides, compact, normalizeLayout, moveTile, resizeTile, wallRows,
  defaultColSpan, defaultRowSpan, columnWidth, toColumns, toRows, domOrder,
  COLUMNS, ROW_HEIGHT, MIN_COL_SPAN, MIN_ROW_SPAN
} from '../src/lib/layout.js'

const tile = (id, x, y, w, h) => ({ id, x, y, w, h })
const at = (items, id) => items.find(t => t.id === id)
const hosts = (...layouts) => layouts.map((layout, i) => ({ id: 'h' + i, layout }))

test('collides: overlap only, edges touching is not a collision', () => {
  assert.equal(collides(tile('a', 0, 0, 4, 4), tile('b', 4, 0, 4, 4)), false) // side by side
  assert.equal(collides(tile('a', 0, 0, 4, 4), tile('b', 0, 4, 4, 4)), false) // stacked
  assert.equal(collides(tile('a', 0, 0, 4, 4), tile('b', 3, 3, 4, 4)), true)
  assert.equal(collides(tile('a', 0, 0, 4, 4), tile('a', 0, 0, 4, 4)), false) // itself
})

test('compact: tiles float up, but never through another tile', () => {
  const out = compact([tile('a', 0, 0, 8, 40), tile('b', 0, 60, 8, 20), tile('c', 8, 80, 8, 20)])
  assert.equal(at(out, 'a').y, 0)
  assert.equal(at(out, 'b').y, 40) // stops under a, does not pass through it
  assert.equal(at(out, 'c').y, 0) // free column, floats to the top
})

test('normalizeLayout: unpositioned tiles flow into the first free slot', () => {
  const out = normalizeLayout(hosts(undefined, undefined, undefined), 320)
  const w = defaultColSpan(320)
  assert.equal(w, 8) // 320px of a 1920px nominal wall = 8 of 48 columns
  assert.deepEqual(out.map(t => t.x), [0, 8, 16])
  assert.ok(out.every(t => t.y === 0 && t.h === defaultRowSpan(w)))
})

test('normalizeLayout: stored coordinates are honoured and clamped into the wall', () => {
  const out = normalizeLayout(hosts({ x: 40, y: 3, w: 16, h: 40 }), 320)
  assert.equal(at(out, 'h0').w, 16)
  assert.equal(at(out, 'h0').x, COLUMNS - 16) // 40 + 16 would overflow, so it is pulled back
  assert.equal(at(out, 'h0').y, 0) // compaction floats it up
})

test('normalizeLayout: a pre-coordinates px layout counts as unpositioned, not as x/y', () => {
  // The earlier shape was { w: 619, h: 486 } in PIXELS with no x/y — reading those as columns and
  // rows would put a single tile 619 columns wide.
  const out = normalizeLayout(hosts({ w: 619, h: 486 }), 320)
  assert.equal(at(out, 'h0').w, defaultColSpan(320))
  assert.equal(at(out, 'h0').x, 0)
})

test('normalizeLayout: mixed positioned and unpositioned tiles do not overlap', () => {
  const out = normalizeLayout(hosts({ x: 0, y: 0, w: 16, h: 40 }, undefined, undefined), 320)
  for (const a of out) for (const b of out) assert.equal(collides(a, b), false)
})

test('moveTile: a tile can be placed BELOW a taller one and stays there', () => {
  // The case an order-based flow could not express at all.
  const wall = normalizeLayout(hosts(
    { x: 0, y: 0, w: 8, h: 80 }, // tall tile
    { x: 8, y: 0, w: 8, h: 40 },
    { x: 16, y: 0, w: 8, h: 40 }
  ), 320)
  const out = moveTile(wall, 'h2', 0, 80) // drop underneath the tall tile
  assert.equal(at(out, 'h2').x, 0)
  assert.equal(at(out, 'h2').y, 80) // compaction cannot lift it past the tall tile
  assert.equal(at(out, 'h0').y, 0)
})

test('moveTile: dropping onto an occupied cell pushes the occupant down', () => {
  const wall = [tile('a', 0, 0, 8, 40), tile('b', 8, 0, 8, 40)]
  const out = moveTile(wall, 'a', 8, 0)
  assert.equal(at(out, 'a').x, 8)
  assert.equal(at(out, 'a').y, 0)
  assert.equal(at(out, 'b').y, 40) // shoved below, then compacted back up against a
})

test('moveTile: the same drop always yields the same wall (drags must not wander)', () => {
  const wall = normalizeLayout(hosts(undefined, undefined, undefined, undefined), 320)
  assert.deepEqual(moveTile(wall, 'h3', 0, 0), moveTile(wall, 'h3', 0, 0))
  // Feeding a previous frame's result back in gives a DIFFERENT wall than starting from the
  // original — which is why the drag always re-derives from the layout snapshotted at drag start,
  // rather than from the frame before. Applying moves cumulatively is what made tiles wander.
  const cumulative = moveTile(moveTile(wall, 'h3', 16, 0), 'h3', 0, 0)
  const fromOriginal = moveTile(wall, 'h3', 0, 0)
  assert.notDeepEqual(cumulative, fromOriginal)
})

test('moveTile: x is clamped so a tile never hangs off the right edge', () => {
  const out = moveTile([tile('a', 0, 0, 8, 40)], 'a', COLUMNS - 2, 0)
  assert.equal(at(out, 'a').x, COLUMNS - 8)
})

test('resizeTile: growing pushes neighbours down; minimums are enforced', () => {
  const wall = [tile('a', 0, 0, 8, 40), tile('b', 0, 40, 8, 40)]
  const grown = resizeTile(wall, 'a', 8, 60)
  assert.equal(at(grown, 'a').h, 60)
  assert.equal(at(grown, 'b').y, 60)
  const tiny = resizeTile(wall, 'a', 1, 1)
  assert.equal(at(tiny, 'a').w, MIN_COL_SPAN)
  assert.equal(at(tiny, 'a').h, MIN_ROW_SPAN)
})

test('resizeTile: width is capped by the space left to the right edge', () => {
  const out = resizeTile([tile('a', COLUMNS - 8, 0, 8, 40)], 'a', 40, 40)
  assert.equal(at(out, 'a').w, 8)
})

test('wallRows: the wall is as tall as its lowest tile', () => {
  assert.equal(wallRows([tile('a', 0, 0, 8, 40), tile('b', 8, 30, 8, 25)]), 55)
  assert.equal(wallRows([]), 0)
})

test('pixel mapping: columns scale with the window, rows do not', () => {
  assert.equal(columnWidth(1920), 40)
  assert.equal(columnWidth(960), 20)
  assert.equal(toColumns(400, 1920), 10) // same tile, different windows -> same column span
  assert.equal(toColumns(200, 960), 10)
  assert.equal(toRows(400), 400 / ROW_HEIGHT)
  assert.equal(toColumns(100, 0), 0) // no divide-by-zero before the first measurement
})

test('domOrder: stable regardless of the arrangement, so tiles never reparent', () => {
  const a = { id: 'https://a.com' }, b = { id: 'https://b.com' }, c = { id: 'https://c.com' }
  assert.deepEqual(domOrder([c, a, b]).map(h => h.id), domOrder([a, b, c]).map(h => h.id))
  assert.deepEqual(domOrder(undefined), [])
})
