import { fileURLToPath } from 'node:url'

import tailwindcss from '@tailwindcss/vite'
import { tanstackRouter } from '@tanstack/router-plugin/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// Public marketing site (W9-S1, PUBLIC_WEB_LOVABLE.md): plain static Vite SPA — the
// Lovable original used TanStack Start/nitro; we build to dist and let Caddy serve it.
export default defineConfig({
  plugins: [
    tanstackRouter({ target: 'react', routesDirectory: 'src/routes', generatedRouteTree: 'src/routeTree.gen.ts', autoCodeSplitting: true }),
    react(),
    tailwindcss(),
  ],
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  server: {
    port: 5174,
    proxy: { '/v1': { target: process.env['API_PROXY_TARGET'] ?? 'http://localhost:3010', changeOrigin: false } },
  },
  preview: {
    port: 4174,
    // vite preview 403s unknown Hosts — the site serves orbetra.com behind Caddy
    allowedHosts: ['orbetra.com', 'www.orbetra.com'],
    proxy: { '/v1': { target: process.env['API_PROXY_TARGET'] ?? 'http://localhost:3010', changeOrigin: false } },
  },
})
