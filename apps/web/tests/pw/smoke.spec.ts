import { expect, test } from '@playwright/test'

import { BASE_IMEI, DEVICES, E2E_EMAIL, E2E_PASSWORD, INGEST_PORT, TRAIL_IMEI, TSX_BIN, runToExit } from './stack'

/**
 * E02-6 smoke (story AC + the full-chain <2 s assertion E02-4 deferred here):
 * login → live map → simulator drives 3 devices through ingest→worker→WS →
 * markers appear. DOM assertions on DeviceList, not canvas pixels — degraded
 * CI WebGL cannot flake this.
 */
test.describe.configure({ mode: 'serial' })

test('wrong password → inline error, stays on /login', async ({ page }) => {
  await page.goto('/login')
  await page.getByTestId('email-input').fill(E2E_EMAIL)
  await page.getByTestId('password-input').fill('wrong-password')
  await page.getByTestId('login-submit').click()
  await expect(page.getByTestId('login-error')).toBeVisible()
  expect(page.url()).toContain('/login')
})

test('login → map: OSM attribution visible, WS live, simulator devices appear', async ({ page }) => {
  await page.goto('/login')
  await page.getByTestId('email-input').fill(E2E_EMAIL)
  await page.getByTestId('password-input').fill(E2E_PASSWORD)
  await page.getByTestId('login-submit').click()
  await page.waitForURL('**/app/map')

  // E03-1: session survives reload — access token is memory-only, the httpOnly
  // refresh cookie + router guard restore it without bouncing to /login
  await page.reload()
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

test('invalid-fix: no-fix stretch renders a dashed trail gap (I5, E02-7 AC[2])', async ({ page }) => {
  await page.goto('/login')
  await page.getByTestId('email-input').fill(E2E_EMAIL)
  await page.getByTestId('password-input').fill(E2E_PASSWORD)
  await page.getByTestId('login-submit').click()
  await page.waitForURL('**/app/map')
  await expect(page.getByTestId('conn-badge')).toHaveText(/Live/i, { timeout: 15_000 })

  // make the trail device exist in the panel (one clean liveDrive record)
  expect(
    await runToExit(
      TSX_BIN,
      ['tools/simulator/src/main.ts', '--scenario', 'liveDrive', '--count', '1', '--hz', '4', '--port', String(INGEST_PORT), '--imei', TRAIL_IMEI],
      {},
    ),
  ).toBe(0)
  await page.getByTestId(`device-row-${TRAIL_IMEI}`).click({ timeout: 30_000 })

  // trail accumulates from the WS stream from selection time — enable BEFORE the drive
  await page.getByTestId('trail-toggle').click()
  await page.getByTestId('follow-toggle').click() // keeps the gap inside the viewport

  // every 3rd record is a §3.4 invalid fix (last valid coords, sat=0)
  expect(
    await runToExit(
      TSX_BIN,
      ['tools/simulator/src/main.ts', '--scenario', 'invalidFix', '--count', '12', '--hz', '4', '--port', String(INGEST_PORT), '--imei', TRAIL_IMEI],
      {},
    ),
  ).toBe(0)

  // assert on RENDERED features via the map handle — not canvas pixels
  await expect
    .poll(
      () =>
        page.evaluate(() => {
          const el = document.querySelector('[data-testid="live-map"]') as
            | (HTMLDivElement & { __map?: { queryRenderedFeatures: (o: { layers: string[] }) => unknown[] } })
            | null
          return el?.__map?.queryRenderedFeatures({ layers: ['trail-gap'] }).length ?? 0
        }),
      { timeout: 30_000 },
    )
    .toBeGreaterThan(0)

  // zoom in so the PR artifact actually shows the dashed stretch
  await page.evaluate(() => {
    const el = document.querySelector('[data-testid="live-map"]') as
      | (HTMLDivElement & { __map?: { easeTo: (o: { zoom: number; duration: number }) => void } })
      | null
    el?.__map?.easeTo({ zoom: 16.5, duration: 300 })
  })
  await page.waitForTimeout(1_000)
  await page.screenshot({ path: 'test-results/trail-gap.png' }) // PR visual artifact
})

test('settings: theme toggle + password change → re-login with the new password (E03-2)', async ({ page }) => {
  await page.goto('/login')
  await page.getByTestId('email-input').fill(E2E_EMAIL)
  await page.getByTestId('password-input').fill(E2E_PASSWORD)
  await page.getByTestId('login-submit').click()
  await page.waitForURL('**/app/map')

  await page.goto('/app/settings')
  await expect(page.getByTestId('settings-page')).toBeVisible()

  // theme toggle flips the <html> class
  await page.getByTestId('theme-light').click()
  await expect(page.locator('html')).toHaveClass(/light/)
  await page.getByTestId('theme-dark').click()
  await expect(page.locator('html')).not.toHaveClass(/light/)

  // wrong current password → inline error
  await page.getByTestId('current-password').fill('definitely-wrong')
  await page.getByTestId('new-password').fill('brand-new-password-1')
  await page.getByTestId('change-password').click()
  await expect(page.getByTestId('password-msg')).toHaveText(/wrong/i)

  // correct current password → success (also revokes this session's refresh family)
  const NEW_PW = 'brand-new-password-1'
  await page.getByTestId('current-password').fill(E2E_PASSWORD)
  await page.getByTestId('new-password').fill(NEW_PW)
  await page.getByTestId('change-password').click()
  await expect(page.getByTestId('password-msg')).not.toHaveText(/wrong/i)

  // the new password logs in; the old one no longer does
  await page.evaluate(() => sessionStorage.clear())
  await page.goto('/login')
  await page.getByTestId('email-input').fill(E2E_EMAIL)
  await page.getByTestId('password-input').fill(NEW_PW)
  await page.getByTestId('login-submit').click()
  await page.waitForURL('**/app/map')
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
