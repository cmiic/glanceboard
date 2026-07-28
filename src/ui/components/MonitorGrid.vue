<script setup>
import { ref, onMounted, onBeforeUnmount, computed, watch, nextTick } from 'vue'
import { browser } from '@/lib/browser.js'
import HostCard from './HostCard.vue'
import { setHostsOrder, setHostLayout } from '@/lib/storage.js'
import {
  domOrder, tileLayout, dropIndex, moveItem, clampTileWidth, clampPreviewHeight,
  trackCount, colSpanForWidth, rowSpanForHeight, autoColSpan, estimateCardHeight, GRID_UNIT
} from '@/lib/layout.js'

const props = defineProps({
  hosts: { type: Array, default: () => [] },
  results: { type: Object, default: () => ({}) },
  settings: { type: Object, default: () => ({}) }
})

const gridEl = ref(null)
const isMobile = ref(false)
const reloadNonce = ref(0)
const mode = computed(() => (isMobile.value ? 'mobile' : 'desktop'))
// Dragging and resizing are desktop-only: on Android tiles are lazy and a tap opens the site.
const arrangeable = computed(() => !isMobile.value)

// Tiles are RENDERED in a stable order (by id) and positioned with CSS `order`. Reordering the DOM
// would reparent each moved tile's <iframe>, and Firefox reloads an iframe when it is reparented —
// so a drag would reload every tile it passed over.
const tiles = computed(() => domOrder(props.hosts))

const gesture = ref(null) // 'drag' | 'resize' | null, while a pointer gesture is in flight
const draggingId = ref(null)
const dragOrder = ref(null) // live id order during a drag, before it is persisted
const resizing = ref(null) // live { id, w, h } during a resize, before it is persisted

const orderIds = computed(() => dragOrder.value || props.hosts.map(h => h.id))
const orderOf = computed(() => new Map(orderIds.value.map((id, i) => [id, i])))

function layoutOf (host) {
  const base = tileLayout(host)
  if (resizing.value?.id !== host.id) return base
  return { w: resizing.value.w ?? base.w, h: resizing.value.h ?? base.h }
}

// --- grid geometry -------------------------------------------------------------------------
// Tiles span fine tracks rather than sitting on a flex line, so `grid-auto-flow: dense` can pack
// two short tiles beside one tall one, and an unsized tile alone on the last row keeps the width of
// the tiles above it instead of stretching across the wall.
const gridWidth = ref(0)
const gap = ref(14) // --gap, read from the stylesheet on mount
const cardHeights = ref(new Map()) // id -> measured px, for the row span

function tileSpans (host) {
  const { w, h } = layoutOf(host)
  const basis = Number(props.settings?.cardMinWidth) || 320
  const cols = Math.min(
    trackCount(gridWidth.value),
    w ? colSpanForWidth(w, gap.value) : autoColSpan(gridWidth.value, basis, gap.value)
  )
  // Until a card has been measured, estimate from its width so the first paint doesn't overlap.
  const measured = cardHeights.value.get(host.id)
  const height = measured ?? estimateCardHeight(cols * GRID_UNIT - gap.value, h)
  return { cols, rows: rowSpanForHeight(height, gap.value) }
}

function tileStyle (host) {
  const { cols, rows } = tileSpans(host)
  return {
    order: orderOf.value.get(host.id) ?? 0,
    gridColumn: `span ${cols}`,
    gridRow: `span ${rows}`
  }
}

function tileEl (id) {
  return gridEl.value?.querySelector(`[data-tile-id="${CSS.escape(id)}"]`) || null
}

// Rects of every tile in current visual order, for hit-testing the drop position.
function tileRects () {
  const out = []
  for (const id of orderIds.value) {
    const el = tileEl(id)
    if (!el) continue
    const r = el.getBoundingClientRect()
    out.push({ id, left: r.left, top: r.top, right: r.right, bottom: r.bottom })
  }
  return out
}

function addGestureListeners (move, end) {
  window.addEventListener('pointermove', move)
  window.addEventListener('pointerup', end)
  window.addEventListener('pointercancel', end)
}
function removeGestureListeners (move, end) {
  window.removeEventListener('pointermove', move)
  window.removeEventListener('pointerup', end)
  window.removeEventListener('pointercancel', end)
}

