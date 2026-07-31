// Desktop tile layout: a positioned wall, not a flow.
//
// Tiles carry real coordinates — { x, y, w, h } in grid units — so a tile can be put anywhere,
// including below a taller neighbour. An order-based flow cannot express that: with dense packing
// the slot after a tall tile is always BESIDE it, and without dense packing the space beside a tall
// tile is dead. Coordinates give both.
//
// x/w are columns of a FIXED COLUMNS-wide grid whose column width scales with the window, so a
// stored arrangement stays valid at any size and simply scales. y/h are ROW_HEIGHT px rows, which
// do not scale — tile height is absolute.
//
// The DOM is never reordered (tiles are absolutely positioned and rendered in a stable order):
// every tile holds a live <iframe>, and reparenting an iframe reloads it.

export const COLUMNS = 48
export const ROW_HEIGHT = 10 // px per row unit
export const MIN_COL_SPAN = 4
export const MIN_ROW_SPAN = 12
export const CARD_CHROME_HEIGHT = 200 // header + metrics + chart
const NOMINAL_WALL_WIDTH = 1920 // reference width for turning the px "card size" setting into columns

function clampInt (value, min, max) {
  const n = Math.round(Number(value))
  if (!Number.isFinite(n)) return min
  return Math.min(max, Math.max(min, n))
}

export function defaultColSpan (cardMinWidth) {
  return clampInt((COLUMNS * (Number(cardMinWidth) || 320)) / NOMINAL_WALL_WIDTH, MIN_COL_SPAN, COLUMNS)
}

// Enough rows for the card chrome plus a 16:10 preview at that width.
export function defaultRowSpan (colSpan) {
  const widthPx = (colSpan / COLUMNS) * NOMINAL_WALL_WIDTH
  return Math.max(MIN_ROW_SPAN, Math.ceil((CARD_CHROME_HEIGHT + (widthPx * 800) / 1280) / ROW_HEIGHT))
}

export function collides (a, b) {
  return a.id !== b.id &&
    a.x < b.x + b.w && a.x + a.w > b.x &&
    a.y < b.y + b.h && a.y + a.h > b.y
}

function firstFreeSlot (placed, w, h) {
  for (let y = 0; y < 10000; y++) {
    for (let x = 0; x + w <= COLUMNS; x++) {
      if (!placed.some(p => collides({ id: null, x, y, w, h }, p))) return { x, y }
    }
  }
  return { x: 0, y: 0 }
}

// Pull every tile as far up as it will go. Keeps the wall gap-free and makes drops predictable; a
// tile dropped under a tall tile still cannot rise past it, which is exactly the case that an
// order-based flow could not express.
export function compact (items) {
  const out = []
  for (const item of items.slice().sort((a, b) => (a.y - b.y) || (a.x - b.x))) {
    const tile = { ...item }
    while (tile.y > 0 && !out.some(p => collides({ ...tile, y: tile.y - 1 }, p))) tile.y--
    out.push(tile)
  }
  return out
}

// Shove anything the moved tile overlaps downwards, cascading to whatever those tiles then hit.
function pushAway (items, movedId) {
  const out = items.map(t => ({ ...t }))
  const queue = out.filter(t => t.id === movedId)
  let guard = 0
  while (queue.length && guard++ < 1000) {
    const source = queue.shift()
    for (const tile of out) {
      if (tile.id === source.id || !collides(source, tile)) continue
      tile.y = source.y + source.h
      queue.push(tile)
    }
  }
  return out
}

// Read the stored layouts into a resolved wall, giving anything unpositioned the first free slot.
// A pre-coordinates layout (the px-sized { w, h } shape) has no x/y and counts as unpositioned.
export function normalizeLayout (hosts, cardMinWidth) {
  const positioned = []
  const unplaced = []

  for (const host of Array.isArray(hosts) ? hosts : []) {
    const l = host?.layout
    const hasCoords = l && ['x', 'y', 'w', 'h'].every(k => Number.isInteger(l[k]))
    if (hasCoords) {
      const w = clampInt(l.w, MIN_COL_SPAN, COLUMNS)
      positioned.push({
        id: host.id,
        w,
        h: Math.max(MIN_ROW_SPAN, l.h),
        x: clampInt(l.x, 0, COLUMNS - w),
        y: Math.max(0, l.y)
      })
    } else {
      const w = defaultColSpan(cardMinWidth)
      unplaced.push({ id: host.id, x: 0, y: 0, w, h: defaultRowSpan(w) })
    }
  }

  // Settle the saved tiles BEFORE looking for free slots. Removing a host leaves the survivors with
  // stale saved coordinates (nothing rewrites them), so a tile saved at y:40 renders compacted at
  // y:0 — and searching the raw coordinates would hand the vacated y:0 slot to a newly added tile,
  // shoving the existing one back down.
  const out = compact(positioned)
  for (const tile of unplaced) out.push({ ...tile, ...firstFreeSlot(out, tile.w, tile.h) })
  return compact(out)
}

export function moveTile (items, id, x, y) {
  const next = items.map(t => (t.id === id
    ? { ...t, x: clampInt(x, 0, COLUMNS - t.w), y: Math.max(0, Math.round(y)) }
    : { ...t }))
  return compact(pushAway(next, id))
}

export function resizeTile (items, id, w, h) {
  const next = items.map((t) => {
    if (t.id !== id) return { ...t }
    const width = clampInt(w, MIN_COL_SPAN, COLUMNS - t.x)
    return { ...t, w: width, h: Math.max(MIN_ROW_SPAN, Math.round(h)) }
  })
  return compact(pushAway(next, id))
}

export function wallRows (items) {
  return (items || []).reduce((max, t) => Math.max(max, t.y + t.h), 0)
}

// ---- pixel <-> grid ----
export function columnWidth (containerWidth) {
  return (Number(containerWidth) || 0) / COLUMNS
}
export function toColumns (px, containerWidth) {
  const cw = columnWidth(containerWidth)
  return cw > 0 ? Math.round(px / cw) : 0
}
export function toRows (px) {
  return Math.round(px / ROW_HEIGHT)
}

// Stable DOM order for rendering: sort by id, so rearranging the wall never reorders the tree.
export function domOrder (hosts) {
  return (Array.isArray(hosts) ? hosts.slice() : []).sort((a, b) => (
    String(a?.id) < String(b?.id) ? -1 : String(a?.id) > String(b?.id) ? 1 : 0
  ))
}
