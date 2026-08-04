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
    // reachable only from Caddy on the internal compose network, serving a static dist — the host
    // check guards a DEV server against DNS rebinding and has nothing to protect here (see
    // apps/web/vite.config.ts for the full reasoning)
    allowedHosts: true,
    // ONLY /v1/public — this proxy used to forward the whole /v1 prefix, which quietly undid the
    // marketing host's Caddy allow-list: anything not matching `/v1/public/*` fell through to
    // `site:4174`, and this proxy handed it to the api anyway. That is how `/v1/internal/caddy-ask`
    // stayed reachable from the public site (audit high).
    proxy: { '/v1/public': { target: process.env['API_PROXY_TARGET'] ?? 'http://localhost:3010', changeOrigin: false } },
  },
})