// ---- drag to reorder ----
function onDragStart ({ id, event }) {
  if (!arrangeable.value || gesture.value) return
  event.preventDefault() // don't start a text selection or a native drag
  const ids = props.hosts.map(h => h.id)
  if (!ids.includes(id)) return
  gesture.value = 'drag'
  draggingId.value = id
  dragOrder.value = ids
  addGestureListeners(onDragMove, onDragEnd)
}

function onDragMove (event) {
  const rects = tileRects()
  const from = rects.findIndex(r => r.id === draggingId.value)
  if (from < 0) return
  const to = dropIndex(rects, { x: event.clientX, y: event.clientY })
  dragOrder.value = moveItem(rects.map(r => r.id), from, to)
}

async function onDragEnd () {
  removeGestureListeners(onDragMove, onDragEnd)
  const ids = dragOrder.value
  gesture.value = null
  draggingId.value = null
  // A click on the title bar is a zero-distance drag: don't write storage when nothing moved, since
  // every write fans out to a full dashboard refresh.
  const unchanged = !ids || ids.join('|') === props.hosts.map(h => h.id).join('|')
  if (unchanged) { dragOrder.value = null; return }
  // Otherwise `dragOrder` stays applied until the stored hosts come back in this order, so the tiles
  // don't flick back to the old arrangement while the write round-trips.
  await setHostsOrder(ids).catch(() => { dragOrder.value = null })
}

// ---- resize ----
let resizeFrom = null

function onResizeStart ({ id, edge, event }) {
  if (!arrangeable.value || gesture.value) return
  event.preventDefault()
  event.stopPropagation()
  const card = tileEl(id)
  if (!card) return
  const preview = card.querySelector('.preview')
  resizeFrom = {
    id,
    edge,
    x: event.clientX,
    y: event.clientY,
    w: card.getBoundingClientRect().width,
    h: preview ? preview.getBoundingClientRect().height : 0
  }
  gesture.value = 'resize'
  resizing.value = { id, w: null, h: null }
  addGestureListeners(onResizeMove, onResizeEnd)
}

function onResizeMove (event) {
  const s = resizeFrom
  if (!s) return
  const widthEdge = s.edge === 'east' || s.edge === 'corner'
  const heightEdge = s.edge === 'south' || s.edge === 'corner'
  resizing.value = {
    id: s.id,
    w: widthEdge ? clampTileWidth(s.w + (event.clientX - s.x)) : null,
    h: heightEdge ? clampPreviewHeight(s.h + (event.clientY - s.y)) : null
  }
}

async function onResizeEnd () {
  removeGestureListeners(onResizeMove, onResizeEnd)
  const live = resizing.value
  gesture.value = null
  resizeFrom = null
  if (live) {
    const patch = {}
    if (live.w != null) patch.w = live.w
    if (live.h != null) patch.h = live.h
    if (Object.keys(patch).length) await setHostLayout(live.id, patch).catch(() => {})
  }
  resizing.value = null
}

// Drop the local order override once the stored order has caught up (or the list changed under us).
watch(() => props.hosts.map(h => h.id).join('|'), (ids) => {
  if (!gesture.value && dragOrder.value && dragOrder.value.join('|') === ids) dragOrder.value = null
})
// Never leave a gesture override applied after switching to the mobile layout.
watch(arrangeable, (on) => {
  if (!on) { dragOrder.value = null; resizing.value = null; gesture.value = null }
})

// Preview-refresh cadence, separate from the background-check interval. 0 = off → previews load
// once on open (HostCard.onMounted) and never auto-reload.
const previewMs = computed(() => (Number(props.settings?.previewIntervalMinutes) || 0) * 60000)
let timer = null

function startTimer () {
  if (timer) { clearInterval(timer); timer = null }
  // Desktop "wall": auto-refresh the live previews on the configured cadence — but only while this
  // tab is visible, and only when the user has turned preview refresh on (>= 1 min).
  if (!isMobile.value && !document.hidden && previewMs.value >= 60000) {
    timer = setInterval(() => { reloadNonce.value++ }, previewMs.value)
  }
}

