import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    coverage: {
      provider: 'v8',
      include: ['src/**'],
      exclude: ['src/types.ts'], // type-only module, no runtime code
      thresholds: {
        branches: 95, // E01-4 AC
        lines: 95,
      },
    },
  },
})
