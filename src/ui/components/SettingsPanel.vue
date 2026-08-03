<script setup>
import { ref, watch } from 'vue'
import { browser } from '@/lib/browser.js'
import {
  setSettings, getHosts, addHost, setAllHostsMetric, resetTileLayouts,
  getFeedGroups, getFeedSources, getReadLater, createFeedGroup, addFeedSources, mergeReadLater,
  previewReadLaterMerge, getFeedReadStates, mergeFeedReadState
} from '@/lib/storage.js'
import { normalizeTarget } from '@/lib/url.js'
import { buildExportDocument, normalizeImportFeed, parseImportDocument } from '@/lib/backup.js'
import { feedGroupNameKey } from '@/lib/feed-settings.js'

const props = defineProps({ settings: { type: Object, default: () => ({}) } })

const cardMinWidth = ref(props.settings.cardMinWidth ?? 320)
const intervalMinutes = ref(props.settings.intervalMinutes ?? 0)
const previewIntervalMinutes = ref(props.settings.previewIntervalMinutes ?? 0)
const feedPollingEnabled = ref(!!props.settings.feedPollingEnabled)
const mode = ref(props.settings.mode ?? 'auto')
const notificationsEnabled = ref(!!props.settings.notificationsEnabled)
const defCert = ref(!!props.settings.metricDefaults?.cert)
const defLoad = ref(!!props.settings.metricDefaults?.load)

// Keep controls in sync if settings change elsewhere.
watch(() => props.settings, (s) => {
  if (!s) return
  if (typeof s.cardMinWidth === 'number') cardMinWidth.value = s.cardMinWidth
  if (typeof s.intervalMinutes === 'number') intervalMinutes.value = s.intervalMinutes
  if (typeof s.previewIntervalMinutes === 'number') previewIntervalMinutes.value = s.previewIntervalMinutes
  feedPollingEnabled.value = !!s.feedPollingEnabled
  if (s.mode) mode.value = s.mode
  notificationsEnabled.value = !!s.notificationsEnabled
  defCert.value = !!s.metricDefaults?.cert
  defLoad.value = !!s.metricDefaults?.load
}, { deep: true })

function saveCardWidth () { setSettings({ cardMinWidth: Number(cardMinWidth.value) }) }
function saveInterval () { setSettings({ intervalMinutes: Number(intervalMinutes.value) }) }
function savePreviewInterval () { setSettings({ previewIntervalMinutes: Number(previewIntervalMinutes.value) }) }
function saveFeedPolling () { setSettings({ feedPollingEnabled: feedPollingEnabled.value }) }
function saveMode () { setSettings({ mode: mode.value }) }
function saveNotifications () { setSettings({ notificationsEnabled: notificationsEnabled.value }) }
function saveDefaults () { setSettings({ metricDefaults: { cert: defCert.value, load: defLoad.value } }) }
function applyAll (key, value) { setAllHostsMetric(key, value) }

// Drops the whole arrangement: position AND size, since a tile's layout is one { x, y, w, h }.
const layoutReset = ref(false)
async function resetLayout () {
  await resetTileLayouts()
  layoutReset.value = true
  setTimeout(() => { layoutReset.value = false }, 2000)
}

// The dashboard is a normal extension page (no new-tab override). Expose its URL so the user can
// set it as their Firefox homepage / new-windows page if they want.
const dashboardUrl = browser.runtime.getURL('dashboard.html')
const copied = ref(false)
async function copyUrl () {
  try {
    await navigator.clipboard.writeText(dashboardUrl)
    copied.value = true
    setTimeout(() => { copied.value = false }, 1500)
  } catch { /* clipboard may be unavailable */ }
}

// ---- export / import sites and feeds ----
const pending = ref(null)
const importError = ref('')
const importNotice = ref('')

