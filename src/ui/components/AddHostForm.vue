<script setup>
import { ref } from 'vue'
import { browser } from '@/lib/browser.js'
import { normalizeHost } from '@/lib/url.js'
import { addHost } from '@/lib/storage.js'

const input = ref('')
const error = ref('')
const busy = ref(false)

async function submit () {
  error.value = ''
  const n = normalizeHost(input.value)
  if (!n) { error.value = 'Enter a valid host or URL'; return }
  busy.value = true
  try {
    // Ask for host permission for just this origin (least privilege). Must run inside the
    // submit gesture — which this handler is.
    const granted = await browser.permissions.request({ origins: [n.originPattern] })
    if (!granted) { error.value = 'Permission is needed to monitor this host'; return }
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
      placeholder="add host, e.g. example.com"
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
  </form>
</template>
