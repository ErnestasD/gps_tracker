import { defineConfig, devices } from '@playwright/test'

/**
 * E02-6 smoke (deterministic, full real stack): global-setup boots testcontainers
 * redis+timescale, the ingest/worker/api processes, seeds 3 devices, builds the app
 * against the offline dev style and serves it via vite preview. No `webServer`
 * block — its start order relative to globalSetup is a known footgun.
 */
export default defineConfig({
  testDir: './tests/pw',
  globalSetup: './tests/pw/global-setup.ts',
  globalTeardown: './tests/pw/global-teardown.ts',
  timeout: 120_000,
  workers: 1, // one shared stack
  retries: 0,
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL: 'http://127.0.0.1:4173',
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        launchOptions: {
          // headless WebGL for Mapbox GL in CI
          args: ['--enable-unsafe-swiftshader', '--use-gl=swiftshader'],
        },
      },
    },
  ],
})
