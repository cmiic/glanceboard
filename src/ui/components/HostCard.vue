<script setup>
import { ref, computed, onMounted, onBeforeUnmount, watch } from 'vue'
import LineChart from './LineChart.vue'
import { isCertExpiringSoon, isLoadSlow, isStale } from '@/lib/thresholds.js'
import { pushResult } from '@/lib/storage.js'

const props = defineProps({
  host: { type: Object, required: true },
  result: { type: Object, default: () => ({}) },
  index: { type: Number, default: 0 },
  mode: { type: String, default: 'desktop' }, // 'desktop' | 'mobile'
  reloadNonce: { type: Number, default: 0 }
})

const cardEl = ref(null)
const previewBox = ref(null)
const frameSrc = ref('')
const loadStart = ref(0)
const scale = ref(0.25)
const previewHeight = ref(200)
const frameKey = ref(0)
const hovered = ref(false)

const latest = computed(() => {
  const r = props.result || {}
  return {
    elapsed: r.elapsed?.[0] ?? null,
    cert: r.certExpiresInDays?.[0] ?? null,
    timestamp: r.lastTimestamp ?? r.timestamp?.[0] ?? null,
    ok: r.ok !== false,
    error: r.error || null
  }
})
const certBad = computed(() => isCertExpiringSoon(latest.value.cert))
const loadBad = computed(() => isLoadSlow(latest.value.elapsed))
const staleBad = computed(() => isStale(latest.value.timestamp))
const hasError = computed(() => latest.value.ok === false)
const showChart = computed(() => (props.result?.elapsed || []).filter(v => typeof v === 'number').length > 1)
const lastCheckText = computed(() =>
  latest.value.timestamp ? new Date(latest.value.timestamp).toLocaleTimeString() : '—')

function applyScale () {
  const w = previewBox.value?.clientWidth || 320
  scale.value = w / 1280
  previewHeight.value = Math.round(800 * scale.value)
}
function loadPreview () {
  loadStart.value = performance.now()
  frameSrc.value = props.host.url
  // Recreate the iframe (via :key) so a manual/auto refresh reloads even when the URL is
  // unchanged — and without a cache-buster query param that would confuse site service workers.
  frameKey.value++
}
async function onFrameLoad () {
  if (!frameSrc.value) return
  // The iframe did a real navigation, so this is full-page load time (better than the fetch proxy).
  await pushResult(props.host.id, {
    ok: true, elapsed: Math.round(performance.now() - loadStart.value),
    timestamp: Date.now(), certExpiresInDays: null, source: 'iframe'
  }).catch(() => {})
}
function openSite () { window.open(props.host.url, '_blank', 'noopener') }

let ro = null
let io = null
onMounted(() => {
  applyScale()
  if (previewBox.value && 'ResizeObserver' in window) {
    ro = new ResizeObserver(applyScale)
    ro.observe(previewBox.value)
  }
  if (props.mode === 'mobile') {
    // Lazy: only render the live preview once the card scrolls into view.
    io = new IntersectionObserver((entries) => {
      for (const e of entries) {
        if (e.isIntersecting && !frameSrc.value) loadPreview()
      }
    }, { rootMargin: '150px' })
    if (cardEl.value) io.observe(cardEl.value)
  } else {
    loadPreview()
  }
})
onBeforeUnmount(() => { ro?.disconnect(); io?.disconnect() })

// Desktop "wall" auto-refresh, or manual refresh, bumps the nonce. Defer an auto-refresh while the
// tile is hovered so it doesn't interrupt interaction with the (desktop-interactive) preview.
let pendingReload = false
watch(() => props.reloadNonce, () => {
  if (hovered.value) { pendingReload = true; return }
  if (frameSrc.value || props.mode === 'desktop') loadPreview()
})
function onMouseEnter () { hovered.value = true }
function onMouseLeave () {
  hovered.value = false
  if (pendingReload) { pendingReload = false; loadPreview() }
}
</script>

<template>
  <div
    ref="cardEl"
    class="card"
    :class="{ error: hasError }"
    @mouseenter="onMouseEnter"
    @mouseleave="onMouseLeave"
  >
    <div class="card-head">
      <span
        class="card-host"
        :title="host.url"
      >{{ host.hostname }}</span>
      <span class="card-actions">
        <button
          class="btn btn-icon btn-sm"
          type="button"
          title="Refresh preview"
          aria-label="Refresh preview"
          @click="loadPreview"
        >⟳</button>
        <button
          class="btn btn-icon btn-sm"
          type="button"
          title="Open site"
          aria-label="Open site"
          @click="openSite"
        >↗</button>
      </span>
    </div>

    <div class="metrics">
      <div
        v-if="host.metrics?.cert"
        class="metric"
        :class="{ bad: certBad }"
      >
        <div class="label">
          Cert
        </div>
        <div class="value">
          {{ latest.cert ?? '—' }}
        </div>
        <div class="unit">
          days left
        </div>
      </div>
      <div
        v-if="host.metrics?.load"
        class="metric"
        :class="{ bad: loadBad }"
      >
        <div class="label">
          Load
        </div>
        <div class="value">
          {{ latest.elapsed ?? '—' }}
        </div>
        <div class="unit">
          ms
        </div>
      </div>
      <div
        class="metric"
        :class="{ bad: staleBad }"
      >
        <div class="label">
          Last check
        </div>
        <div
          class="value"
          style="font-size: 14px"
        >
          {{ lastCheckText }}
        </div>
        <div class="unit">
&nbsp;
        </div>
      </div>
    </div>

    <div
      ref="previewBox"
      class="preview"
      :style="{ height: previewHeight + 'px' }"
    >
      <iframe
        v-if="frameSrc"
        :key="frameKey"
        :src="frameSrc"
        :style="{ transform: 'scale(' + scale + ')' }"
        sandbox="allow-scripts allow-same-origin allow-forms"
        referrerpolicy="no-referrer"
        @load="onFrameLoad"
      />
      <div
        v-else
        class="placeholder"
      >
        Scroll to load preview
      </div>
      <div
        v-if="mode === 'mobile'"
        class="overlay"
        role="button"
        tabindex="0"
        title="Open site"
        aria-label="Open site"
        @click="openSite"
        @keydown.enter="openSite"
        @keydown.space.prevent="openSite"
      />
    </div>

    <div
      v-if="showChart"
      class="chart"
    >
      <LineChart
        :id="index"
        :labels="result.timestamp"
        :elapsed="result.elapsed"
      />
    </div>

    <div
      v-if="hasError"
      class="banner"
    >
      {{ latest.error || 'Check failed' }}
    </div>
  </div>
</template>
