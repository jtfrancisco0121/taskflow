import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { configDefaults, defineConfig } from 'vitest/config'

// The browser always calls relative /api URLs; Vite proxies them to the backend (AD-5, no CORS).
export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 5173,
    proxy: {
      '/api': process.env.VITE_API_PROXY_TARGET ?? 'http://localhost:8080',
      // STOMP over native WebSocket (AD-13)
      '/ws': { target: process.env.VITE_API_PROXY_TARGET ?? 'http://localhost:8080', ws: true },
    },
  },
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    exclude: ['e2e/**', ...configDefaults.exclude],
  },
})
