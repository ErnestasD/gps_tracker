import { defineConfig } from 'vitest/config'

// Root-level runner convenience (`pnpm vitest` from repo root).
// The CI path is per-package `vitest run` via turbo — each package has its own config.
export default defineConfig({
  test: {
    projects: ['apps/*', 'packages/*', 'tools/*'],
  },
})
