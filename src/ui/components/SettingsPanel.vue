<script setup>
import { ref, watch } from 'vue'
import { browser } from '@/lib/browser.js'
import { setSettings, getHosts, addHost, setAllHostsMetric } from '@/lib/storage.js'
import { normalizeHost } from '@/lib/url.js'

const props = defineProps({ settings: { type: Object, default: () => ({}) } })

const cardMinWidth = ref(props.settings.cardMinWidth ?? 320)
const intervalMinutes = ref(props.settings.intervalMinutes ?? 0)
const previewIntervalMinutes = ref(props.settings.previewIntervalMinutes ?? 0)
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
  if (s.mode) mode.value = s.mode
  notificationsEnabled.value = !!s.notificationsEnabled
  defCert.value = !!s.metricDefaults?.cert
  defLoad.value = !!s.metricDefaults?.load
}, { deep: true })

function saveCardWidth () { setSettings({ cardMinWidth: Number(cardMinWidth.value) }) }
function saveInterval () { setSettings({ intervalMinutes: Number(intervalMinutes.value) }) }
function savePreviewInterval () { setSettings({ previewIntervalMinutes: Number(previewIntervalMinutes.value) }) }
function saveMode () { setSettings({ mode: mode.value }) }
function saveNotifications () { setSettings({ notificationsEnabled: notificationsEnabled.value }) }
function saveDefaults () { setSettings({ metricDefaults: { cert: defCert.value, load: defLoad.value } }) }
function applyAll (key, value) { setAllHostsMetric(key, value) }

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

// ---- export / import host list ----
const pending = ref(null)
const importError = ref('')
const importNotice = ref('')

async function exportHosts () {
  const hosts = await getHosts()
  const blob = new Blob([JSON.stringify({ hosts: hosts.map(h => h.url) }, null, 2)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = 'glanceboard-hosts.json'
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
  reader.onload = () => {
    try {
      const parsed = JSON.parse(String(reader.result))
      const list = Array.isArray(parsed) ? parsed : parsed.hosts
      const urls = (list || []).map(h => (typeof h === 'string' ? h : h?.url)).filter(Boolean)
      if (!urls.length) { importError.value = 'No hosts found in file'; pending.value = null; return }
      pending.value = urls
    } catch {
      importError.value = 'Invalid JSON file'
      pending.value = null
    }
  }
  reader.readAsText(file)
}

async function doImport () {
  if (!pending.value?.length) return
  const valid = pending.value.filter(u => normalizeHost(u))
  const skipped = pending.value.length - valid.length
  if (!valid.length) { importError.value = 'No valid hosts found in the file'; return }
  const origins = [...new Set(valid.map(u => normalizeHost(u).originPattern))]
  try {
    // One permission prompt for all imported origins (button click keeps the user gesture).
    const granted = await browser.permissions.request({ origins })
    if (!granted) { importError.value = 'Permission is needed to monitor imported hosts'; return }
    for (const u of valid) await addHost(u).catch(() => {})
    importError.value = ''
    importNotice.value = `Imported ${valid.length} host(s)` + (skipped ? `; skipped ${skipped} invalid` : '')
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
        open the dashboard. Turn this on only for sites where periodic checking is appropriate.
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
        the previews while the dashboard is open (desktop layout only).
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
        Larger → fewer, bigger tiles; the column count auto-fits your window.
      </p>
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
      <label class="setting-label">Hosts</label>
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
          Grant &amp; import {{ pending.length }} host(s)
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
