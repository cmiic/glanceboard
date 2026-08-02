<script setup>
import { computed } from 'vue'
import { clearReadLater, removeReadLater } from '@/lib/storage.js'
import { truncateFeedDescription } from '@/lib/rss.js'

const props = defineProps({ items: { type: Array, default: () => [] } })
const emit = defineEmits(['play'])
const ordered = computed(() => [...props.items].sort((a, b) => b.savedAt - a.savedAt))

function dateText (timestamp) {
  return typeof timestamp === 'number'
    ? new Date(timestamp).toLocaleString([], {
        year: 'numeric', month: '2-digit', day: '2-digit',
        hour: '2-digit', minute: '2-digit', hourCycle: 'h23'
      })
    : ''
}

async function clearAll () {
  if (props.items.length && window.confirm(`Remove all ${props.items.length} Read Later item(s)?`)) await clearReadLater()
}
</script>

<template>
  <div class="read-later">
    <div class="read-later-head">
      <div>
        <h2>Read Later</h2>
        <p class="popup-load">
          Saved feed items stay here even if their original feed is removed.
        </p>
      </div>
      <button
        v-if="items.length"
        class="btn btn-sm"
        type="button"
        @click="clearAll"
      >
        Clear all
      </button>
    </div>
    <div
      v-if="!items.length"
      class="empty"
    >
      Nothing saved yet — use ☆ on a feed item.
    </div>
    <article
      v-for="item in ordered"
      :key="item.id"
      class="card saved-item"
    >
      <img
        v-if="item.imageUrl"
        :src="item.imageUrl"
        alt=""
        class="saved-image"
        loading="lazy"
        decoding="async"
        referrerpolicy="no-referrer"
        @error="$event.currentTarget.remove()"
      >
      <div class="saved-content">
        <a
          v-if="item.url"
          :href="item.url"
          target="_blank"
          rel="noopener noreferrer"
          class="saved-title"
        >{{ item.title }}</a>
        <strong
          v-else
          class="saved-title"
        >{{ item.title }}</strong>
        <p
          v-if="item.description"
          class="saved-description"
        >
          {{ truncateFeedDescription(item.description, 400) }}
        </p>
        <div class="feed-item-meta">
          <span>{{ item.source?.title || 'Feed' }}</span>
          <time v-if="item.publishedAt">{{ dateText(item.publishedAt) }}</time>
          <span>Saved {{ dateText(item.savedAt) }}</span>
        </div>
      </div>
      <div class="saved-actions">
        <button
          v-if="item.audio"
          class="btn btn-sm"
          type="button"
          @click="emit('play', { ...item, sourceTitle: item.source?.title })"
        >
          Play
        </button>
        <button
          class="btn btn-sm"
          type="button"
          @click="removeReadLater(item.id)"
        >
          Remove
        </button>
      </div>
    </article>
  </div>
</template>

<style scoped>
.read-later { max-width: 900px; display: flex; flex-direction: column; gap: 10px; }
.read-later-head { display: flex; justify-content: space-between; align-items: flex-start; gap: 12px; }
.read-later-head h2, .read-later-head p { margin: 0 0 4px; }
.saved-item { display: flex; gap: 12px; align-items: flex-start; padding: 12px; overflow: visible; }
.saved-image { width: 72px; height: 72px; object-fit: cover; border-radius: 6px; flex: none; }
.saved-content { flex: 1; min-width: 0; }
.saved-title { color: var(--text); font-weight: 650; text-decoration: none; }
.saved-title:hover { text-decoration: underline; }
.saved-description { color: var(--text-dim); margin: 6px 0; line-height: 1.4; }
.saved-actions { display: flex; gap: 6px; flex: none; }
@media (max-width: 620px) {
  .saved-item { flex-wrap: wrap; }
  .saved-content { min-width: calc(100% - 90px); }
  .saved-actions { width: 100%; justify-content: flex-end; }
}
</style>
