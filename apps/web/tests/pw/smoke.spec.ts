import { expect, test } from '@playwright/test'

import { BASE_IMEI, DEVICES, E2E_EMAIL, E2E_PASSWORD, INGEST_PORT, PLATFORM_EMAIL, PLATFORM_PASSWORD, TRAIL_IMEI, TSX_BIN, UNKNOWN_IMEI, runToExit } from './stack'

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

  // restore the original password so later serial tests can still log in
  await page.goto('/app/settings')
  await page.getByTestId('current-password').fill(NEW_PW)
  await page.getByTestId('new-password').fill(E2E_PASSWORD)
  await page.getByTestId('change-password').click()
  await expect(page.getByTestId('password-msg')).not.toHaveText(/wrong/i)
})

test('devices: create in UI → appears → retire → ingest rejects that IMEI (E03-3 AC[2])', async ({ page }) => {
  const IMEI = '356307042449999'
  await page.goto('/login')
  await page.getByTestId('email-input').fill(E2E_EMAIL)
  await page.getByTestId('password-input').fill(E2E_PASSWORD)
  await page.getByTestId('login-submit').click()
  await page.waitForURL('**/app/map')

  await page.goto('/app/devices')
  await page.getByTestId('device-imei').fill(IMEI)
  await page.getByTestId('device-name').fill('E2E Truck')
  await page.getByTestId('device-create').click()
  await expect(page.getByTestId(`device-${IMEI}`)).toBeVisible({ timeout: 15_000 })

  // the created device is registered → a simulator on that IMEI is ACCEPTED
  const accepted = await runToExit(
    TSX_BIN,
    ['tools/simulator/src/main.ts', '--scenario', 'liveDrive', '--count', '1', '--hz', '4', '--port', String(INGEST_PORT), '--imei', IMEI],
    {},
  )
  expect(accepted).toBe(0) // exit 0 = not rejected

  // retire → registry teardown → the same IMEI is now REJECTED (0x00 → exit 1)
  await page.getByTestId(`retire-${IMEI}`).click()
  await expect(page.getByTestId(`device-${IMEI}`).getByText(/Retired|Išregistruotas|Wycofane|Stillgelegt/)).toBeVisible({ timeout: 15_000 })
  const rejected = await runToExit(
    TSX_BIN,
    ['tools/simulator/src/main.ts', '--scenario', 'liveDrive', '--count', '1', '--hz', '4', '--port', String(INGEST_PORT), '--imei', IMEI],
    {},
  )
  expect(rejected).toBe(1) // exit 1 = rejectedByImei
})

test('devices: CSV import dry-run shows per-row errors then applies (E03-3 AC[1])', async ({ page }) => {
  await page.goto('/login')
  await page.getByTestId('email-input').fill(E2E_EMAIL)
  await page.getByTestId('password-input').fill(E2E_PASSWORD)
  await page.getByTestId('login-submit').click()
  await page.waitForURL('**/app/map')
  await page.goto('/app/devices')

  // a tenant-wide caller must name the account per row — read it from the create form
  const accountId = await page.locator('[data-testid="device-account"] option').first().getAttribute('value')
  expect(accountId).toBeTruthy()

  // one valid (Luhn), one bad-checksum → preview reports 1 create + 1 error
  const csv = `imei,name,profileKey,accountId\n356307042441013,Good,fmb1xx,${accountId}\n356307042441011,Bad,fmb1xx,${accountId}`
  await page.getByTestId('import-csv').fill(csv)
  await page.getByTestId('import-preview').click()
  await expect(page.getByTestId('import-summary')).toContainText(/1 to create|1 kurti|1 do utworzenia|1 zu erstellen/)
  await expect(page.getByTestId('import-summary')).toContainText(/Luhn|IMEI/)
  await page.getByTestId('import-apply').click()
  await expect(page.getByTestId('import-done')).toBeVisible({ timeout: 15_000 })
  await expect(page.getByTestId('device-356307042441013')).toBeVisible()
})

