import { readFile, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'

import tailwindcss from '@tailwindcss/vite'
import { tanstackRouter } from '@tanstack/router-plugin/vite'
import react from '@vitejs/plugin-react'
import { defineConfig, type Plugin } from 'vite'

/** The marketing pages, in the order a reader meets them. Hand-kept: there are not many and they
 *  change about twice a year. The knowledge base is the part that cannot be. */
const STATIC_PAGES = [
  '/', '/pricing', '/tsp', '/pilot', '/signup', '/login', '/demo', '/partners', '/compatibility',
  '/docs', '/learn', '/cookies', '/terms', '/privacy', '/dpa', '/subprocessors', '/impressum',
]

/**
 * The sitemap, with every knowledge-base article in it.
 *
 * GENERATED at build rather than kept by hand: fifty-odd article URLs that must track the content
 * package are precisely the list that goes stale on the first article nobody remembers to add, and
 * a sitemap is only useful to the degree it is complete. There is no `public/sitemap.xml` any more:
 * two files both claiming to be the sitemap is how one of them ends up wrong, so `STATIC_PAGES`
 * above is the readable source of the non-article pages and this writes the only copy.
 *
 * One entry per article, not one per language: the site serves each article at a single URL and
 * switches language in the client, so a per-language URL does not exist to be indexed.
 */
function sitemap(origin = 'https://orbetra.com'): Plugin {
  return {
    name: 'orbetra-sitemap',
    apply: 'build',
    async closeBundle() {
      // The slugs are READ from the content package's generated metadata rather than imported:
      // Vite loads this config in Node with `@orbetra/kb` left external, and the package is
      // TypeScript source. A regex over a generated file is only safe because it fails LOUDLY —
      // an empty match throws and takes the build down rather than shipping a sitemap with the
      // articles missing, which is the failure a hand-kept list makes silently.
      const meta = await readFile(fileURLToPath(new URL('../../packages/kb/src/meta.ts', import.meta.url)), 'utf8')
      const slugs = [...meta.matchAll(/^ {4}slug: '([a-z0-9-]+)',$/gm)].map((m) => m[1])
      if (slugs.length < 20) throw new Error(`sitemap: read ${slugs.length} article slugs from packages/kb — the metadata shape changed`)
      const urls = [...STATIC_PAGES, ...slugs.map((s) => `/learn/${s}`)]
      const body = urls.map((u) => `  <url><loc>${origin}${u}</loc></url>`).join('\n')
      await writeFile(
        fileURLToPath(new URL('./dist/sitemap.xml', import.meta.url)),
        `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${body}\n</urlset>\n`,
        'utf8',
      )
    },
  }
}

// Public marketing site (W9-S1, PUBLIC_WEB_LOVABLE.md): plain static Vite SPA — the
// Lovable original used TanStack Start/nitro; we build to dist and let Caddy serve it.
export default defineConfig({
  plugins: [
    tanstackRouter({ target: 'react', routesDirectory: 'src/routes', generatedRouteTree: 'src/routeTree.gen.ts', autoCodeSplitting: true }),
    react(),
    tailwindcss(),
    sitemap(),
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
