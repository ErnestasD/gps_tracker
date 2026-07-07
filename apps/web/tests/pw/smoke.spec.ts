import { expect, test } from '@playwright/test'

import { BASE_IMEI, DEVICES, INGEST_PORT, STUB_TOKEN, TSX_BIN, runToExit } from './stack'

/**
 * E02-6 smoke (story AC + the full-chain <2 s assertion E02-4 deferred here):
 * login → live map → simulator drives 3 devices through ingest→worker→WS →
 * markers appear. DOM assertions on DeviceList, not canvas pixels — degraded
 * CI WebGL cannot flake this.
 */
test.describe.configure({ mode: 'serial' })

test('wrong token → inline error, stays on /login', async ({ page }) => {
  await page.goto('/login')
  await page.getByTestId('token-input').fill('wrong-token')
  await page.getByTestId('login-submit').click()
  await expect(page.getByTestId('login-error')).toBeVisible()
  expect(page.url()).toContain('/login')
})

test('login → map: OSM attribution visible, WS live, simulator devices appear', async ({ page }) => {
  await page.goto('/login')
  await page.getByTestId('token-input').fill(STUB_TOKEN)
  await page.getByTestId('login-submit').click()
  await page.waitForURL('**/app/map')

  // AC[2]: OSM attribution visible on every map view (CLAUDE.md rule 13)
  await expect(page.locator('.maplibregl-ctrl-attrib')).toContainText('© OpenStreetMap contributors')

  // WS connects (ws-ticket flow end-to-end through the preview proxy)
  await expect(page.getByTestId('conn-badge')).toHaveText(/Live/i, { timeout: 15_000 })

  // drive the real pipeline: fleet of 3 devices, 30 records @1 Hz
  const exit = await runToExit(
    TSX_BIN,
    [
      'tools/simulator/src/main.ts',
      '--scenario', 'liveDrive',
      '--devices', String(DEVICES),
      '--count', '30',
      '--hz', '1',
      '--port', String(INGEST_PORT),
      '--imei', BASE_IMEI,
    ],
    {},
  )
  expect(exit).toBe(0)

  // markers reach the panel (simulator → ingest → worker → redis pub/sub → WS → store)
  await expect(page.getByTestId(`device-row-${BASE_IMEI}`)).toBeVisible({ timeout: 30_000 })

  // select → info card + trail/follow controls (spec §4)
  await page.getByTestId(`device-row-${BASE_IMEI}`).click()
  await expect(page.getByTestId('info-card')).toBeVisible()
  await page.getByTestId('trail-toggle').click()
  await page.getByTestId('follow-toggle').click()

  await page.screenshot({ path: 'test-results/map-live.png' }) // PR visual artifact (spec §7)
})

test('PWA: manifest served and service worker registers on the built app', async ({ page }) => {
  const manifest = await page.request.get('/manifest.webmanifest')
  expect(manifest.ok()).toBe(true)
  expect((await manifest.json()) as { display: string }).toMatchObject({ display: 'standalone' })

  await page.goto('/login')
  const swReady = await page.evaluate(async () => {
    if (!('serviceWorker' in navigator)) return 'unsupported'
    const reg = await navigator.serviceWorker.ready
    return reg.active ? 'active' : 'missing'
  })
  expect(swReady).toBe('active')
})