async function exportHosts () {
  const [hosts, groups, sources, saved] = await Promise.all([getHosts(), getFeedGroups(), getFeedSources(), getReadLater()])
  const readStates = await getFeedReadStates(sources.map(source => source.id))
  const backup = buildExportDocument(hosts, groups, sources, saved, readStates)
  const blob = new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = 'glanceboard-data.json'
  a.click()
  // Defer the revoke so it doesn't abort the download before it starts.
  setTimeout(() => URL.revokeObjectURL(url), 10000)
}

function onFile (e) {
  importError.value = ''
  importNotice.value = ''
  const file = e.target.files?.[0]
  e.target.value = '' // allow re-picking the same file
  if (!file) return
  const reader = new FileReader()
  reader.onload = async () => {
    let imported
    try {
      const parsed = JSON.parse(String(reader.result))
      const { sites, feedGroups, readLater, feedReadState } = parseImportDocument(parsed)
      if (!sites.length && !feedGroups.length && !readLater.length && !feedReadState.length) {
        importError.value = 'No sites, feed groups, saved items, or read markers found in file'
        pending.value = null
        return
      }
      imported = { sites, feedGroups, readLater, feedReadState }
    } catch {
      importError.value = 'Invalid JSON file'
      pending.value = null
      return
    }
    try {
      // File inspection is outside the later confirmation click, so this storage round-trip cannot
      // consume the user gesture Firefox requires for permissions.request().
      if (imported.readLater.length) await previewReadLaterMerge(imported.readLater)
      pending.value = imported
    } catch (error) {
      importError.value = error?.message || String(error)
      pending.value = null
    }
  }
  reader.readAsText(file)
}

async function doImport () {
  if (!pending.value) return
  const validSites = pending.value.sites.filter(url => normalizeTarget(url))
  const validGroups = pending.value.feedGroups.map(group => ({
    ...group,
    feeds: group.feeds.map(normalizeImportFeed).filter(Boolean)
  }))
  const feedCount = validGroups.reduce((count, group) => count + group.feeds.length, 0)
  const skipped = pending.value.sites.length - validSites.length +
    pending.value.feedGroups.reduce((count, group) => count + group.feeds.length, 0) - feedCount
  if (!validSites.length && !validGroups.length && !pending.value.readLater.length && !pending.value.feedReadState.length) {
    importError.value = 'No valid sites, feeds, saved items, or read markers found in the file'
    return
  }
  const origins = [...new Set([
    ...validSites.map(url => normalizeTarget(url).originPattern),
    ...validGroups.flatMap(group => group.feeds.map(feed => normalizeTarget(feed.url).originPattern))
  ])]
  try {
    // Deliberately the first awaited operation in this click handler: Firefox requires optional
    // permission requests to remain tied to the user's confirmation gesture.
    const granted = !origins.length || await browser.permissions.request({ origins })
    if (!granted) { importError.value = 'Permission is needed to import these sites and feeds'; return }
    for (const url of validSites) await addHost(url).catch(() => {})
    let currentGroups = await getFeedGroups()
    for (const imported of validGroups) {
      const importedNameKey = feedGroupNameKey(imported.name)
      let group = currentGroups.find(item => feedGroupNameKey(item.name) === importedNameKey)
      if (!group) {
        group = await createFeedGroup(imported.name, { itemFilter: imported.itemFilter })
        currentGroups = await getFeedGroups()
      }
      if (imported.feeds.length) await addFeedSources(imported.feeds, { groupId: group.id })
    }
    if (pending.value.readLater.length) await mergeReadLater(pending.value.readLater)
    const readResult = pending.value.feedReadState.length
      ? await mergeFeedReadState(pending.value.feedReadState)
      : { importedCount: 0 }
    importError.value = ''
    importNotice.value = `Imported ${validSites.length} site(s), ${feedCount} feed(s), ${validGroups.length} group(s), ${pending.value.readLater.length} saved item(s), and ${readResult.importedCount} read marker(s)` +
      (skipped ? `; skipped ${skipped} invalid` : '')
    pending.value = null
  } catch (e) {
    importError.value = e?.message || String(e)
  }
}
</script>

