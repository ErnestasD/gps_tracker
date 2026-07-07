import { fileURLToPath } from 'node:url'

import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import { VitePWA } from 'vite-plugin-pwa'

// /v1 (http + ws) proxied to the api so the browser stays same-origin — the api has
// no CORS middleware by design (prod: Caddy serves web+api from one origin).
const apiTarget = process.env['API_PROXY_TARGET'] ?? 'http://localhost:3010'
const proxy = {
  '/v1': { target: apiTarget, ws: true, changeOrigin: true },
}

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      strategies: 'injectManifest',
      srcDir: '.',
      filename: 'sw.ts',
      injectRegister: null, // registered manually in main.tsx
      manifest: false, // static public/manifest.webmanifest is the source of truth
      injectManifest: {
        globPatterns: ['**/*.{js,css,html,svg,png,webmanifest,woff2}'],
        // fonts push the default 2 MiB limit; app-shell precache only, no tiles
        maximumFileSizeToCacheInBytes: 4 * 1024 * 1024,
      },
    }),
  ],
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) }, // mirrors tsconfig paths
  },
  server: { proxy },
  preview: { proxy },
})
