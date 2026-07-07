import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['__tests__/**/*.spec.ts'],
    exclude: ['tests/pw/**'], // Playwright e2e — separate `pnpm e2e` task, not the hook gate
  },
})
