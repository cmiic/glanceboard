<script setup>
import { ref, onMounted, onBeforeUnmount, computed, watch, nextTick } from 'vue'
import { browser } from '@/lib/browser.js'
import HostCard from './HostCard.vue'
import { setHostLayouts } from '@/lib/storage.js'
import {
  domOrder, normalizeLayout, moveTile, resizeTile, wallRows,
  columnWidth, toColumns, toRows, ROW_HEIGHT, MIN_COL_SPAN, MIN_ROW_SPAN
} from '@/lib/layout.js'

const props = defineProps({
  hosts: { type: Array, default: () => [] },
  results: { type: Object, default: () => ({}) },
  settings: { type: Object, default: () => ({}) }
})

const wallEl = ref(null)
const isMobile = ref(false)
const reloadNonce = ref(0)
const mode = computed(() => (isMobile.value ? 'mobile' : 'desktop'))
// Arranging is desktop-only: on Android tiles are lazy, stacked, and a tap opens the site.
const arrangeable = computed(() => !isMobile.value)

// Rendered in a stable order and positioned absolutely. Reordering the DOM would reparent each
// moved tile's <iframe>, and Firefox reloads an iframe when it is reparented.
const tiles = computed(() => domOrder(props.hosts))

const wallWidth = ref(0)
const gap = ref(14)
const gesture = ref(null) // 'drag' | 'resize' while a pointer gesture is in flight
const activeId = ref(null)
const preview = ref(null) // the candidate wall during a gesture, before it is persisted

// The stored arrangement, with anything unpositioned given a slot.
const stored = computed(() => normalizeLayout(props.hosts, props.settings?.cardMinWidth))
const wall = computed(() => preview.value || stored.value)
const wallHeight = computed(() => wallRows(wall.value) * ROW_HEIGHT)

function tileStyle (host) {
  const t = wall.value.find(i => i.id === host.id)
  if (!t || !wallWidth.value) return { display: 'none' }
  const cw = columnWidth(wallWidth.value)
  const half = gap.value / 2
  // Subtracting the gap can go negative on a very narrow wall — a minimum-span tile does so below
  // ~168px. A negative CSS length is invalid and gets dropped, which would let the tile size itself
  // to its content and overlap its neighbours; collapsing to 0 degrades predictably instead.
  return {
    position: 'absolute',
    left: `${t.x * cw + half}px`,
    top: `${t.y * ROW_HEIGHT + half}px`,
    width: `${Math.max(0, t.w * cw - gap.value)}px`,
    height: `${Math.max(0, t.h * ROW_HEIGHT - gap.value)}px`
  }
}

// ---- gestures ------------------------------------------------------------------------------
// Every frame recomputes the candidate wall from the layout snapshotted at gesture START, never
// from the previous frame. Applying moves cumulatively feeds each frame's push/compact back into
// the next one, which is what made tiles wander unpredictably under the pointer.
let start = null

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

function onDragStart ({ id, event }) {
  if (!arrangeable.value || gesture.value) return
  event.preventDefault()
  const tile = stored.value.find(t => t.id === id)
  const box = wallEl.value?.getBoundingClientRect()
  if (!tile || !box) return
  const cw = columnWidth(wallWidth.value)
  start = {
    id,
    wall: stored.value,
    // Where inside the tile the pointer grabbed, so the tile doesn't snap its corner to the cursor.
    grabX: event.clientX - (box.left + tile.x * cw),
    grabY: event.clientY - (box.top + tile.y * ROW_HEIGHT),
    box
  }
  gesture.value = 'drag'
  activeId.value = id
  preview.value = stored.value
  addGestureListeners(onDragMove, onDragEnd)
}

function onDragMove (event) {
  if (!start) return
  const x = toColumns(event.clientX - start.box.left - start.grabX, wallWidth.value)
  const y = toRows(event.clientY - start.box.top - start.grabY)
  preview.value = moveTile(start.wall, start.id, x, y)
}