// Pause refreshing while the tab is backgrounded; refresh once on return — but only when preview
// refresh is on. Keeps multiple open dashboards from each reloading the monitored hosts when you
// aren't looking at them.
function onVisibility () {
  if (document.hidden) {
    if (timer) { clearInterval(timer); timer = null }
  } else if (!isMobile.value && previewMs.value >= 60000) {
    reloadNonce.value++
    startTimer()
  }
}

async function resolveMode () {
  const setting = props.settings?.mode || 'auto'
  if (setting === 'desktop') {
    isMobile.value = false
  } else if (setting === 'mobile') {
    isMobile.value = true
  } else {
    try {
      isMobile.value = (await browser.runtime.getPlatformInfo()).os === 'android'
    } catch {
      isMobile.value = window.matchMedia('(max-width: 700px)').matches
    }
  }
  startTimer()
}

// Row spans come from what each card actually measures — card height is content-driven (preview
// aspect, optional chart, optional error banner), so it can't be derived from the stored size.
let cardObserver = null
let gridObserver = null

function measureCards () {
  if (!gridEl.value) return
  const next = new Map()
  for (const el of gridEl.value.querySelectorAll('[data-tile-id]')) {
    next.set(el.dataset.tileId, el.getBoundingClientRect().height)
  }
  cardHeights.value = next
}

// Bind to whatever grid element currently exists and measure it. The grid is behind `v-if` on the
// host list — on first mount the hosts haven't loaded yet, so there is nothing to observe and this
// has to run again once tiles appear (and again when the layout mode remounts the grid).
function syncObservers () {
  const el = gridEl.value
  if (!el) return
  gridWidth.value = el.clientWidth || 0
  gridObserver?.disconnect()
  gridObserver?.observe(el)
  if (!cardObserver) return
  cardObserver.disconnect()
  for (const card of el.querySelectorAll('[data-tile-id]')) cardObserver.observe(card)
  measureCards()
}

onMounted(() => {
  resolveMode()
  document.addEventListener('visibilitychange', onVisibility)
  const raw = getComputedStyle(document.documentElement).getPropertyValue('--gap')
  gap.value = parseInt(raw, 10) || 14
  if ('ResizeObserver' in window) {
    gridObserver = new ResizeObserver(() => { gridWidth.value = gridEl.value?.clientWidth || 0 })
    cardObserver = new ResizeObserver(measureCards)
  }
  nextTick(syncObservers)
})

// Tiles appearing/disappearing, or the mode remounting the grid, both need a fresh binding.
watch(() => tiles.value.map(h => h.id).join('|'), () => nextTick(syncObservers))
watch(mode, () => nextTick(syncObservers))
// React to a layout-mode change from Settings without needing a reload.
watch(() => props.settings?.mode, resolveMode)
// Restart the wall timer live when the preview-refresh setting changes.
watch(() => props.settings?.previewIntervalMinutes, startTimer)
onBeforeUnmount(() => {
  if (timer) clearInterval(timer)
  document.removeEventListener('visibilitychange', onVisibility)
  removeGestureListeners(onDragMove, onDragEnd)
  removeGestureListeners(onResizeMove, onResizeEnd)
  gridObserver?.disconnect()
  cardObserver?.disconnect()
})
</script>

<template>
  <div>
    <div
      v-if="!hosts.length"
      class="empty"
    >
      No sites yet — add one from the <strong>Sites</strong> tab.
    </div>
    <!-- key by mode so cards remount cleanly when the layout mode is switched -->
    <div
      v-else
      ref="gridEl"
      :key="mode"
      class="grid"
      :class="{ arranging: !!gesture }"
    >
      <HostCard
        v-for="host in tiles"
        :key="host.id"
        :data-tile-id="host.id"
        :class="{ dragging: draggingId === host.id }"
        :style="tileStyle(host)"
        :host="host"
        :result="results[host.id] || {}"
        :mode="mode"
        :layout="layoutOf(host)"
        :arrangeable="arrangeable"
        :reload-nonce="reloadNonce"
        @dragstart="onDragStart"
        @resizestart="onResizeStart"
      />
    </div>
  </div>
</template>
