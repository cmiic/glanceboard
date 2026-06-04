<script setup>
import { isCertExpiringSoon, isLoadSlow, isStale } from '@/lib/thresholds.js'
import { removeHost, setHostMetric } from '@/lib/storage.js'
import AddHostForm from './AddHostForm.vue'

const props = defineProps({
  hosts: { type: Array, default: () => [] },
  results: { type: Object, default: () => ({}) }
})

function statusClass (host) {
  const r = props.results[host.id]
  if (!r) return ''
  if (r.ok === false) return 'bad'
  const bad = isCertExpiringSoon(r.certExpiresInDays?.[0]) ||
    isLoadSlow(r.elapsed?.[0]) ||
    isStale(r.lastTimestamp)
  return bad ? 'bad' : 'ok'
}
function toggle (host, key, e) { setHostMetric(host.id, key, e.target.checked) }
function remove (host) { removeHost(host.id) }
</script>

<template>
  <div>
    <AddHostForm />
    <p
      class="popup-load"
      style="margin: 12px 0 8px"
    >
      {{ hosts.length }} host(s) — choose which metrics each tile shows
    </p>
    <div
      v-for="host in hosts"
      :key="host.id"
      class="host-row"
    >
      <span
        class="dot"
        :class="statusClass(host)"
      />
      <span
        class="name"
        :title="host.url"
      >{{ host.hostname }}</span>
      <label class="metric-toggle">
        <input
          type="checkbox"
          :checked="!!host.metrics?.cert"
          @change="toggle(host, 'cert', $event)"
        >
        cert
      </label>
      <label class="metric-toggle">
        <input
          type="checkbox"
          :checked="!!host.metrics?.load"
          @change="toggle(host, 'load', $event)"
        >
        load
      </label>
      <button
        class="btn btn-sm"
        @click="remove(host)"
      >
        Remove
      </button>
    </div>
  </div>
</template>

<style scoped>
.metric-toggle {
  display: flex;
  align-items: center;
  gap: 4px;
  font-size: 12px;
  color: var(--text-dim);
  white-space: nowrap;
}
</style>
