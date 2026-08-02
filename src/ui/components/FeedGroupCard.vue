<script setup>
import { ref, computed, onMounted, onBeforeUnmount, watch } from 'vue'
import { browser } from '@/lib/browser.js'
import { mergeFeedItems, truncateFeedDescription } from '@/lib/rss.js'
import { readLaterId, removeReadLater, saveReadLater } from '@/lib/storage.js'
import { feedSourceDisplay } from '@/lib/feed-settings.js'

const props = defineProps({
  group: { type: Object, required: true },
  sources: { type: Array, default: () => [] },
  caches: { type: Object, default: () => ({}) },
  mode: { type: String, default: 'desktop' },
  reloadNonce: { type: Number, default: 0 },
  arrangeable: { type: Boolean, default: false },
  pollingEnabled: { type: Boolean, default: false },
  savedIds: { type: Object, default: () => new Set() }
})

const emit = defineEmits(['dragstart', 'resizestart', 'loaded', 'play'])
const cardEl = ref(null)
const busy = ref(false)
const runError = ref('')

const items = computed(() => {
  const byId = new Map(props.sources.map(source => [source.id, source]))
  return mergeFeedItems(props.sources, props.caches).map(item => {
    const display = feedSourceDisplay(byId.get(item.sourceId))
    return {
      ...item,
      display,
      visibleDescription: display.showDescription
        ? truncateFeedDescription(item.description, display.descriptionMaxChars)
        : ''
    }
  })
})
const failedCount = computed(() => props.sources.filter(source => props.caches[source.id]?.error).length)
const lastUpdated = computed(() => Math.max(0, ...props.sources.map(source => props.caches[source.id]?.fetchedAt || 0)))
const lastUpdatedText = computed(() => lastUpdated.value
  ? new Date(lastUpdated.value).toLocaleTimeString([], {
      hour: '2-digit', minute: '2-digit', hourCycle: 'h23'
    })
  : 'Not loaded')

function onHeadPointerDown (event) {
  if (!props.arrangeable || event.button !== 0 || event.target.closest('button, a')) return
  emit('dragstart', { id: props.group.id, event })
}

function onResizePointerDown (edge, event) {
  if (event.button !== 0) return
  emit('resizestart', { id: props.group.id, edge, event })
}

function itemDate (timestamp) {
  return typeof timestamp === 'number'
    ? new Date(timestamp).toLocaleString([], {
        year: 'numeric', month: '2-digit', day: '2-digit',
        hour: '2-digit', minute: '2-digit', hourCycle: 'h23'
      })
    : ''
}

async function loadFeeds (force = !props.pollingEnabled) {
  if (busy.value) return
  loadedOnce = true
  busy.value = true
  runError.value = ''
  try {
    const result = await browser.runtime.sendMessage({
      type: 'refresh-feeds', sourceIds: props.sources.map(source => source.id), force
    })
    runError.value = result?.failures?.map(item => item.message).join('; ') || ''
  } catch (error) {
    runError.value = error?.message || String(error)
  } finally {
    busy.value = false
    emit('loaded', props.group.id)
  }
}

function sourceFor (item) {
  return props.sources.find(source => source.id === item.sourceId)
}

function isSaved (item) {
  const source = sourceFor(item)
  return !!source && props.savedIds.has(readLaterId(source, item))
}

async function toggleSaved (item) {
  const source = sourceFor(item)
  if (!source) return
  try {
    const id = readLaterId(source, item)
    if (props.savedIds.has(id)) await removeReadLater(id)
    else await saveReadLater(source, item)
  } catch (error) {
    runError.value = error?.message || String(error)
  }
}

let mobileObserver = null
let loadedOnce = false
onMounted(() => {
  if (props.mode !== 'mobile') return
  if ('IntersectionObserver' in window) {
    mobileObserver = new IntersectionObserver(entries => {
      if (entries.some(entry => entry.isIntersecting) && !loadedOnce) {
        mobileObserver.disconnect()
        loadFeeds(!props.pollingEnabled)
      }
    }, { rootMargin: '150px' })
    if (cardEl.value) mobileObserver.observe(cardEl.value)
  } else {
    loadFeeds(!props.pollingEnabled)
  }
})
onBeforeUnmount(() => { mobileObserver?.disconnect() })
watch(() => props.reloadNonce, (next, previous) => { if (next !== previous) loadFeeds(!props.pollingEnabled) })
</script>

