<script setup>
import { ref, onMounted, onBeforeUnmount, computed, watch } from 'vue'
import { browser } from '@/lib/browser.js'
import HostCard from './HostCard.vue'

const props = defineProps({
  hosts: { type: Array, default: () => [] },
  results: { type: Object, default: () => ({}) },
  settings: { type: Object, default: () => ({}) }
})

const isMobile = ref(false)
const reloadNonce = ref(0)
const mode = computed(() => (isMobile.value ? 'mobile' : 'desktop'))
const gridStyle = computed(() => ({
  gridTemplateColumns: `repeat(auto-fill, minmax(${props.settings?.cardMinWidth || 320}px, 1fr))`
}))
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

onMounted(() => {
  resolveMode()
  document.addEventListener('visibilitychange', onVisibility)
})
// React to a layout-mode change from Settings without needing a reload.
watch(() => props.settings?.mode, resolveMode)
// Restart the wall timer live when the preview-refresh setting changes.
watch(() => props.settings?.previewIntervalMinutes, startTimer)
onBeforeUnmount(() => {
  if (timer) clearInterval(timer)
  document.removeEventListener('visibilitychange', onVisibility)
})
</script>

<template>
  <div>
    <div
      v-if="!hosts.length"
      class="empty"
    >
      No hosts yet — add one from the <strong>Hosts</strong> tab.
    </div>
    <!-- key by mode so cards remount cleanly when the layout mode is switched -->
    <div
      v-else
      :key="mode"
      class="grid"
      :style="gridStyle"
    >
      <HostCard
        v-for="host in hosts"
        :key="host.id"
        :host="host"
        :result="results[host.id] || {}"
        :mode="mode"
        :reload-nonce="reloadNonce"
      />
    </div>
  </div>
</template>
