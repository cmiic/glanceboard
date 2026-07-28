import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  clampTileWidth, clampPreviewHeight, tileLayout, dropIndex, moveItem, domOrder,
  trackCount, colSpanForWidth, rowSpanForHeight, autoColSpan, estimateCardHeight,
  MIN_TILE_WIDTH, MAX_TILE_WIDTH, MIN_PREVIEW_HEIGHT, GRID_UNIT
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

test('autoColSpan: an unsized tile is a fixed share of the row, not a stretchy one', () => {
  // 1914px of tracks at a 320px base: five tiles per row, each 38 tracks = 380px of footprint.
  const span = autoColSpan(1914, 320, 14)
  assert.equal(span, 38)
  assert.equal(span * GRID_UNIT - 14, 366) // inner width
  // Five of them fill the row; a sixth wraps and is exactly as wide as the five above it — the
  // whole point, since a lone tile on the last row used to stretch across the entire wall.
  assert.ok(span * 5 <= trackCount(1914))
  assert.ok(span * 6 > trackCount(1914))
})

test('autoColSpan: adapts to narrow windows and never collapses below one tile', () => {
  assert.equal(autoColSpan(700, 320, 14), Math.floor(trackCount(700) / 2)) // two per row
  assert.equal(autoColSpan(300, 320, 14), trackCount(300)) // one per row, full width
  assert.ok(autoColSpan(0, 320, 14) >= 1)
})

test('span helpers: width rounds to the nearest track, height always covers the content', () => {
  assert.equal(colSpanForWidth(366, 14), 38) // 380 / 10
  assert.equal(colSpanForWidth(619, 14), 63) // nearest track
  assert.equal(rowSpanForHeight(486, 14), 50) // ceil(500 / 10)
  assert.equal(rowSpanForHeight(481, 14), 50) // rounds UP: never clip the card
  assert.equal(rowSpanForHeight(0, 0), 1)
  assert.equal(colSpanForWidth(undefined, 14), 1) // a missing width degenerates to the min span
})

test('estimateCardHeight: pre-measurement guess follows the 16:10 preview', () => {
  assert.equal(estimateCardHeight(320), 200 + 200)
  assert.equal(estimateCardHeight(320, 500), 700) // an explicit preview height wins
})

test('domOrder: stable regardless of the user order, so tiles never reparent', () => {
  const a = { id: 'https://a.com' }, b = { id: 'https://b.com' }, c = { id: 'https://c.com' }
  assert.deepEqual(domOrder([c, a, b]).map(h => h.id), domOrder([a, b, c]).map(h => h.id))
  assert.deepEqual(domOrder([c, a, b]).map(h => h.id), ['https://a.com', 'https://b.com', 'https://c.com'])
  assert.deepEqual(domOrder(undefined), [])
})
