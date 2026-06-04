import vue from '@vitejs/plugin-vue'
import { defineConfig } from 'vite'

const apiTarget = process.env.API_TARGET ?? 'http://localhost:3180'

export default defineConfig({
  plugins: [vue()],
  server: {
    port: 5180,
    strictPort: true,
    proxy: {
      '/api': apiTarget
    }
  }
})
