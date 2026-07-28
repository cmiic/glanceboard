// Desktop tile layout: free pixel sizing plus drag-to-reorder.
//
// Pure geometry and ordering helpers, kept out of the components so they carry unit coverage
// (there is no component test harness).
//
// IMPORTANT: the visual order is applied through the CSS `order` property, never by reordering the
// DOM. Every tile holds a live <iframe>, and reparenting an iframe reloads it — a drag that moved
// DOM nodes would reload each tile it passed over. MonitorGrid therefore renders tiles in a stable
// order and only changes `order`, which flex/grid honour without touching the tree.

// The wall is a grid of fine tracks: tiles span however many they need, so widths stay effectively
// free (10px granularity) while the grid still packs. `grid-auto-flow: dense` is what lets two short
// tiles sit beside one tall tile — a flex line cannot, because a flex line IS a row.
// The grid runs with gap: 0 and each card carries the gap as margin: with tracks this fine, a real
// grid gap would be applied between every 10px track and swamp the content.
export const GRID_UNIT = 10
export const CARD_CHROME_HEIGHT = 200 // header + metrics + chart, for a pre-measurement estimate

export const MIN_TILE_WIDTH = 240
export const MAX_TILE_WIDTH = 1920
export const MIN_PREVIEW_HEIGHT = 100
export const MAX_PREVIEW_HEIGHT = 1600

function clamp (value, min, max) {
  const n = Math.round(Number(value))
  if (!Number.isFinite(n)) return null
  return Math.min(max, Math.max(min, n))
}

export function clampTileWidth (w) {
  return w == null ? null : clamp(w, MIN_TILE_WIDTH, MAX_TILE_WIDTH)
}

export function clampPreviewHeight (h) {
  return h == null ? null : clamp(h, MIN_PREVIEW_HEIGHT, MAX_PREVIEW_HEIGHT)
}

// A stored entry's tile layout, normalized. null on either axis = size that axis automatically
// (width fills the row like an unsized tile; height follows the preview's 16:10 scale).
export function tileLayout (entry) {
  const l = entry?.layout || {}
  return { w: clampTileWidth(l.w ?? null), h: clampPreviewHeight(l.h ?? null) }
}

// Where a tile dropped at `point` should be inserted, given the on-screen rects of every tile in
// current visual order. Reading order: a tile is "passed" once the pointer is on a later row, or on
// the same row and past the tile's horizontal midpoint.
//
// Rows are grouped by their shared top edge rather than judged per tile: with free pixel sizing a
// row mixes tall and short tiles, and testing each tile's own bottom edge would treat a short tile
// as already passed whenever the pointer is level with a taller neighbour beside it.
export function dropIndex (rects, point) {
  const rows = new Map()
  for (const r of rects) {
    const key = Math.round(r.top)
    const row = rows.get(key)
    if (row) row.bottom = Math.max(row.bottom, r.bottom)
    else rows.set(key, { top: r.top, bottom: r.bottom })
  }

  let index = 0
  for (const r of rects) {
    const row = rows.get(Math.round(r.top))
    const midX = (r.left + r.right) / 2
    if (point.y > row.bottom) index++ // pointer is on a later row
    else if (point.y >= row.top && point.x > midX) index++ // same row, past the midpoint
  }
  return index
}

// Move one item, where `to` is an insertion index measured against the ORIGINAL list (that is what
// dropIndex returns, since the dragged tile is still on screen while dragging).
export function moveItem (list, from, to) {
  const next = Array.isArray(list) ? list.slice() : []
  if (!Number.isInteger(from) || from < 0 || from >= next.length) return next
  const [item] = next.splice(from, 1)
  const target = Math.max(0, Math.min(next.length, to > from ? to - 1 : to))
  next.splice(target, 0, item)
  return next
}

// How many tracks the grid has at this width.
export function trackCount (gridWidth, unit = GRID_UNIT) {
  return Math.max(1, Math.floor((Number(gridWidth) || 0) / unit))
}

// A tile's footprint is its own box plus the gap it carries as margin.
export function colSpanForWidth (width, gap, unit = GRID_UNIT) {
  return Math.max(1, Math.round(((Number(width) || 0) + gap) / unit))
}

export function rowSpanForHeight (height, gap, unit = GRID_UNIT) {
  return Math.max(1, Math.ceil(((Number(height) || 0) + gap) / unit))
}

// Span for a tile the user has never resized. Reproduces `repeat(auto-fill, minmax(basis, 1fr))`:
// as many equal tiles per row as fit at `basis`, each taking an exact share of the row. Crucially
// this is a fixed span, so a tile alone on the last row is the same width as the tiles above it
// instead of stretching across the whole wall.
export function autoColSpan (gridWidth, basis, gap, unit = GRID_UNIT) {
  const cols = trackCount(gridWidth, unit)
  const perRow = Math.max(1, Math.floor((cols * unit) / (Math.max(1, Number(basis) || 0) + gap)))
  return Math.max(1, Math.floor(cols / perRow))
}

// Height to assume before the card has been measured, so the first paint doesn't overlap.
export function estimateCardHeight (innerWidth, previewHeight) {
  const preview = previewHeight ?? Math.round(((Number(innerWidth) || 0) * 800) / 1280)
  return CARD_CHROME_HEIGHT + Math.max(0, preview)
}

// Stable DOM order for rendering: sort by id, so changing the user's order never reorders the tree.
export function domOrder (hosts) {
  return (Array.isArray(hosts) ? hosts.slice() : []).sort((a, b) => (
    String(a?.id) < String(b?.id) ? -1 : String(a?.id) > String(b?.id) ? 1 : 0
  ))
}