test('quarantine: unknown IMEI → rejected → appears in quarantine → claim → accepted (E03-4 AC[1])', async ({ page }) => {
  // an unknown IMEI hitting ingest is REJECTED (0x00 → exit 1) and quarantined
  const rejected = await runToExit(
    TSX_BIN,
    ['tools/simulator/src/main.ts', '--scenario', 'liveDrive', '--count', '1', '--hz', '4', '--port', String(INGEST_PORT), '--imei', UNKNOWN_IMEI],
    {},
  )
  expect(rejected).toBe(1)

  // a platform_admin sees it in quarantine and claims it into the E2E tenant
  await page.goto('/login')
  await page.getByTestId('email-input').fill(PLATFORM_EMAIL)
  await page.getByTestId('password-input').fill(PLATFORM_PASSWORD)
  await page.getByTestId('login-submit').click()
  await page.waitForURL('**/app/map')
  await page.goto('/app/devices')

  await expect(page.getByTestId('quarantine-card')).toBeVisible()
  await expect(page.getByTestId(`quarantine-${UNKNOWN_IMEI}`)).toBeVisible({ timeout: 15_000 })
  await page.getByTestId(`claim-${UNKNOWN_IMEI}`).click()
  await expect(page.getByTestId('claim-dialog')).toBeVisible()
  await page.getByTestId('claim-name').fill('Claimed device')
  await page.getByTestId('claim-submit').click()
  await expect(page.getByTestId('claim-dialog')).toBeHidden({ timeout: 15_000 })

  // now the same IMEI is registered → ingest ACCEPTS it (data flows)
  const accepted = await runToExit(
    TSX_BIN,
    ['tools/simulator/src/main.ts', '--scenario', 'liveDrive', '--count', '1', '--hz', '4', '--port', String(INGEST_PORT), '--imei', UNKNOWN_IMEI],
    {},
  )
  expect(accepted).toBe(0)
})

test('quarantine: a tenant admin does NOT see the quarantine section (E03-4 AC[2] role gate)', async ({ page }) => {
  await page.goto('/login')
  await page.getByTestId('email-input').fill(E2E_EMAIL)
  await page.getByTestId('password-input').fill(E2E_PASSWORD)
  await page.getByTestId('login-submit').click()
  await page.waitForURL('**/app/map')
  await page.goto('/app/devices')
  await expect(page.getByTestId('devices-table').or(page.getByText(/No devices/i))).toBeVisible()
  await expect(page.getByTestId('quarantine-card')).toHaveCount(0)
})

test('branding: edit color + name → live preview updates; add domain → TXT instructions (E03-5)', async ({ page }) => {
  await page.goto('/login')
  await page.getByTestId('email-input').fill(E2E_EMAIL)
  await page.getByTestId('password-input').fill(E2E_PASSWORD)
  await page.getByTestId('login-submit').click()
  await page.waitForURL('**/app/map')

  await page.goto('/app/branding')
  await expect(page.getByTestId('branding-productName')).toBeVisible()

  // pick a distinctive primary → applyBranding writes it (contrast-adjusted) to
  // the --accent custom property live, before Save
  await page.getByTestId('branding-primary').fill('#ff3b30')
  await expect
    .poll(() => page.evaluate(() => document.documentElement.style.getPropertyValue('--accent').trim()))
    .not.toBe('')

  // productName drives the document title live (spec §1)
  await page.getByTestId('branding-productName').fill('Acme Fleet')
  await expect.poll(() => page.title()).toBe('Acme Fleet')

  // persist → reload → the saved branding re-applies from GET /v1/tenant/branding
  await page.getByTestId('branding-save').click()
  await expect(page.getByTestId('branding-saved')).toBeVisible()
  await page.reload()
  await expect(page.getByTestId('branding-productName')).toHaveValue('Acme Fleet')

  // add a custom domain → server returns a TXT token → instructions render
  await page.getByTestId('domain-input').fill('fleet.acme-e2e.test')
  await page.getByTestId('domain-add').click()
  await expect(page.getByTestId('txt-instructions')).toContainText('orbetra-verify=')
  await expect(page.getByTestId('domain-fleet.acme-e2e.test')).toBeVisible()
  // unverified until DNS TXT is present (no real DNS in CI) → shows Verify affordance
  await expect(page.getByTestId('verify-fleet.acme-e2e.test')).toBeVisible()
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
