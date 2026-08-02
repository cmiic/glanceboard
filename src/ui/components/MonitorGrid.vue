<script setup>
import { ref, onMounted, onBeforeUnmount, computed, watch, nextTick } from 'vue'
import { browser } from '@/lib/browser.js'
import HostCard from './HostCard.vue'
import FeedGroupCard from './FeedGroupCard.vue'
import { setTileLayouts } from '@/lib/storage.js'
import { stepDelay, pacedSweep } from '@/lib/schedule.js'
import {
  domOrder, normalizeLayout, moveTile, resizeTile, wallRows,
  columnWidth, toColumns, toRows, ROW_HEIGHT, MIN_COL_SPAN, MIN_ROW_SPAN
} from '@/lib/layout.js'

const props = defineProps({
  hosts: { type: Array, default: () => [] },
  feedGroups: { type: Array, default: () => [] },
  feedSources: { type: Array, default: () => [] },
  feedCaches: { type: Object, default: () => ({}) },
  savedIds: { type: Object, default: () => new Set() },
  results: { type: Object, default: () => ({}) },
  settings: { type: Object, default: () => ({}) }
})

const emit = defineEmits(['play'])

const wallEl = ref(null)
const isMobile = ref(false)
const mode = computed(() => (isMobile.value ? 'mobile' : 'desktop'))
// Arranging is desktop-only: on Android tiles are lazy, stacked, and a tap opens the site.
const arrangeable = computed(() => !isMobile.value)

const nonEmptyFeedGroups = computed(() => props.feedGroups.filter(group =>
  props.feedSources.some(source => source.groupId === group.id)))
const tileRecords = computed(() => [
  ...props.hosts.map(host => ({ ...host, kind: 'site' })),
  ...nonEmptyFeedGroups.value.map(group => ({ ...group, kind: 'feed-group' }))
])

// Rendered in a stable order and positioned absolutely. Reordering the DOM would reparent each
// moved tile's <iframe>, and Firefox reloads an iframe when it is reparented.
const tiles = computed(() => domOrder(tileRecords.value))

const wallWidth = ref(0)
const gap = ref(14)
const gesture = ref(null) // 'drag' | 'resize' while a pointer gesture is in flight
const activeId = ref(null)
const preview = ref(null) // the candidate wall during a gesture, before it is persisted

// The stored arrangement, with anything unpositioned given a slot.
const stored = computed(() => normalizeLayout(tileRecords.value, props.settings?.cardMinWidth))
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
  await setTileLayouts(byId).catch(() => { preview.value = null })
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

// ---- paced preview loading -------------------------------------------------------------------
// Tiles are loaded one at a time rather than all on the same tick. Each tile starts when the
// previous one reports it finished, or after `stepDelay` if it is still going — so a wall of quick
// sites comes round fast while a slow one can never hold the sweep up for long. This covers the
// FIRST load too, not just the periodic refresh: preview refresh is off by default, so opening the
// dashboard was the burst most people actually saw.
const previewMs = computed(() => (Number(props.settings?.previewIntervalMinutes) || 0) * 60000)
const reloadNonces = ref({})
let timer = null
let sweepId = 0 // bumped to abandon a sweep in flight
let sweeping = false
let step = null // the tile the current sweep is waiting on

function tilesInReadingOrder ({ sitesOnly = false } = {}) {
  const sites = new Set(props.hosts.map(host => host.id))
  return wall.value.slice()
    .sort((a, b) => (a.y - b.y) || (a.x - b.x))
    .map(t => t.id)
    .filter(id => !sitesOnly || sites.has(id))
}

// Resolves when this tile reports it loaded, or when its step elapses — whichever comes first.
function waitForTile (id, ms) {
  return new Promise((resolve) => {
    const finish = () => { clearTimeout(timeout); step = null; resolve() }
    const timeout = setTimeout(finish, ms)
    step = { id, finish }
  })
}

function onTileLoaded (id) {
  if (step?.id === id) step.finish()
}

// One sweep at a time. `step` is shared, so a second sweep starting on top of a running one takes
// over the slot the first is waiting on: both would have a tile in flight, which is the burst this
// pacing exists to prevent. Callers that mean to REPLACE a sweep call cancelSweep() first, which
// clears the flag — so this guard only ever blocks an accidental overlap (a sweep started while the
// tab was hidden, still running when the tab came back and asked for a refresh).
async function sweep (ids) {
  if (!ids?.length || isMobile.value || sweeping) return
  const run = ++sweepId
  sweeping = true
  try {
    await pacedSweep(ids, {
      stepMs: stepDelay(ids.length, previewMs.value),
      start: (id) => {
        // A ref holding an object is a deep reactive proxy, so assigning a key — including a new
        // one — is reactive without rebuilding the whole map on every tile.
        reloadNonces.value[id] = (reloadNonces.value[id] || 0) + 1
      },
      waitForDone: waitForTile,
      // Superseded by a newer sweep, or no longer a desktop wall.
      cancelled: () => run !== sweepId || isMobile.value
    })
  } finally {
    if (run === sweepId) {
      sweeping = false
      sweepNewTiles() // pick up anything added while this sweep was running
    }
  }
}

