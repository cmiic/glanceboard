<script setup>
import { ref, onMounted, computed } from 'vue'
import { browser } from '@/lib/browser.js'
import { getHosts, getAllResults, getSettings, onChanged } from '@/lib/storage.js'
import { isCertExpiringSoon, isLoadSlow, isStale } from '@/lib/thresholds.js'
import MonitorGrid from './components/MonitorGrid.vue'
import HostList from './components/HostList.vue'
import AddHostForm from './components/AddHostForm.vue'
import SettingsPanel from './components/SettingsPanel.vue'

const props = defineProps({ view: { type: String, default: 'dashboard' } })

const hosts = ref([])
const results = ref({})
const settings = ref({})
const tab = ref('monitor')
const isPopup = computed(() => props.view === 'popup')

async function refresh () {
  const [h, r, s] = await Promise.all([getHosts(), getAllResults(), getSettings()])
  hosts.value = h
  results.value = r
  settings.value = s
}

onMounted(async () => {
  await refresh()
  onChanged(() => { refresh() })
})

function openDashboard () {
  const path = browser.runtime.getManifest().chrome_url_overrides?.newtab
  if (path) browser.tabs.create({ url: browser.runtime.getURL(path) })
  window.close()
}
function openSite (host) { browser.tabs.create({ url: host.url }) }

function statusClass (host) {
  const r = results.value[host.id]
  if (!r) return ''
  if (r.ok === false) return 'bad'
  const bad = isCertExpiringSoon(r.certExpiresInDays?.[0]) ||
    isLoadSlow(r.elapsed?.[0]) ||
    isStale(r.lastTimestamp)
  return bad ? 'bad' : 'ok'
}
function loadText (host) {
  const r = results.value[host.id]
  const ms = r?.elapsed?.[0]
  if (typeof ms === 'number') return ms + ' ms'
  return r?.ok === false ? 'down' : '—'
}
</script>

<template>
  <!-- Popup: compact status list -->
  <div
    v-if="isPopup"
    class="popup"
  >
    <div
      class="app-header"
      style="margin-bottom: 10px"
    >
      <span class="app-title">Glance<span class="tld">board</span></span>
      <span class="spacer" />
      <button
        class="btn btn-sm btn-primary"
        @click="openDashboard"
      >
        Open dashboard
      </button>
    </div>
    <AddHostForm />
    <div style="margin-top: 10px">
      <div
        v-for="host in hosts"
        :key="host.id"
        class="host-row"
        @click="openSite(host)"
      >
        <span
          class="dot"
          :class="statusClass(host)"
        />
        <span
          class="name"
          :title="host.url"
        >{{ host.hostname }}</span>
        <span class="popup-load">{{ loadText(host) }}</span>
      </div>
    </div>
  </div>

  <!-- Dashboard / new-tab page -->
  <div
    v-else
    class="app"
  >
    <div class="app-header">
      <h1 class="app-title">
        Glance<span class="tld">board</span>
      </h1>
      <div class="tabs">
        <button
          class="tab"
          :class="{ active: tab === 'monitor' }"
          @click="tab = 'monitor'"
        >
          Monitor
        </button>
        <button
          class="tab"
          :class="{ active: tab === 'hosts' }"
          @click="tab = 'hosts'"
        >
          Hosts
        </button>
        <button
          class="tab"
          :class="{ active: tab === 'settings' }"
          @click="tab = 'settings'"
        >
          Settings
        </button>
      </div>
      <span class="spacer" />
      <span class="popup-load">{{ hosts.length }} hosts</span>
    </div>

    <MonitorGrid
      v-show="tab === 'monitor'"
      :hosts="hosts"
      :results="results"
      :settings="settings"
    />
    <div
      v-show="tab === 'hosts'"
      style="max-width: 680px"
    >
      <HostList
        :hosts="hosts"
        :results="results"
      />
    </div>
    <div v-show="tab === 'settings'">
      <SettingsPanel :settings="settings" />
    </div>
  </div>
</template>