<template>
  <div
    ref="cardEl"
    class="card feed-card"
    :class="{ error: failedCount > 0 || !!runError, mobile: mode === 'mobile' }"
  >
    <div
      class="card-head"
      :class="{ draggable: arrangeable }"
      @pointerdown="onHeadPointerDown"
    >
      <span
        class="card-host"
        :title="arrangeable ? `${group.name} — drag to reorder` : group.name"
      >{{ group.name }}</span>
      <span class="feed-count">{{ sources.length }} feed{{ sources.length === 1 ? '' : 's' }}</span>
      <button
        class="btn btn-icon btn-sm"
        type="button"
        title="Refresh feeds"
        aria-label="Refresh feeds"
        :disabled="busy"
        @click="loadFeeds(true)"
      >
        ⟳
      </button>
    </div>

    <div class="feed-meta">
      <span>{{ busy ? 'Refreshing…' : `Updated ${lastUpdatedText}` }}</span>
      <span v-if="failedCount">{{ failedCount }} failed</span>
    </div>

    <div class="feed-items">
      <div
        v-if="!items.length"
        class="placeholder feed-placeholder"
      >
        {{ busy ? 'Loading headlines…' : 'No feed items available' }}
      </div>
      <article
        v-for="item in items"
        :key="`${item.sourceId}:${item.id}`"
        class="feed-item"
      >
        <div class="feed-item-heading">
          <img
            v-if="item.display.showImage && item.imageUrl"
            :src="item.imageUrl"
            alt=""
            class="feed-item-image"
            loading="lazy"
            decoding="async"
            referrerpolicy="no-referrer"
            @error="$event.currentTarget.remove()"
          >
          <a
            v-if="item.url"
            :href="item.url"
            target="_blank"
            rel="noopener noreferrer"
            class="feed-item-title"
          >{{ item.title }}</a>
          <span
            v-else
            class="feed-item-title"
          >{{ item.title }}</span>
          <span class="feed-item-actions">
            <button
              v-if="item.audio"
              class="btn btn-icon btn-sm"
              type="button"
              title="Play episode"
              aria-label="Play episode"
              @click="emit('play', item)"
            >▶</button>
            <button
              class="btn btn-icon btn-sm"
              type="button"
              :title="isSaved(item) ? 'Remove from Read Later' : 'Save to Read Later'"
              :aria-label="isSaved(item) ? 'Remove from Read Later' : 'Save to Read Later'"
              @click="toggleSaved(item)"
            >{{ isSaved(item) ? '★' : '☆' }}</button>
          </span>
        </div>
        <p
          v-if="item.visibleDescription"
          class="feed-item-description"
        >
          {{ item.visibleDescription }}
        </p>
        <div class="feed-item-meta">
          <span>{{ item.sourceTitle }}</span>
          <time v-if="typeof item.publishedAt === 'number'">{{ itemDate(item.publishedAt) }}</time>
        </div>
      </article>
    </div>

    <div
      v-if="failedCount || runError"
      class="banner"
    >
      {{ failedCount ? 'Some feeds could not refresh. Cached headlines are kept.' : 'Feed updates could not be saved.' }}
      {{ runError }}
    </div>

    <template v-if="arrangeable">
      <div
        class="resize-handle east"
        title="Drag to resize width"
        @pointerdown="onResizePointerDown('east', $event)"
      />
      <div
        class="resize-handle south"
        title="Drag to resize height"
        @pointerdown="onResizePointerDown('south', $event)"
      />
      <div
        class="resize-handle corner"
        title="Drag to resize"
        @pointerdown="onResizePointerDown('corner', $event)"
      />
    </template>
  </div>
</template>

<style scoped>
.feed-card { min-height: 0; }
.feed-card.mobile { height: min(70vh, 520px); min-height: 320px; }
.feed-count { color: var(--text-dim); font-size: 11px; white-space: nowrap; }
.feed-meta { display: flex; justify-content: space-between; padding: 6px 12px; color: var(--text-dim); font-size: 11px; border-bottom: 1px solid var(--border); }
.feed-items { overflow: auto; min-height: 0; flex: 1; }
.feed-placeholder { min-height: 120px; }
.feed-item { padding: 9px 12px; border-bottom: 1px solid var(--border); }
.feed-item:last-child { border-bottom: 0; }
.feed-item-heading { display: flex; align-items: flex-start; gap: 8px; }
.feed-item-actions { margin-left: auto; display: inline-flex; gap: 4px; flex: none; }
.feed-item-image { width: 38px; height: 38px; flex: 0 0 38px; border-radius: 5px; object-fit: cover; background: var(--surface-2); }
.feed-item-title { display: -webkit-box; flex: 1; min-width: 0; overflow: hidden; color: var(--text); font-weight: 600; line-height: 1.35; text-decoration: none; -webkit-box-orient: vertical; -webkit-line-clamp: 2; }
a.feed-item-title:hover { color: var(--primary); text-decoration: underline; }
.feed-item-description { margin: 5px 0 0; color: var(--text-dim); font-size: 12px; line-height: 1.4; overflow-wrap: anywhere; }
.feed-item-meta { display: flex; justify-content: space-between; gap: 8px; padding-top: 3px; color: var(--text-dim); font-size: 11px; }
</style>
