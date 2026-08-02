<script setup>
import { nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { getPodcastProgress, setPodcastProgress } from '@/lib/storage.js'

const props = defineProps({ item: { type: Object, required: true } })
const emit = defineEmits(['close'])
const audioEl = ref(null)
const playing = ref(false)
const currentTime = ref(0)
const duration = ref(0)
const rate = ref(1)
const error = ref('')
let lastSavedAt = 0
let loadedUrl = null
let progressReady = false

function formatTime (seconds) {
  const total = Math.max(0, Math.floor(Number(seconds) || 0))
  const hours = Math.floor(total / 3600)
  const minutes = Math.floor((total % 3600) / 60)
  const secs = total % 60
  return hours ? `${hours}:${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')}` : `${minutes}:${String(secs).padStart(2, '0')}`
}

async function persist (force = false) {
  const audio = audioEl.value
  if (!audio || !progressReady || (!force && Date.now() - lastSavedAt < 5000)) return
  lastSavedAt = Date.now()
  if (loadedUrl) await setPodcastProgress(loadedUrl, audio.currentTime, audio.duration).catch(() => {})
}

async function loadItem (autoplay = false) {
  const audio = audioEl.value
  if (!audio) return
  if (loadedUrl) await persist(true)
  progressReady = false
  const requestedUrl = props.item.audio.url
  loadedUrl = requestedUrl
  lastSavedAt = 0
  error.value = ''
  playing.value = false
  currentTime.value = 0
  duration.value = Number(props.item.audio.durationSeconds) || 0
  audio.src = requestedUrl
  audio.playbackRate = rate.value
  if (autoplay) audio.play().catch(() => { /* The visible play button remains available. */ })
  const progress = await getPodcastProgress().catch(() => ({}))
  if (loadedUrl !== requestedUrl) return
  const saved = progress[requestedUrl]
  const restore = () => {
    if (saved?.positionSeconds && Number.isFinite(audio.duration)) {
      audio.currentTime = Math.min(saved.positionSeconds, Math.max(0, audio.duration - 1))
    }
    progressReady = true
  }
  if (audio.readyState >= 1) restore()
  else audio.addEventListener('loadedmetadata', restore, { once: true })
}

function toggle () {
  const audio = audioEl.value
  if (!audio) return
  if (audio.paused) audio.play().catch(e => { error.value = e?.message || 'Playback failed' })
  else audio.pause()
}

function onPause () {
  playing.value = false
  persist(true)
}

function seek (event) {
  const audio = audioEl.value
  if (!audio) return
  audio.currentTime = Number(event.target.value)
  currentTime.value = audio.currentTime
}

function changeRate (event) {
  rate.value = Number(event.target.value)
  if (audioEl.value) audioEl.value.playbackRate = rate.value
}

function close () {
  persist(true)
  audioEl.value?.pause()
  emit('close')
}

onMounted(() => nextTick(() => loadItem(true)))
watch(() => props.item.audio.url, () => loadItem(true))
onBeforeUnmount(() => { persist(true); audioEl.value?.pause() })
</script>

<template>
  <div
    class="podcast-player"
    role="region"
    aria-label="Podcast player"
  >
    <audio
      ref="audioEl"
      preload="metadata"
      @play="playing = true"
      @pause="onPause"
      @timeupdate="currentTime = $event.target.currentTime; persist()"
      @durationchange="duration = Number.isFinite($event.target.duration) ? $event.target.duration : duration"
      @ended="playing = false; persist(true)"
      @error="error = 'Audio could not be played'"
    />
    <button
      class="btn btn-primary player-play"
      type="button"
      :aria-label="playing ? 'Pause' : 'Play'"
      @click="toggle"
    >
      {{ playing ? '❚❚' : '▶' }}
    </button>
    <div class="player-main">
      <strong class="player-title">{{ item.title }}</strong>
      <span class="popup-load">{{ item.sourceTitle || item.source?.title || 'Podcast' }}</span>
      <div class="player-timeline">
        <span>{{ formatTime(currentTime) }}</span>
        <input
          type="range"
          min="0"
          :max="Math.max(duration, 1)"
          step="1"
          :value="currentTime"
          aria-label="Episode position"
          @input="seek"
          @change="persist(true)"
        >
        <span>{{ formatTime(duration) }}</span>
      </div>
      <span
        v-if="error"
        class="error-text"
      >{{ error }}</span>
    </div>
    <select
      class="input input-sm player-speed"
      :value="rate"
      aria-label="Playback speed"
      @change="changeRate"
    >
      <option
        v-for="value in [0.75, 1, 1.25, 1.5, 1.75, 2]"
        :key="value"
        :value="value"
      >
        {{ value }}×
      </option>
    </select>
    <button
      class="btn btn-icon"
      type="button"
      title="Close player"
      aria-label="Close player"
      @click="close"
    >
      ×
    </button>
  </div>
</template>

<style scoped>
.podcast-player { position: fixed; z-index: 1000; left: 12px; right: 12px; bottom: 12px; display: flex; align-items: center; gap: 10px; padding: 10px 12px; border: 1px solid var(--border); border-radius: 10px; background: var(--surface); box-shadow: 0 8px 30px rgb(0 0 0 / 35%); }
.player-play { width: 42px; height: 42px; flex: none; }
.player-main { min-width: 0; flex: 1; }
.player-title { display: block; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }
.player-timeline { display: flex; align-items: center; gap: 7px; font-size: 11px; color: var(--text-dim); }
.player-timeline input { min-width: 80px; flex: 1; }
.player-speed { width: 76px; }
@media (max-width: 620px) {
  .podcast-player { flex-wrap: wrap; }
  .player-main { flex-basis: calc(100% - 100px); }
  .player-speed { margin-left: 52px; }
}
</style>
