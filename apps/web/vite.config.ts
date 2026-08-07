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
        globPatterns: ['**/*.{js,css,html,svg,png,woff2}'],
        // The platform's own marks are never rendered on a white-label host, and precaching them
        // downloaded and STORED them in every tenant user's Cache Storage on first visit — three
        // entries literally named `orbetra-*` sitting in their devtools. `icons/**` is the same
        // mark in raster form and was missed the first time — the filter matched by NAME, not by
        // content; those files are reachable only through DEFAULT_ICONS, which fires on our hosts.
        globIgnores: ['**/orbetra-*', '**/platform-icon.*', '**/icons/**'],
        // fonts push the default 2 MiB limit; app-shell precache only, no tiles
        maximumFileSizeToCacheInBytes: 4 * 1024 * 1024,
      },
    }),
  ],
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) }, // mirrors tsconfig paths
  },
  server: { proxy },
  // `allowedHosts: true` — NOT an allow-list (audit high). Vite's preview validator rejects any
  // Host that is not an IP literal, localhost, or an exact/suffix match, and E03-5 white-label
  // tenants reach this container under THEIR OWN verified domains, which are per-tenant data and
  // cannot be enumerated at build time. With a fixed list, `track.customer.lt` got Caddy's cert,
  // resolved, and then answered `403 Blocked request` — while `/v1/branding` kept working (Caddy
  // routes it to the api), so the API and certificate looked perfectly healthy. V1-MUST
  // white-labeling was broken by config alone, which no test could catch.
  //
  // The host check exists to stop DNS rebinding against a DEV server on a developer's machine.
  // This is the preview server: reachable only from Caddy on the internal compose network, serving
  // a static dist with no filesystem or HMR surface. There is nothing to rebind to.
  preview: { proxy, allowedHosts: true },
})
