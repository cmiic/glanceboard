<script setup>
import { ref, computed, onBeforeUnmount, onMounted } from 'vue'
import { browser } from '@/lib/browser.js'
import { normalizeTarget } from '@/lib/url.js'
import {
  addHost, addSiteAndFeedSources, getFeedGroups, revokePermissionIfUnused, suggestGroupName
} from '@/lib/storage.js'
import {
  defaultCandidateIds, discoveryPermissionPatterns, inspectTarget
} from '@/lib/feed-discovery.js'
import { getFeedAdapter } from '@/lib/feed-adapters.js'
import { loadGrantedOrigins, requestMissingOrigins } from '@/lib/permissions.js'

const input = ref('')
const error = ref('')
const busy = ref(false)
const review = ref(null)
const redirect = ref(null)
const failedTarget = ref(null)
const groups = ref([])
const choice = ref('site')
const selectedUrls = ref([])
const groupChoice = ref('__new__')
const groupName = ref('')
const temporaryUrls = new Set()
// Firefox rejects permissions.request() outside a user input handler, so a click handler cannot
// await permissions.contains() to find out whether it still has to ask. This snapshot answers that
// synchronously instead; it is seeded on mount and kept current through the permission events.
const grantedOrigins = ref([])

const preview = computed(() => (input.value.trim() ? normalizeTarget(input.value)?.label : null))
const wantsFeeds = computed(() => review.value?.direct || choice.value === 'feed' || choice.value === 'both')

function syncGrantedOrigins () {
  loadGrantedOrigins().then(origins => { grantedOrigins.value = origins }).catch(() => {})
}

function rememberPatterns (patterns) {
  for (const pattern of patterns) temporaryUrls.add(pattern.replace(/\/\*$/, ''))
}

async function cleanupTemporary () {
  const urls = [...temporaryUrls]
  temporaryUrls.clear()
  for (const url of urls) await revokePermissionIfUnused(url)
  if (urls.length) syncGrantedOrigins()
}

function resetReview () {
  review.value = null
  redirect.value = null
  failedTarget.value = null
  selectedUrls.value = []
  choice.value = 'site'
  groupChoice.value = '__new__'
  groupName.value = ''
}

async function finish () {
  input.value = ''
  resetReview()
  await cleanupTemporary()
}

async function canFetch (url) {
  const n = normalizeTarget(url)
  return !!n && browser.permissions.contains({ origins: [n.originPattern] })
}

async function inspect (url, discoveredFrom) {
  error.value = ''
  redirect.value = null
  failedTarget.value = null
  try {
    const result = await inspectTarget(url, { canFetch, webRequest: browser.webRequest })
    if (result.kind === 'redirect') {
      redirect.value = { url: result.url, discoveredFrom }
      return
    }
    if (!result.candidates.length) {
      await addHost(result.pageUrl || url)
      await finish()
      return
    }
    groups.value = await getFeedGroups()
    const direct = result.kind === 'feed'
    review.value = {
      direct,
      pageUrl: result.pageUrl || url,
      discoveredFrom,
      candidates: result.candidates
    }
    choice.value = direct ? 'feed' : 'site'
    selectedUrls.value = defaultCandidateIds(result.candidates)
    const selected = result.candidates.find(item => selectedUrls.value.includes(item.url)) || result.candidates[0]
    groupName.value = suggestGroupName(selected?.title || 'Feed group', groups.value)
  } catch (e) {
    failedTarget.value = { url, discoveredFrom }
    error.value = `Could not check for feeds: ${e?.message || String(e)}`
  }
}

async function submit () {
  error.value = ''
  const n = normalizeTarget(input.value)
  if (!n) { error.value = 'Enter a valid site or page URL'; return }
  resetReview()
  busy.value = true
  const patterns = [...new Set([n.originPattern, ...discoveryPermissionPatterns(n.url)])]
  try {
    // This request is deliberately the first awaited operation: Firefox requires it to remain in
    // the submit gesture. A known discovery adapter may add its exact API origin to the same prompt.
    const { granted, origins } = await requestMissingOrigins(patterns, grantedOrigins.value)
    if (!granted) { error.value = 'Permission is needed to inspect this site'; return }
    rememberPatterns(origins)
    syncGrantedOrigins()
    await inspect(n.url, n.url)
  } catch (e) {
    error.value = e?.message || String(e)
  } finally {
    busy.value = false
  }
}

