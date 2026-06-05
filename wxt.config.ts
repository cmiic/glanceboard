import { defineConfig } from 'wxt'
import { fileURLToPath, URL } from 'node:url'

// Glanceboard — Firefox MV2 extension, built with WXT.
// Build/run target Firefox (`-b firefox`) → Manifest V2 + persistent background page.
export default defineConfig({
  srcDir: 'src',
  modules: ['@wxt-dev/module-vue'],
  imports: false, // no auto-imports; keep imports explicit so eslint/tests need no generated types
  // Preserve the existing `@/...` imports used across the UI/lib.
  vite: () => ({
    resolve: {
      alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) }
    }
  }),
  manifest: {
    name: 'Glanceboard',
    permissions: ['storage', 'alarms', 'webRequest', 'webRequestBlocking', 'notifications'],
    optional_permissions: ['*://*/*'],
    browser_specific_settings: {
      gecko: {
        id: 'glanceboard@miic.at',
        strict_min_version: '142.0',
        data_collection_permissions: { required: ['none'] }
      }
    },
    icons: {
      192: '/icons/icon-small.png',
      512: '/icons/icon-large.png'
    }
  }
})