<template>
  <div class="settings">
    <div class="card setting">
      <label class="setting-label">Open / home page</label>
      <p
        class="popup-load"
        style="margin: 0"
      >
        Open Glanceboard from its toolbar button. To use it as your Firefox homepage / new windows,
        copy this address and paste it into Firefox Settings → Home → “Homepage and new windows” →
        Custom URLs:
      </p>
      <div class="field">
        <input
          class="input"
          style="flex: 1; min-width: 200px"
          :value="dashboardUrl"
          readonly
          @focus="$event.target.select()"
        >
        <button
          class="btn"
          type="button"
          @click="copyUrl"
        >
          {{ copied ? 'Copied' : 'Copy' }}
        </button>
      </div>
      <p class="popup-load">
        Your new-tab page (Ctrl+T) is left untouched — Glanceboard does not override it.
      </p>
    </div>
    <div class="card setting">
      <label class="setting-label">Background checks</label>
      <select
        v-model="intervalMinutes"
        class="input"
        @change="saveInterval"
      >
        <option :value="0">
          Off — no background checks
        </option>
        <option :value="1">
          Every minute
        </option>
        <option :value="2">
          Every 2 minutes
        </option>
        <option :value="5">
          Every 5 minutes
        </option>
        <option :value="10">
          Every 10 minutes
        </option>
        <option :value="15">
          Every 15 minutes
        </option>
        <option :value="30">
          Every 30 minutes
        </option>
        <option :value="60">
          Every hour
        </option>
      </select>
      <p class="popup-load">
        Off by default — nothing is fetched in the background. Previews and metrics still update when you
        open the dashboard. Turn this on only for sites where periodic checking is appropriate. Each entry
        is checked separately, so several pages of one host mean several requests per cycle — spaced a
        couple of seconds apart, or closer together if that wouldn't fit the interval.
      </p>
    </div>

    <div class="card setting">
      <label class="setting-label">Preview refresh</label>
      <select
        v-model="previewIntervalMinutes"
        class="input"
        @change="savePreviewInterval"
      >
        <option :value="0">
          Off — load once on open
        </option>
        <option :value="1">
          Every minute
        </option>
        <option :value="2">
          Every 2 minutes
        </option>
        <option :value="5">
          Every 5 minutes
        </option>
        <option :value="10">
          Every 10 minutes
        </option>
        <option :value="15">
          Every 15 minutes
        </option>
        <option :value="30">
          Every 30 minutes
        </option>
        <option :value="60">
          Every hour
        </option>
      </select>
      <p class="popup-load">
        Off by default — the open dashboard loads each live preview once. Turn this on to auto-reload
        the previews while the dashboard is open (desktop layout only). Previews load one at a time,
        each starting when the previous finishes (or after up to 2 seconds), so the sites are never
        all requested at once.
      </p>
    </div>

    <div class="card setting">
      <label class="setting-label">
        <input
          v-model="feedPollingEnabled"
          type="checkbox"
          @change="saveFeedPolling"
        >
        Refresh feeds in the background
      </label>
      <p class="popup-load">
        Off by default. When enabled, each feed follows its Auto, fixed-interval, or Off setting.
        Auto adapts between hourly and daily checks from the feed's recent publication cadence.
        Opening the dashboard then refreshes only missing or scheduled-due feeds; a tile's refresh
        button always checks it immediately. Background refresh updates cached items but does not
        send notifications. A per-feed Off choice disables scheduled background checks only; the
        feed is still checked when the dashboard opens or you refresh its tile.
      </p>
    </div>

    <div class="card setting">
      <label class="setting-label">Metrics</label>
      <p
        class="popup-load"
        style="margin: 0"
      >
        Show by default on newly added sites:
      </p>
      <label
        class="setting-label"
        style="font-weight: 400"
      >
        <input
          v-model="defCert"
          type="checkbox"
          @change="saveDefaults"
        >
        Certificate expiry
      </label>
      <label
        class="setting-label"
        style="font-weight: 400"
      >
        <input
          v-model="defLoad"
          type="checkbox"
          @change="saveDefaults"
        >
        Load time
      </label>
      <p
        class="popup-load"
        style="margin: 8px 0 0"
      >
        Apply to all current sites:
      </p>
      <div class="field">
        <span
          class="popup-load"
          style="width: 64px"
        >Cert</span>
        <button
          class="btn btn-sm"
          @click="applyAll('cert', true)"
        >
          Show all
        </button>
        <button
          class="btn btn-sm"
          @click="applyAll('cert', false)"
        >
          Hide all
        </button>
      </div>
      <div class="field">
        <span
          class="popup-load"
          style="width: 64px"
        >Load</span>
        <button
          class="btn btn-sm"
          @click="applyAll('load', true)"
        >
          Show all
        </button>
        <button
          class="btn btn-sm"
          @click="applyAll('load', false)"
        >
          Hide all
        </button>
      </div>
    </div>

    <div class="card setting">
      <label class="setting-label">
        <input
          v-model="notificationsEnabled"
          type="checkbox"
          @change="saveNotifications"
        >
        Notify when a host goes down
      </label>
      <p class="popup-load">
        Local notification on an ok→error transition (only fires while checks are on).
      </p>
    </div>

    <div class="card setting">
      <label class="setting-label">Card size (min width): {{ cardMinWidth }}px</label>
      <input
        v-model="cardMinWidth"
        type="range"
        min="240"
        max="640"
        step="20"
        @change="saveCardWidth"
      >
      <p class="popup-load">
        Sets the starting width of new tiles. On desktop you can then drag a tile by its title bar to
        put it anywhere on the wall — including below a taller tile — and drag its right or bottom edge
        (or the bottom-right corner) to size it. A taller tile shows more of the page.
      </p>
      <div class="field">
        <button
          class="btn btn-sm"
          @click="resetLayout"
        >
          Reset tile layout
        </button>
        <span
          v-if="layoutReset"
          class="popup-load"
        >Tiles are back to automatic position and size</span>
      </div>
    </div>

    <div class="card setting">
      <label class="setting-label">Layout</label>
      <select
        v-model="mode"
        class="input"
        @change="saveMode"
      >
        <option value="auto">
          Auto (detect device)
        </option>
        <option value="desktop">
          Desktop — all previews live
        </option>
        <option value="mobile">
          Mobile — lazy + tap to open
        </option>
      </select>
    </div>

    <div class="card setting">
      <label class="setting-label">Sites and feeds</label>
      <div class="field">
        <button
          class="btn"
          @click="exportHosts"
        >
          Export
        </button>
        <label class="btn">
          Import…
          <input
            type="file"
            accept="application/json"
            style="display: none"
            @change="onFile"
          >
        </label>
      </div>
      <div
        v-if="pending"
        style="margin-top: 8px"
      >
        <button
          class="btn btn-primary"
          @click="doImport"
        >
          Grant &amp; import {{ pending.sites.length }} site(s) and
          {{ pending.feedGroups.reduce((count, group) => count + group.feeds.length, 0) }} feed(s),
          {{ pending.readLater.length }} saved item(s),
          {{ pending.feedReadState.reduce((count, entry) => count + entry.items.length, 0) }} read marker(s)
        </button>
      </div>
      <span
        v-if="importError"
        class="error-text"
      >{{ importError }}</span>
      <span
        v-if="importNotice"
        class="popup-load"
      >{{ importNotice }}</span>
    </div>
  </div>
</template>

<style scoped>
.settings { max-width: 480px; display: flex; flex-direction: column; gap: 12px; }
.setting { padding: 14px 16px; gap: 6px; }
.setting-label { font-weight: 600; display: flex; align-items: center; gap: 8px; }
.setting input[type="range"] { width: 100%; }
.setting .popup-load { margin: 4px 0 0; }
</style>