async function continueRedirect () {
  if (!redirect.value) return
  error.value = ''
  busy.value = true
  const n = normalizeTarget(redirect.value.url)
  const patterns = [...new Set([n.originPattern, ...discoveryPermissionPatterns(n.url)])]
  try {
    // First awaited operation again — the "Grant & continue" click is the gesture Firefox needs.
    const { granted, origins } = await requestMissingOrigins(patterns, grantedOrigins.value)
    if (!granted) { error.value = 'Permission is needed to inspect the redirected site'; return }
    rememberPatterns(origins)
    syncGrantedOrigins()
    await inspect(n.url, redirect.value.discoveredFrom)
  } catch (e) {
    error.value = e?.message || String(e)
  } finally {
    busy.value = false
  }
}

async function addWebsiteAnyway () {
  if (!failedTarget.value) return
  busy.value = true
  error.value = ''
  try {
    await addHost(failedTarget.value.url)
    await finish()
  } catch (e) {
    error.value = e?.message || String(e)
  } finally {
    busy.value = false
  }
}

async function confirmSelection () {
  if (!review.value) return
  error.value = ''
  const selected = wantsFeeds.value
    ? review.value.candidates.filter(item => selectedUrls.value.includes(item.url))
    : []
  if (wantsFeeds.value && !selected.length) { error.value = 'Select at least one feed'; return }
  if (wantsFeeds.value && groupChoice.value === '__new__' && !groupName.value.trim()) {
    error.value = 'Enter a feed group name'; return
  }

  const patterns = wantsFeeds.value
    ? [...new Set(selected.map(item => normalizeTarget(item.url)?.originPattern).filter(Boolean))]
    : []

  busy.value = true
  try {
    // The confirmation button supplies the user gesture for cross-origin feed permissions, so this
    // stays the first awaited operation: any await before it — the feed-group re-check below used
    // to be one — makes Firefox reject the request, whether or not anything is still missing.
    const { granted, origins } = await requestMissingOrigins(patterns, grantedOrigins.value)
    if (!granted) { error.value = 'Permission is needed to read the selected feed(s)'; return }
    rememberPatterns(origins)
    syncGrantedOrigins()

    if (wantsFeeds.value && groupChoice.value !== '__new__') {
      const currentGroups = await getFeedGroups()
      if (!currentGroups.some(group => group.id === groupChoice.value)) {
        groups.value = currentGroups
        groupChoice.value = '__new__'
        const first = selected[0]
        groupName.value = suggestGroupName(first?.title || 'Feed group', currentGroups)
        error.value = 'The selected feed group was deleted. Choose another group or create a new one.'
        return
      }
      groups.value = currentGroups
    }

    const feeds = []
    for (const item of selected) {
      const result = item.validated
        ? { url: item.url, cache: item.validated }
        : await getFeedAdapter(item.type)?.refresh(item.url)
      if (!result) throw new Error(`Unsupported feed type: ${item.type}`)
      const final = normalizeTarget(result.url)
      if (!final || !(await browser.permissions.contains({ origins: [final.originPattern] }))) {
        review.value.candidates = review.value.candidates.map(candidate =>
          candidate.url === item.url ? { ...candidate, url: result.url, validated: result.cache } : candidate)
        selectedUrls.value = selectedUrls.value.map(url => url === item.url ? result.url : url)
        error.value = 'A feed redirected to another site. Click Add again to grant that exact origin.'
        return
      }
      feeds.push({
        type: item.type,
        url: result.url,
        title: result.cache.channel?.title || item.title,
        discoveredFrom: review.value.discoveredFrom,
        cache: result.cache
      })
    }

    await addSiteAndFeedSources({
      siteInput: (!review.value.direct && (choice.value === 'site' || choice.value === 'both')) ? review.value.pageUrl : null,
      feeds: wantsFeeds.value ? feeds : [],
      groupId: wantsFeeds.value && groupChoice.value !== '__new__' ? groupChoice.value : null,
      groupName: wantsFeeds.value && groupChoice.value === '__new__' ? groupName.value : ''
    })
    await finish()
  } catch (e) {
    error.value = e?.message || String(e)
  } finally {
    busy.value = false
  }
}

async function cancel () {
  resetReview()
  error.value = ''
  await cleanupTemporary()
}

onMounted(() => {
  syncGrantedOrigins()
  browser.permissions?.onAdded?.addListener(syncGrantedOrigins)
  browser.permissions?.onRemoved?.addListener(syncGrantedOrigins)
})

onBeforeUnmount(() => {
  browser.permissions?.onAdded?.removeListener(syncGrantedOrigins)
  browser.permissions?.onRemoved?.removeListener(syncGrantedOrigins)
  cleanupTemporary().catch(() => {})
})
</script>

