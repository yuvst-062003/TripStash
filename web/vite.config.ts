import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Override when 8000 is taken on your machine: TRIPSTASH_API=http://127.0.0.1:8010 npm run dev
const API = process.env.TRIPSTASH_API ?? 'http://127.0.0.1:8000'

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    // The PWA and the API share an origin in development, so the service
    // worker caches /api paths the same way it will in production.
    proxy: {
      '/api': { target: API, changeOrigin: true },
      '/health': { target: API, changeOrigin: true },
    },
  },
  build: { outDir: 'dist', sourcemap: true },
})
