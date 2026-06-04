import { fileURLToPath, URL } from 'node:url'
import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import webExtension from 'vite-plugin-web-extension'

// Firefox-only Manifest V3 extension. `vite-plugin-web-extension` reads manifest.json,
// treats every file it references (background script, popup/dashboard HTML, icons) as a
// build input, bundles them, and rewrites the manifest paths to the built outputs.
export default defineConfig({
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url))
    }
  },
  plugins: [
    vue(),
    webExtension({
      manifest: 'manifest.json',
      browser: 'firefox',
      // We drive web-ext ourselves via npm scripts; don't auto-launch a browser on dev.
      disableAutoLaunch: true
    })
  ]
})
