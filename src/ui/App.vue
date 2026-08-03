<script setup>
import { ref, onMounted, onBeforeUnmount, computed } from 'vue'
import { browser } from '@/lib/browser.js'
import {
  getHosts, getAllResults, getSettings, getFeedGroups, getFeedSources, getFeedCaches,
  getFeedReadStates, getReadLater, onChanged, entryLabel
} from '@/lib/storage.js'
import { isCertExpiringSoon, isLoadSlow, isStale } from '@/lib/thresholds.js'
import MonitorGrid from './components/MonitorGrid.vue'
import HostList from './components/HostList.vue'
import FeedList from './components/FeedList.vue'
import AddHostForm from './components/AddHostForm.vue'
import SettingsPanel from './components/SettingsPanel.vue'
import ReadLaterList from './components/ReadLaterList.vue'
import PodcastPlayer from './components/PodcastPlayer.vue'

const props = defineProps({ view: { type: String, default: 'dashboard' } })

const hosts = ref([])
const results = ref({})
const settings = ref({})
const feedGroups = ref([])
const feedSources = ref([])
const feedCaches = ref({})
const feedReadStates = ref({})
const readLater = ref([])
const activePodcast = ref(null)
const tab = ref('monitor')
const isPopup = computed(() => props.view === 'popup')
const nonEmptyFeedGroups = computed(() => feedGroups.value.filter(group =>
  feedSources.value.some(source => source.groupId === group.id)))
const savedIds = computed(() => new Set(readLater.value.map(item => item.id)))

async function refresh () {
  const [h, r, s, groups, sources, saved] = await Promise.all([
    getHosts(), getAllResults(), getSettings(), getFeedGroups(), getFeedSources(), getReadLater()
  ])
  const [caches, readStates] = await Promise.all([
    getFeedCaches(sources.map(source => source.id)),
    getFeedReadStates(sources.map(source => source.id))
  ])
  hosts.value = h
  results.value = r
  settings.value = s
  feedGroups.value = groups
  feedSources.value = sources
  feedCaches.value = caches
  feedReadStates.value = readStates
  readLater.value = saved
}

function applyStorageChanges (changes) {
  if (changes.hosts) hosts.value = changes.hosts.newValue || []
  if (changes.feedGroups) feedGroups.value = changes.feedGroups.newValue || []
  if (changes.feedSources) feedSources.value = changes.feedSources.newValue || []
  if (changes.settings) getSettings().then(value => { settings.value = value })
  if (changes.readLater) readLater.value = changes.readLater.newValue || []

  let nextResults = null
  let nextCaches = null
  let nextReadStates = null
  for (const [key, change] of Object.entries(changes)) {
    if (key.startsWith('result:')) {
      nextResults ||= { ...results.value }
      const id = key.slice('result:'.length)
      if (change.newValue == null) delete nextResults[id]
      else nextResults[id] = change.newValue
    } else if (key.startsWith('feed-cache:')) {
      nextCaches ||= { ...feedCaches.value }
      const id = key.slice('feed-cache:'.length)
      if (change.newValue == null) delete nextCaches[id]
      else nextCaches[id] = change.newValue
    } else if (key.startsWith('feed-read:')) {
      nextReadStates ||= { ...feedReadStates.value }
      const id = key.slice('feed-read:'.length)
      if (change.newValue == null) delete nextReadStates[id]
      else nextReadStates[id] = change.newValue
    }
  }
  if (nextResults) results.value = nextResults
  if (nextCaches) feedCaches.value = nextCaches
  if (nextReadStates) feedReadStates.value = nextReadStates

  // Only the one-time legacy migration touches the old monolithic results key.
  if (changes.results) getAllResults().then(value => { results.value = value })
}

let stopChanges = null
onMounted(async () => {
  await refresh()
  stopChanges = onChanged(applyStorageChanges)
})
onBeforeUnmount(() => { stopChanges?.() })

function openDashboard () {
  browser.tabs.create({ url: browser.runtime.getURL('dashboard.html') })
  window.close()
}
function openSite (host) { browser.tabs.create({ url: host.url }) }

function label (host) { return entryLabel(host) }
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
        >{{ label(host) }}</span>
        <span class="popup-load">{{ loadText(host) }}</span>
      </div>
      <div
        v-for="group in nonEmptyFeedGroups"
        :key="group.id"
        class="host-row"
        @click="openDashboard"
      >
        <span class="feed-dot">FEED</span>
        <span class="name">{{ group.name }}</span>
        <span class="popup-load">{{ feedSources.filter(source => source.groupId === group.id).length }} feeds</span>
      </div>
    </div>
  </div>

  <!-- Dashboard / new-tab page -->
  <div
    v-else
    class="app"
    :class="{ 'has-player': activePodcast }"
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
          Sites
        </button>
        <button
          class="tab"
          :class="{ active: tab === 'feeds' }"
          @click="tab = 'feeds'"
        >
          Feeds
        </button>
        <button
          class="tab"
          :class="{ active: tab === 'read-later' }"
          @click="tab = 'read-later'"
        >
          Read Later<span v-if="readLater.length"> ({{ readLater.length }})</span>
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
      <span class="popup-load">{{ hosts.length }} sites · {{ nonEmptyFeedGroups.length }} feed groups</span>
    </div>

    <MonitorGrid
      v-show="tab === 'monitor'"
      :hosts="hosts"
      :feed-groups="feedGroups"
      :feed-sources="feedSources"
      :feed-caches="feedCaches"
      :feed-read-states="feedReadStates"
      :results="results"
      :settings="settings"
      :saved-ids="savedIds"
      @play="activePodcast = $event"
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
    <div v-show="tab === 'feeds'">
      <FeedList
        :groups="feedGroups"
        :sources="feedSources"
        :caches="feedCaches"
        :polling-enabled="!!settings.feedPollingEnabled"
      />
    </div>
    <div v-show="tab === 'read-later'">
      <ReadLaterList
        :items="readLater"
        @play="activePodcast = $event"
      />
    </div>
    <div v-show="tab === 'settings'">
      <SettingsPanel :settings="settings" />
    </div>
    <PodcastPlayer
      v-if="activePodcast?.audio"
      :item="activePodcast"
      @close="activePodcast = null"
    />
  </div>
</template>
