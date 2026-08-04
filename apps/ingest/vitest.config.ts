import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    // the e2e specs drive a real Redis container through the simulator — vitest's 5 s default
    // measures runner load rather than correctness (see apps/api/vitest.config.ts)
    testTimeout: 30_000,
  },
})