function cancelSweep () {
  sweepId++
  step?.finish()
  // The abandoned run's `finally` sees a bumped sweepId and skips its own cleanup, so clear the flag
  // here — otherwise `sweeping` stays true for good and blocks every later sweep.
  sweeping = false
}

// A nonce means "this card has been told to load", which only holds while the card is the same
// instance. Drop the entry for anything not currently mounted, so a site removed and added again is
// swept afresh rather than looking like it had already loaded.
function pruneNonces () {
  const live = new Set(tiles.value.map(t => t.id))
  const kept = {}
  for (const [id, nonce] of Object.entries(reloadNonces.value)) if (live.has(id)) kept[id] = nonce
  if (Object.keys(kept).length !== Object.keys(reloadNonces.value).length) reloadNonces.value = kept
}

// Load whatever has never been loaded — the whole wall on open, or just a newly added site.
// Several triggers land on the first render (mode resolution, the tile list arriving), so this must
// not start a second sweep on top of a running one: that put two tiles in flight at once, and
// abandoned the first sweep half done.
function sweepNewTiles () {
  if (isMobile.value || sweeping) return
  const fresh = tilesInReadingOrder().filter(id => !reloadNonces.value[id])
  if (fresh.length) sweep(fresh)
}

function startTimer () {
  if (timer) { clearInterval(timer); timer = null }
  // Desktop "wall": auto-refresh the live previews on the configured cadence — but only while this
  // tab is visible, and only when the user has turned preview refresh on (>= 1 min).
  if (!isMobile.value && !document.hidden && previewMs.value >= 60000) {
    // A sweep always fits inside its interval (stepDelay guarantees it), so a refresh never
    // lands on one still running — but skip rather than restart if it somehow does.
    timer = setInterval(() => { if (!sweeping) sweep(tilesInReadingOrder({ sitesOnly: true })) }, previewMs.value)
  }
}

// Pause refreshing while the tab is backgrounded; refresh once on return — but only when preview
// refresh is on. Keeps multiple open dashboards from each reloading the monitored hosts when you
// aren't looking at them.
function onVisibility () {
  if (document.hidden) {
    if (timer) { clearInterval(timer); timer = null }
    cancelSweep()
    return
  }
  if (isMobile.value) return
  if (previewMs.value >= 60000) {
    sweep(tilesInReadingOrder({ sitesOnly: true }))
    startTimer()
  } else {
    // Refresh is off, but hiding the tab may have cancelled the initial sweep part-way. Finish it,
    // or those tiles sit on "Waiting to load…" for the life of the page.
    sweepNewTiles()
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
  nextTick(() => { syncWall(); sweepNewTiles() })
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
// The wall element lives behind v-if on the host list, which is empty on the first mount. A newly
// added site joins the paced sweep rather than loading the instant it appears.
watch(() => tiles.value.map(t => t.id).join('|'), () => nextTick(() => {
  pruneNonces()
  syncWall()
  sweepNewTiles()
}))
// The wall is keyed by mode, so switching layout remounts every HostCard and it loses its iframe.
// Their surviving nonces would read as "already loaded" — and a remounted card never sees its
// initial prop change, so nothing would tell it to load. Start the new cards from nothing.
watch(mode, () => {
  cancelSweep()
  reloadNonces.value = {}
  nextTick(() => { syncWall(); sweepNewTiles() })
})
watch(() => props.settings?.previewIntervalMinutes, startTimer)
watch(() => props.settings?.mode, resolveMode)

onBeforeUnmount(() => {
  if (timer) clearInterval(timer)
  document.removeEventListener('visibilitychange', onVisibility)
  removeGestureListeners(onDragMove, onDragEnd)
  removeGestureListeners(onResizeMove, onResizeEnd)
  wallObserver?.disconnect()
  cancelSweep()
})
</script>

<template>
  <div>
    <div
      v-if="!tiles.length"
      class="empty"
    >
      No tiles yet — add a website or feed from the <strong>Sites</strong> or <strong>Feeds</strong> tab.
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
      <template
        v-for="tile in tiles"
        :key="tile.id"
      >
        <HostCard
          v-if="tile.kind === 'site'"
          :data-tile-id="tile.id"
          :class="{ active: activeId === tile.id }"
          :style="arrangeable ? tileStyle(tile) : null"
          :host="tile"
          :result="results[tile.id] || {}"
          :mode="mode"
          :arrangeable="arrangeable"
          :reload-nonce="reloadNonces[tile.id] || 0"
          @dragstart="onDragStart"
          @resizestart="onResizeStart"
          @loaded="onTileLoaded"
        />
        <FeedGroupCard
          v-else
          :data-tile-id="tile.id"
          :class="{ active: activeId === tile.id }"
          :style="arrangeable ? tileStyle(tile) : null"
          :group="tile"
          :sources="feedSources.filter(source => source.groupId === tile.id)"
          :caches="feedCaches"
          :mode="mode"
          :arrangeable="arrangeable"
          :reload-nonce="reloadNonces[tile.id] || 0"
          :polling-enabled="!!settings.feedPollingEnabled"
          :saved-ids="savedIds"
          @dragstart="onDragStart"
          @resizestart="onResizeStart"
          @loaded="onTileLoaded"
          @play="emit('play', $event)"
        />
      </template>
    </div>
  </div>
</template>