<template>
  <form
    class="field add-form"
    @submit.prevent="submit"
  >
    <input
      v-model="input"
      class="input"
      type="text"
      placeholder="add site, page, or feed URL"
      style="flex: 1; min-width: 200px"
      :disabled="busy || !!review || !!redirect || !!failedTarget"
    >
    <button
      class="btn btn-primary"
      type="submit"
      :disabled="busy || !!review || !!redirect || !!failedTarget"
    >
      {{ busy ? 'Checking…' : 'Add' }}
    </button>

    <div
      v-if="redirect"
      class="add-review"
    >
      <strong>This page redirects to another origin</strong>
      <span class="popup-load url-wrap">{{ redirect.url }}</span>
      <div class="field">
        <button
          class="btn btn-primary"
          type="button"
          :disabled="busy"
          @click="continueRedirect"
        >
          Grant &amp; continue
        </button>
        <button
          class="btn"
          type="button"
          :disabled="busy"
          @click="cancel"
        >
          Cancel
        </button>
      </div>
    </div>

    <div
      v-else-if="review"
      class="add-review"
    >
      <strong>{{ review.direct ? 'Feed detected' : 'Feeds available' }}</strong>
      <div
        v-if="!review.direct"
        class="add-options"
      >
        <label><input
          v-model="choice"
          type="radio"
          value="site"
        > Website</label>
        <label><input
          v-model="choice"
          type="radio"
          value="feed"
        > Feed</label>
        <label><input
          v-model="choice"
          type="radio"
          value="both"
        > Both</label>
      </div>

      <div v-if="wantsFeeds">
        <label
          v-for="candidate in review.candidates"
          :key="candidate.url"
          class="feed-choice"
        >
          <input
            v-model="selectedUrls"
            type="checkbox"
            :value="candidate.url"
          >
          <span>
            <span class="feed-format">{{ candidate.type === 'jsonfeed' ? 'JSON' : (candidate.type || 'rss').toUpperCase() }}</span>
            {{ candidate.title || 'Feed' }}
            <span class="popup-load url-wrap">{{ candidate.url }}</span>
          </span>
        </label>
        <label class="setting-label">Feed group</label>
        <select
          v-model="groupChoice"
          class="input"
        >
          <option value="__new__">
            New group…
          </option>
          <option
            v-for="group in groups"
            :key="group.id"
            :value="group.id"
          >
            {{ group.name }}
          </option>
        </select>
        <input
          v-if="groupChoice === '__new__'"
          v-model="groupName"
          class="input"
          type="text"
          maxlength="80"
          placeholder="Group name"
        >
      </div>

      <div class="field">
        <button
          class="btn btn-primary"
          type="button"
          :disabled="busy"
          @click="confirmSelection"
        >
          {{ busy ? 'Adding…' : (review.direct ? 'Add feed' : 'Add selection') }}
        </button>
        <button
          class="btn"
          type="button"
          :disabled="busy"
          @click="cancel"
        >
          Cancel
        </button>
      </div>
    </div>

    <div
      v-else-if="failedTarget"
      class="add-review"
    >
      <span class="popup-load">The feed check failed. You can still add the website without a feed.</span>
      <div class="field">
        <button
          class="btn btn-primary"
          type="button"
          :disabled="busy"
          @click="addWebsiteAnyway"
        >
          Add website anyway
        </button>
        <button
          class="btn"
          type="button"
          :disabled="busy"
          @click="cancel"
        >
          Cancel
        </button>
      </div>
    </div>

    <span
      v-if="error"
      class="error-text"
    >{{ error }}</span>
    <span
      v-else-if="preview && !review && !redirect"
      class="popup-load add-preview"
    >checks {{ preview }} for feeds before adding</span>
  </form>
</template>

<style scoped>
.add-form { align-items: flex-start; }
.add-preview, .add-review { flex-basis: 100%; overflow-wrap: anywhere; }
.add-review {
  display: flex; flex-direction: column; gap: 10px; padding: 12px;
  border: 1px solid var(--border); border-radius: 8px; background: var(--surface-2);
}
.add-options { display: flex; flex-wrap: wrap; gap: 14px; }
.add-options label, .feed-choice { display: flex; align-items: flex-start; gap: 6px; }
.feed-choice + .feed-choice { margin-top: 6px; }
.feed-format { display: inline-block; margin-right: 5px; padding: 1px 4px; border: 1px solid var(--border); border-radius: 4px; color: var(--text-dim); font-size: 10px; font-weight: 700; }
.url-wrap { display: block; overflow-wrap: anywhere; }
</style>