function onResizeStart ({ id, edge, event }) {
  if (!arrangeable.value || gesture.value) return
  event.preventDefault()
  event.stopPropagation()
  const tile = stored.value.find(t => t.id === id)
  if (!tile) return
  start = { id, edge, wall: stored.value, x: event.clientX, y: event.clientY, w: tile.w, h: tile.h }
  gesture.value = 'resize'
  activeId.value = id
  preview.value = stored.value
  addGestureListeners(onResizeMove, onResizeEnd)
}

function onResizeMove (event) {
  if (!start) return
  const widthEdge = start.edge === 'east' || start.edge === 'corner'
  const heightEdge = start.edge === 'south' || start.edge === 'corner'
  const w = widthEdge
    ? Math.max(MIN_COL_SPAN, start.w + toColumns(event.clientX - start.x, wallWidth.value))
    : start.w
  const h = heightEdge
    ? Math.max(MIN_ROW_SPAN, start.h + toRows(event.clientY - start.y))
    : start.h
  preview.value = resizeTile(start.wall, start.id, w, h)
}

async function commit () {
  const next = preview.value
  const before = start?.wall
  gesture.value = null
  activeId.value = null
  start = null
  // A click that moved nothing must not write: every write fans out to a full dashboard refresh.
  if (!next || !before || JSON.stringify(next) === JSON.stringify(before)) { preview.value = null; return }
  const byId = Object.fromEntries(next.map(t => [t.id, t]))
  // Keep the candidate on screen until the stored hosts come back, so the wall doesn't flick.
  await setHostLayouts(byId).catch(() => { preview.value = null })
}

function onDragEnd () {
  removeGestureListeners(onDragMove, onDragEnd)
  commit()
}
function onResizeEnd () {
  removeGestureListeners(onResizeMove, onResizeEnd)
  commit()
}

// Drop the candidate once the stored wall matches it.
watch(stored, (next) => {
  if (!gesture.value && preview.value && JSON.stringify(next) === JSON.stringify(preview.value)) {
    preview.value = null
  }
})
watch(arrangeable, (on) => { if (!on) { preview.value = null; gesture.value = null; start = null } })

// ---- measurement ---------------------------------------------------------------------------
let wallObserver = null

function syncWall () {
  const el = wallEl.value
  if (!el) return
  wallWidth.value = el.clientWidth || 0
  wallObserver?.disconnect()
  wallObserver?.observe(el)
}

// ---- preview refresh (unchanged behaviour) ---------------------------------------------------
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
  nextTick(syncWall)
}

onMounted(() => {
  resolveMode()
  document.addEventListener('visibilitychange', onVisibility)
  gap.value = parseInt(getComputedStyle(document.documentElement).getPropertyValue('--gap'), 10) || 14
  if ('ResizeObserver' in window) {
    wallObserver = new ResizeObserver(() => { wallWidth.value = wallEl.value?.clientWidth || 0 })
  }
  nextTick(syncWall)
})
// The wall element lives behind v-if on the host list, which is empty on the first mount.
watch(() => tiles.value.length, () => nextTick(syncWall))
watch(mode, () => nextTick(syncWall))
watch(() => props.settings?.previewIntervalMinutes, startTimer)
watch(() => props.settings?.mode, resolveMode)

onBeforeUnmount(() => {
  if (timer) clearInterval(timer)
  document.removeEventListener('visibilitychange', onVisibility)
  removeGestureListeners(onDragMove, onDragEnd)
  removeGestureListeners(onResizeMove, onResizeEnd)
  wallObserver?.disconnect()
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
      ref="wallEl"
      :key="mode"
      class="wall"
      :class="{ positioned: arrangeable, arranging: !!gesture }"
      :style="arrangeable ? { height: wallHeight + 'px' } : null"
    >
      <HostCard
        v-for="host in tiles"
        :key="host.id"
        :data-tile-id="host.id"
        :class="{ active: activeId === host.id }"
        :style="arrangeable ? tileStyle(host) : null"
        :host="host"
        :result="results[host.id] || {}"
        :mode="mode"
        :arrangeable="arrangeable"
        :reload-nonce="reloadNonce"
        @dragstart="onDragStart"
        @resizestart="onResizeStart"
      />
    </div>
  </div>
</template>
