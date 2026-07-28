import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  clampTileWidth, clampPreviewHeight, tileLayout, dropIndex, moveItem, domOrder,
  MIN_TILE_WIDTH, MAX_TILE_WIDTH, MIN_PREVIEW_HEIGHT
} from '../src/lib/layout.js'

const rect = (left, top, right, bottom) => ({ left, top, right, bottom })

test('clamp: sizes are bounded and rounded; null stays automatic', () => {
  assert.equal(clampTileWidth(400.4), 400)
  assert.equal(clampTileWidth(10), MIN_TILE_WIDTH)
  assert.equal(clampTileWidth(99999), MAX_TILE_WIDTH)
  assert.equal(clampTileWidth(null), null)
  assert.equal(clampPreviewHeight(1), MIN_PREVIEW_HEIGHT)
  assert.equal(clampPreviewHeight(undefined), null)
  assert.equal(clampTileWidth('nonsense'), null) // never emit NaN into a style
})

test('tileLayout: reads and normalizes a stored entry, tolerating none', () => {
  assert.deepEqual(tileLayout({ layout: { w: 500, h: 300 } }), { w: 500, h: 300 })
  assert.deepEqual(tileLayout({ layout: { w: 5 } }), { w: MIN_TILE_WIDTH, h: null })
  assert.deepEqual(tileLayout({}), { w: null, h: null })
  assert.deepEqual(tileLayout(undefined), { w: null, h: null })
})

test('dropIndex: single row, by horizontal midpoint', () => {
  const rects = [rect(0, 0, 100, 100), rect(110, 0, 210, 100), rect(220, 0, 320, 100)]
  assert.equal(dropIndex(rects, { x: 10, y: 50 }), 0) // before the first
  assert.equal(dropIndex(rects, { x: 60, y: 50 }), 1) // past the first midpoint
  assert.equal(dropIndex(rects, { x: 170, y: 50 }), 2)
  assert.equal(dropIndex(rects, { x: 300, y: 50 }), 3) // after the last
})

test('dropIndex: wrapped rows count every tile on an earlier row', () => {
  const rects = [
    rect(0, 0, 100, 100), rect(110, 0, 210, 100), // row 1
    rect(0, 110, 100, 210), rect(110, 110, 210, 210) // row 2
  ]
  assert.equal(dropIndex(rects, { x: 10, y: 150 }), 2) // start of row 2
  assert.equal(dropIndex(rects, { x: 60, y: 150 }), 3)
  assert.equal(dropIndex(rects, { x: 200, y: 150 }), 4) // end of row 2
  assert.equal(dropIndex(rects, { x: 10, y: 5 }), 0) // above everything
})

test('dropIndex: a short tile beside a tall one is not treated as already passed', () => {
  // Free pixel sizing means one row mixes heights. At y=250 the pointer is still in row 1, level
  // with the tall tile — the short tile sits beside it, not on an earlier row.
  const rects = [rect(0, 0, 100, 300), rect(110, 0, 210, 100)]
  assert.equal(dropIndex(rects, { x: 60, y: 250 }), 1) // past the tall tile's midpoint only
  assert.equal(dropIndex(rects, { x: 10, y: 250 }), 0) // left of both midpoints -> before the row
  assert.equal(dropIndex(rects, { x: 200, y: 250 }), 2) // past both midpoints -> end of the row
  assert.equal(dropIndex(rects, { x: 10, y: 400 }), 2) // genuinely below the row
})

test('moveItem: insertion index is measured against the original list', () => {
  const l = ['a', 'b', 'c', 'd']
  assert.deepEqual(moveItem(l, 0, 2), ['b', 'a', 'c', 'd']) // a between b and c
  assert.deepEqual(moveItem(l, 3, 1), ['a', 'd', 'b', 'c'])
  assert.deepEqual(moveItem(l, 0, 4), ['b', 'c', 'd', 'a']) // to the end
  assert.deepEqual(moveItem(l, 2, 2), ['a', 'b', 'c', 'd']) // dropped on itself
  assert.deepEqual(moveItem(l, 2, 3), ['a', 'b', 'c', 'd']) // just past itself
})

test('moveItem: never mutates the input and survives a bad index', () => {
  const l = ['a', 'b']
  assert.deepEqual(moveItem(l, 5, 0), ['a', 'b'])
  assert.deepEqual(moveItem(l, -1, 0), ['a', 'b'])
  assert.deepEqual(l, ['a', 'b'])
  assert.deepEqual(moveItem(undefined, 0, 0), [])
})

test('domOrder: stable regardless of the user order, so tiles never reparent', () => {
  const a = { id: 'https://a.com' }, b = { id: 'https://b.com' }, c = { id: 'https://c.com' }
  assert.deepEqual(domOrder([c, a, b]).map(h => h.id), domOrder([a, b, c]).map(h => h.id))
  assert.deepEqual(domOrder([c, a, b]).map(h => h.id), ['https://a.com', 'https://b.com', 'https://c.com'])
  assert.deepEqual(domOrder(undefined), [])
})
