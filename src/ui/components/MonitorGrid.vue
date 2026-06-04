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
let timer = null

function setupTimer () {
  if (timer) { clearInterval(timer); timer = null }
  // Desktop "wall": auto-refresh every ~2 min. Mobile refreshes manually (per-card).
  if (!isMobile.value) timer = setInterval(() => { reloadNonce.value++ }, 120000)
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
  setupTimer()
}

onMounted(resolveMode)
// React to a layout-mode change from Settings without needing a reload.
watch(() => props.settings?.mode, resolveMode)
onBeforeUnmount(() => { if (timer) clearInterval(timer) })
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
        v-for="(host, i) in hosts"
        :key="host.id"
        :host="host"
        :result="results[host.id] || {}"
        :index="i"
        :mode="mode"
        :reload-nonce="reloadNonce"
      />
    </div>
  </div>
</template>
