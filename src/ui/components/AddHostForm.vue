<script setup>
import { ref, computed } from 'vue'
import { browser } from '@/lib/browser.js'
import { normalizeTarget } from '@/lib/url.js'
import { addHost } from '@/lib/storage.js'

const input = ref('')
const error = ref('')
const busy = ref(false)

// Echo what will actually be added — a typed path is kept now, so the user should see whether they
// are adding a whole site or a single page before committing.
const preview = computed(() => (input.value.trim() ? normalizeTarget(input.value)?.label : null))

async function submit () {
  error.value = ''
  const n = normalizeTarget(input.value)
  if (!n) { error.value = 'Enter a valid site or page URL'; return }
  busy.value = true
  try {
    // Ask for host permission for just this origin (least privilege). Must run inside the
    // submit gesture — which this handler is.
    const granted = await browser.permissions.request({ origins: [n.originPattern] })
    if (!granted) { error.value = 'Permission is needed to monitor this site'; return }
    await addHost(input.value)
    input.value = ''
  } catch (e) {
    error.value = e?.message || String(e)
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <form
    class="field"
    @submit.prevent="submit"
  >
    <input
      v-model="input"
      class="input"
      type="text"
      placeholder="add site or page, e.g. example.com/blog"
      style="flex: 1; min-width: 200px"
    >
    <button
      class="btn btn-primary"
      type="submit"
      :disabled="busy"
    >
      Add
    </button>
    <span
      v-if="error"
      class="error-text"
    >{{ error }}</span>
    <span
      v-else-if="preview"
      class="popup-load add-preview"
    >adds {{ preview }}</span>
  </form>
</template>

<style scoped>
.add-preview {
  flex-basis: 100%;
  overflow-wrap: anywhere;
}
</style>
