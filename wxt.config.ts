import { defineConfig } from 'wxt'
import { fileURLToPath, URL } from 'node:url'

// Glanceboard — Firefox MV2 extension, built with WXT.
// Build/run target Firefox (`-b firefox`) → Manifest V2 + persistent background page.
export default defineConfig({
  srcDir: 'src',
  modules: ['@wxt-dev/module-vue'],
  imports: false, // no auto-imports; keep imports explicit so eslint/tests need no generated types
  // The Firefox sources zip uses WXT's own excludeSources globs, NOT .gitignore — so gitignored
  // scratch dirs (e.g. tmp/ with HAR captures and review notes) would otherwise be bundled into the
  // submitted sources. Keep them out.
  zip: {
    excludeSources: ['tmp/**']
  },
  // Preserve the existing `@/...` imports used across the UI/lib.
  vite: () => ({
    resolve: {
      alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) }
    },
    define: {
      '__VUE_OPTIONS_API__': false,
      '__VUE_PROD_DEVTOOLS__': false,
      '__VUE_PROD_HYDRATION_MISMATCH_DETAILS__': false,
    }
  }),
  manifest: {
    name: 'Glanceboard',
    permissions: ['storage', 'alarms', 'webRequest', 'webRequestBlocking', 'notifications'],
    optional_permissions: [
      "http://*/*",
      "https://*/*"
    ],
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
