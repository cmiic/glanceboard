<script setup>
import { ref, computed, watch } from 'vue'
import { browser } from '@/lib/browser.js'
import { normalizeTarget } from '@/lib/url.js'
import {
  createFeedGroup, renameFeedGroup, removeFeedGroup, moveFeedSource, removeFeedSource,
  setFeedSourceDisplay
} from '@/lib/storage.js'
import { feedSourceDisplay, syncFeedGroupDrafts } from '@/lib/feed-settings.js'
import AddHostForm from './AddHostForm.vue'

const props = defineProps({
  groups: { type: Array, default: () => [] },
  sources: { type: Array, default: () => [] }
})

const newName = ref('')
const drafts = ref({})
const error = ref('')
const notice = ref('')
const busyId = ref(null)
let knownGroupNames = {}

watch(() => props.groups, groups => {
  drafts.value = syncFeedGroupDrafts(groups, drafts.value, knownGroupNames)
  knownGroupNames = Object.fromEntries((groups || []).map(group => [group.id, group.name]))
}, { immediate: true, deep: true })

const sourcesByGroup = computed(() => {
  const out = {}
  for (const source of props.sources) (out[source.groupId] ||= []).push(source)
  return out
})

async function run (id, fn) {
  error.value = ''
  notice.value = ''
  busyId.value = id
  try { await fn() } catch (e) { error.value = e?.message || String(e) } finally { busyId.value = null }
}

async function create () {
  await run('new', async () => {
    await createFeedGroup(newName.value)
    newName.value = ''
  })
}

async function rename (group) {
  await run(group.id, async () => { await renameFeedGroup(group.id, drafts.value[group.id]) })
}

async function removeGroup (group) {
  const count = sourcesByGroup.value[group.id]?.length || 0
  if (count && !window.confirm(`Delete “${group.name}” and its ${count} RSS feed(s)?`)) return
  await run(group.id, async () => { await removeFeedGroup(group.id) })
}

async function move (source, event) {
  await run(source.id, async () => { await moveFeedSource(source.id, event.target.value) })
}

async function removeSource (source) {
  await run(source.id, async () => { await removeFeedSource(source.id) })
}

function displayFor (source) {
  return feedSourceDisplay(source)
}

async function updateDisplay (source, patch) {
  await run(source.id, async () => { await setFeedSourceDisplay(source.id, patch) })
}

async function grant (source) {
  const n = normalizeTarget(source.url)
  if (!n) return
  await run(source.id, async () => {
    const granted = await browser.permissions.request({ origins: [n.originPattern] })
    if (!granted) throw new Error('Permission was not granted')
    notice.value = `Access granted for ${n.hostname}`
  })
}
</script>

<template>
  <div class="feed-admin">
    <AddHostForm />
    <p class="popup-load">
      RSS feeds belong to one group. Every non-empty group appears as one tile on the Monitor wall.
    </p>

    <form
      class="field"
      @submit.prevent="create"
    >
      <input
        v-model="newName"
        class="input"
        type="text"
        maxlength="80"
        placeholder="New group name"
      >
      <button
        class="btn"
        type="submit"
        :disabled="busyId === 'new'"
      >
        Create group
      </button>
    </form>

    <span
      v-if="error"
      class="error-text"
    >{{ error }}</span>
    <span
      v-if="notice"
      class="popup-load"
    >{{ notice }}</span>

    <div
      v-if="!groups.length"
      class="empty compact-empty"
    >
      No feed groups yet.
    </div>
    <section
      v-for="group in groups"
      :key="group.id"
      class="card feed-group-admin"
    >
      <div class="field group-edit">
        <input
          v-model="drafts[group.id]"
          class="input group-name-input"
          type="text"
          maxlength="80"
          :aria-label="`Name for ${group.name}`"
        >
        <button
          class="btn btn-sm"
          type="button"
          :disabled="busyId === group.id || drafts[group.id] === group.name"
          @click="rename(group)"
        >
          Rename
        </button>
        <button
          class="btn btn-sm"
          type="button"
          :disabled="busyId === group.id"
          @click="removeGroup(group)"
        >
          Delete group
        </button>
      </div>

      <div
        v-if="!sourcesByGroup[group.id]?.length"
        class="popup-load group-empty"
      >
        Empty — this group is hidden from the Monitor wall.
      </div>
      <div
        v-for="source in sourcesByGroup[group.id] || []"
        :key="source.id"
        class="feed-source-row"
      >
        <div class="feed-source-name">
          <strong>{{ source.title }}</strong>
          <span class="popup-load url-wrap">{{ source.url }}</span>
        </div>
        <select
          class="input input-sm"
          :value="source.groupId"
          aria-label="Move feed to group"
          :disabled="busyId === source.id"
          @change="move(source, $event)"
        >
          <option
            v-for="target in groups"
            :key="target.id"
            :value="target.id"
          >
            {{ target.name }}
          </option>
        </select>
        <button
          class="btn btn-sm"
          type="button"
          :disabled="busyId === source.id"
          @click="grant(source)"
        >
          Grant access
        </button>
        <button
          class="btn btn-sm"
          type="button"
          :disabled="busyId === source.id"
          @click="removeSource(source)"
        >
          Remove
        </button>
        <div
          class="feed-display-settings"
          role="group"
          :aria-label="`Display settings for ${source.title}`"
        >
          <label><input
            type="checkbox"
            :checked="displayFor(source).showImage"
            :disabled="busyId === source.id"
            @change="updateDisplay(source, { showImage: $event.target.checked })"
          > Image</label>
          <label><input
            type="checkbox"
            :checked="displayFor(source).showDescription"
            :disabled="busyId === source.id"
            @change="updateDisplay(source, { showDescription: $event.target.checked })"
          > Description</label>
          <label class="description-limit">
            Ellipsis after
            <input
              class="input limit-input"
              type="number"
              min="0"
              max="10000"
              step="1"
              :value="displayFor(source).descriptionMaxChars"
              :disabled="busyId === source.id || !displayFor(source).showDescription"
              aria-label="Description character limit; zero means no limit"
              @change="updateDisplay(source, { descriptionMaxChars: $event.target.value })"
            >
            chars (0 = all)
          </label>
        </div>
      </div>
    </section>
  </div>
</template>

<style scoped>
.feed-admin { max-width: 820px; display: flex; flex-direction: column; gap: 12px; }
.compact-empty { padding: 20px; }
.feed-group-admin { padding: 12px; overflow: visible; }
.group-edit { padding-bottom: 10px; border-bottom: 1px solid var(--border); }
.group-name-input { flex: 1; min-width: 180px; font-weight: 600; }
.group-empty { padding-top: 10px; }
.feed-source-row { display: flex; align-items: center; gap: 8px; padding-top: 10px; flex-wrap: wrap; }
.feed-source-name { flex: 1; min-width: 220px; overflow: hidden; }
.url-wrap { display: block; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.input-sm { padding: 5px 8px; font-size: 12px; max-width: 170px; }
.feed-display-settings { flex-basis: 100%; display: flex; align-items: center; gap: 14px; padding-left: min(24px, 3vw); font-size: 12px; color: var(--text-dim); }
.feed-display-settings label { display: inline-flex; align-items: center; gap: 5px; }
.description-limit { flex-wrap: wrap; }
.limit-input { width: 76px; padding: 4px 6px; font-size: 12px; }
@media (max-width: 620px) {
  .feed-display-settings { padding-left: 0; align-items: flex-start; flex-direction: column; gap: 7px; }
}
</style>
