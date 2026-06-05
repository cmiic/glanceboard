import { createApp } from 'vue'
import App from '@/ui/App.vue'
import '@/ui/styles/tokens.css'
import '@/ui/styles/base.css'

createApp(App, { view: 'popup' }).mount('#app')
