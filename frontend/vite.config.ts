import { fileURLToPath, URL } from 'node:url'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// O proxy encaminha chamadas /api para o backend (porta 3000 por padrão).
// Em container, VITE_PROXY_TARGET aponta para o serviço backend.
const proxyTarget = process.env.VITE_PROXY_TARGET ?? 'http://localhost:3000'

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  server: {
    host: true,
    port: 5173,
    proxy: {
      '/api': {
        target: proxyTarget,
        changeOrigin: true,
      },
    },
  },
})
