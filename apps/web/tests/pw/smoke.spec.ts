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

test('login → map: Mapbox mark visible, WS live, simulator devices appear', async ({ page }) => {
  await page.goto('/login')
  await page.getByTestId('email-input').fill(E2E_EMAIL)
  await page.getByTestId('password-input').fill(E2E_PASSWORD)
  await page.getByTestId('login-submit').click()
  await page.waitForURL(/\/app\/?$/)

  // E03-1: session survives reload — access token is memory-only, the httpOnly
  // refresh cookie + router guard restore it without bouncing to /login
  await page.reload()
  await page.waitForURL(/\/app\/?$/)

  // AC[2]/ADR-030: the Mapbox mark stays visible on every map view (TOS). The offline
  // e2e style has no tile sources, so the TEXT attribution is empty here — but mapbox-gl
  // renders the logo control regardless (only a source with mapbox_logo:false hides it);
  // real mapbox:// styles additionally show "© Mapbox © OpenStreetMap" in the attrib bar.
  await expect(page.locator('.mapboxgl-ctrl-logo')).toBeVisible()
  await expect(page.locator('.mapboxgl-ctrl-attrib')).toBeAttached()

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
  await expect(page.getByTestId('overview-tab')).toBeVisible()
  await page.getByTestId('trail-toggle').click()
  await page.getByTestId('follow-toggle').click()

  await page.screenshot({ path: 'test-results/map-live.png' }) // PR visual artifact (spec §7)
})

test('invalid-fix: no-fix stretch renders a dashed trail gap (I5, E02-7 AC[2])', async ({ page }) => {
  // The trail layers are behind an operator-controlled, localStorage-backed toggle, and
  // queryRenderedFeatures returns nothing from a layer whose visibility is 'none'. A fresh context
  // defaults to on, so this passes either way — stating it makes the test independent of a default
  // someone may reasonably change.
  await page.addInitScript(() => {
    localStorage.setItem('orbetra.map.layers', JSON.stringify({ geofences: true, trails: true, labels: false, heat: false }))
  })
  await page.goto('/login')
  await page.getByTestId('email-input').fill(E2E_EMAIL)
  await page.getByTestId('password-input').fill(E2E_PASSWORD)
  await page.getByTestId('login-submit').click()
  await page.waitForURL(/\/app\/?$/)
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
  await page.waitForURL(/\/app\/?$/)

  await page.goto('/app/settings')
  await expect(page.getByTestId('settings-page')).toBeVisible()

  // theme toggle flips the <html> class
  await page.getByTestId('theme-light').click()
  await expect(page.locator('html')).toHaveClass(/light/)
  await page.getByTestId('theme-dark').click()
  await expect(page.locator('html')).not.toHaveClass(/light/)

  // wrong current password → inline error
  await page.getByTestId('settings-tab-security').click()
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
  await page.waitForURL(/\/app\/?$/)

  // restore the original password so later serial tests can still log in
  await page.goto('/app/settings')
  await page.getByTestId('settings-tab-security').click()
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
  await page.waitForURL(/\/app\/?$/)

  await page.goto('/app/devices')
  // design round 2: the create form lives in a right Sheet behind "Add device"
  await page.getByTestId('device-add-open').click()
  await page.getByTestId('device-imei').fill(IMEI)
  await page.getByTestId('device-name').fill('E2E Truck')
  await page.getByTestId('device-create').click()
  await expect(page.getByTestId(`device-${IMEI}`)).toBeVisible({ timeout: 15_000 })

  // The odometer-source selector is GONE from the table (founder): the server default 'auto'
  // already prefers a sane device odometer and falls back to GPS — no per-row choice to test.

  // the created device is registered → a simulator on that IMEI is ACCEPTED
  const accepted = await runToExit(
    TSX_BIN,
    ['tools/simulator/src/main.ts', '--scenario', 'liveDrive', '--count', '1', '--hz', '4', '--port', String(INGEST_PORT), '--imei', IMEI],
    {},
  )
  expect(accepted).toBe(0) // exit 0 = not rejected

  // retire → registry teardown → the same IMEI is now REJECTED (0x00 → exit 1).
  // Retire sits in the per-row "..." menu and is gated by a ConfirmDialog (round 2).
  await page.getByTestId(`row-menu-${IMEI}`).click()
  await page.getByTestId(`retire-${IMEI}`).click()
  await page.getByTestId('confirm-ok').click()
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
  await page.waitForURL(/\/app\/?$/)
  await page.goto('/app/devices')

  // a tenant-wide caller must name the account per row — read it from the create form
  // (which now lives in the "Add device" Sheet; close it again before importing).
  // The account picker is a Combobox: its trigger's data-value carries the resolved default
  // account id (non-empty only once the accounts query lands — poll for it).
  await page.getByTestId('device-add-open').click()
  await expect(page.getByTestId('device-account')).toHaveAttribute('data-value', /.+/)
  const accountId = await page.getByTestId('device-account').getAttribute('data-value')
  expect(accountId).toBeTruthy()
  await page.keyboard.press('Escape')

  // one valid (Luhn), one bad-checksum → preview reports 1 create + 1 error
  const csv = `imei,name,profileKey,accountId\n356307042441013,Good,fmb1xx,${accountId}\n356307042441011,Bad,fmb1xx,${accountId}`
  await page.getByTestId('import-open').click()
  await page.getByTestId('import-csv').fill(csv)
  await page.getByTestId('import-preview').click()
  await expect(page.getByTestId('import-summary')).toContainText(/1 to create|1 kurti|1 do utworzenia|1 zu erstellen/)
  await expect(page.getByTestId('import-summary')).toContainText(/Luhn|IMEI/)
  await page.getByTestId('import-apply').click()
  await expect(page.getByTestId('import-done')).toBeVisible({ timeout: 15_000 })
  await page.keyboard.press('Escape') // close the import sheet to reveal the table
  await expect(page.getByTestId('device-356307042441013')).toBeVisible()
})

test('commands: preset queues in history; destructive needs a second confirming click (E08-2b)', async ({ page }) => {
  const IMEI = '356307042448887'
  const IMEI2 = '356307042448888'
  await page.goto('/login')
  await page.getByTestId('email-input').fill(E2E_EMAIL)
  await page.getByTestId('password-input').fill(E2E_PASSWORD)
  await page.getByTestId('login-submit').click()
  await page.waitForURL(/\/app\/?$/)

  await page.goto('/app/devices')
  for (const [imei, name] of [[IMEI, 'E2E Cmd Van'], [IMEI2, 'E2E Cmd Van 2']] as const) {
    await page.getByTestId('device-add-open').click() // create form Sheet (closes on success)
    await page.getByTestId('device-imei').fill(imei)
    await page.getByTestId('device-name').fill(name)
    await page.getByTestId('device-create').click()
    await expect(page.getByTestId(`device-${imei}`)).toBeVisible({ timeout: 15_000 })
  }

  // count real POSTs — the "arming click sends nothing" assertions below must not be
  // satisfiable by mere refetch latency
  let commandPosts = 0
  page.on('request', (req) => {
    if (req.method() === 'POST' && /\/v1\/devices\/[^/]+\/commands$/.test(req.url())) commandPosts++
  })

  // open the per-device command panel (via the row "..." menu) and send a read-only
  // preset — one click, no gate
  await page.getByTestId(`row-menu-${IMEI}`).click()
  await page.getByTestId(`commands-${IMEI}`).click()
  await expect(page.getByTestId('commands-card')).toBeVisible()
  await page.getByTestId('preset-getinfo').click()
  await expect(page.getByTestId('command-text')).toHaveValue('getinfo')
  await page.getByTestId('command-send').click()
  // the device is offline, so the command sits queued (or fails later) — the row must exist
  await expect(page.getByTestId('commands-table')).toContainText('getinfo', { timeout: 15_000 })
  expect(commandPosts).toBe(1)

  // destructive preset: first click only ARMS (warning shown, ZERO posts fired)…
  await page.getByTestId('preset-deleterecords').click()
  await page.getByTestId('command-send').click()
  await expect(page.getByTestId('command-armed')).toBeVisible()
  expect(commandPosts).toBe(1)

  // …switching to ANOTHER device must fully disarm (armed state may never carry over —
  // one click here would otherwise wipe a device the operator never confirmed)
  await page.getByTestId(`row-menu-${IMEI2}`).click()
  await page.getByTestId(`commands-${IMEI2}`).click()
  await expect(page.getByTestId('command-armed')).not.toBeVisible()
  await expect(page.getByTestId('command-text')).toHaveValue('')

  // back on the first device: re-arm, then the second (post-dwell) click actually sends
  await page.getByTestId(`row-menu-${IMEI}`).click()
  await page.getByTestId(`commands-${IMEI}`).click()
  await page.getByTestId('preset-deleterecords').click()
  await page.getByTestId('command-send').click()
  await expect(page.getByTestId('command-armed')).toBeVisible()
  expect(commandPosts).toBe(1)
  await page.getByTestId('command-send').click() // playwright waits out the dwell-disable
  await expect(page.getByTestId('commands-table')).toContainText('deleterecords', { timeout: 15_000 })
  await expect(page.getByTestId('command-armed')).not.toBeVisible()
  expect(commandPosts).toBe(2)
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
  // a platform_admin now lands in the CONSOLE, not on a fleet map — their home is the business,
  // not whichever tenant their user row happens to live in
  await page.waitForURL('**/platform')
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
  await page.waitForURL(/\/app\/?$/)
  await page.goto('/app/devices')
  await expect(page.getByTestId('devices-table').or(page.getByText(/No devices/i))).toBeVisible()
  await expect(page.getByTestId('quarantine-card')).toHaveCount(0)
})

test('branding: edit color + name → live preview updates; add domain → TXT instructions (E03-5)', async ({ page }) => {
  await page.goto('/login')
  await page.getByTestId('email-input').fill(E2E_EMAIL)
  await page.getByTestId('password-input').fill(E2E_PASSWORD)
  await page.getByTestId('login-submit').click()
  await page.waitForURL(/\/app\/?$/)

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

test('audit: an admin sees the mutation trail, filters it, and expands a snapshot (E03-6)', async ({ page }) => {
  await page.goto('/login')
  await page.getByTestId('email-input').fill(E2E_EMAIL)
  await page.getByTestId('password-input').fill(E2E_PASSWORD)
  await page.getByTestId('login-submit').click()
  await page.waitForURL(/\/app\/?$/)

  // cause a fresh, findable mutation (branding update → a branding:update audit row)
  await page.goto('/app/branding')
  await page.getByTestId('branding-productName').fill('Audit Probe Co')
  await page.getByTestId('branding-save').click()
  await expect(page.getByTestId('branding-saved')).toBeVisible()

  // the audit page (admin-only nav) shows rows
  await page.goto('/app/audit')
  await expect(page.getByTestId('audit-table')).toBeVisible({ timeout: 15_000 })

  // filter to branding entries and expand the newest one → before/after snapshot
  // (entity filter is a Combobox: open the trigger, click the option)
  await page.getByTestId('audit-entity').click()
  await page.getByRole('option', { name: 'Branding', exact: true }).click()
  const firstRow = page.getByTestId('audit-table').locator('tbody tr[data-testid^="audit-row-"]').first()
  await expect(firstRow).toBeVisible({ timeout: 15_000 })
  await firstRow.getByRole('button').click()
  await expect(page.getByText('"productName": "Audit Probe Co"')).toBeVisible()
})

test('playback: history page loads a device trail with a scrubbable speed chart (E04-3)', async ({ page }) => {
  await page.goto('/login')
  await page.getByTestId('email-input').fill(E2E_EMAIL)
  await page.getByTestId('password-input').fill(E2E_PASSWORD)
  await page.getByTestId('login-submit').click()
  await page.waitForURL(/\/app\/?$/)

  // drive the base device so it has fresh positions in the last-24h default range
  expect(
    await runToExit(
      TSX_BIN,
      ['tools/simulator/src/main.ts', '--scenario', 'liveDrive', '--count', '20', '--hz', '4', '--port', String(INGEST_PORT), '--imei', BASE_IMEI],
      {},
    ),
  ).toBe(0)

  await page.goto('/app/playback')
  await expect(page.getByTestId('playback-device')).toBeVisible()
  await expect(page.getByTestId('playback-map')).toBeVisible()

  // pick the DB device that owns BASE_IMEI ("Good", created by the CSV-import test) — the
  // dropdown auto-selects the FIRST device, which may have no positions. The old
  // `.or(playback-empty)` tolerance silently skipped every assertion below (review LOW).
  // The device picker is a Combobox (design round 2): open it, click the option
  // (options carry role=option since the round-2 ARIA pass).
  await page.getByTestId('playback-device').click()
  await page.getByRole('option', { name: 'Good', exact: true }).click()

  // we DROVE BASE_IMEI above, so its history must load — an empty state here is a failure
  await expect(page.getByTestId('speed-chart')).toBeVisible({ timeout: 20_000 })

  // Play animates the scrub index forward; Pause stops it (round 2 "Groti")
  await page.getByTestId('playback-start').click()
  await page.getByTestId('playback-play').click()
  await expect.poll(async () => Number(await page.getByTestId('playback-scrub').inputValue())).toBeGreaterThan(0)
  await page.getByTestId('playback-play').click() // pause

  // scrubbing updates the current-sample readout without crashing
  await page.getByTestId('playback-end').click()
  await expect(page.getByTestId('playback-current')).toBeVisible()
  await page.getByTestId('playback-scrub').fill('0')
  // E08-3: the simulator reports AVL 89 fuel %, so the AVL-gated fuel graph must appear
  await expect(page.getByTestId('fuel-chart')).toBeVisible({ timeout: 15_000 })
  await expect(page.getByTestId('fuel-last')).toContainText('%')
})

test('trips: the trips page lists trips (or empty) and a row opens its route detail (E04-4)', async ({ page }) => {
  await page.goto('/login')
  await page.getByTestId('email-input').fill(E2E_EMAIL)
  await page.getByTestId('password-input').fill(E2E_PASSWORD)
  await page.getByTestId('login-submit').click()
  await page.waitForURL(/\/app\/?$/)

  await page.goto('/app/trips')
  await expect(page.getByTestId('trips-device')).toBeVisible()
  // a real trip needs a sustained/long drive (E04-1 thresholds); the list renders either
  // way — assert the page integrates with the API (table or empty), then exercise detail
  await expect(page.getByTestId('trips-table').or(page.getByTestId('trips-empty'))).toBeVisible({ timeout: 15_000 })
  if (await page.getByTestId('trips-table').isVisible()) {
    await page.locator('tbody tr[data-testid^="trip-row-"]').first().click()
    await expect(page.getByTestId('trip-detail')).toBeVisible()
  } else {
    await expect(page.getByTestId('trip-detail-empty')).toBeVisible()
  }
})

test('geofences: the drawing editor mounts on the map and the list renders (E05-1)', async ({ page }) => {
  await page.goto('/login')
  await page.getByTestId('email-input').fill(E2E_EMAIL)
  await page.getByTestId('password-input').fill(E2E_PASSWORD)
  await page.getByTestId('login-submit').click()
  await page.waitForURL(/\/app\/?$/)

  await page.goto('/app/geofences')
  // the map + in-house drawing editor initialise without crashing (real Mapbox GL)
  await expect(page.getByTestId('geofence-map')).toBeVisible()
  await expect(page.getByTestId('gf-mode-polygon')).toBeVisible()
  await expect(page.getByTestId('gf-mode-circle')).toBeVisible()
  // list is present (empty for a fresh tenant, or shows rows) — checked BEFORE drafting,
  // because entering draft mode swaps the aside to the DraftPanel (round-2 idiom)
  await expect(page.getByTestId('gf-list').or(page.getByTestId('gf-empty'))).toBeVisible({ timeout: 15_000 })
  // entering draw mode doesn't throw: the DraftPanel replaces the list and Save (now in the
  // header) stays disabled until a shape + name exist
  await page.getByTestId('gf-mode-polygon').click()
  await expect(page.getByTestId('gf-draft-panel')).toBeVisible()
  await expect(page.getByTestId('gf-save')).toBeDisabled()
})

test('rules: create an overspeed rule → appears, toggles, deletes (E05-3)', async ({ page }) => {
  await page.goto('/login')
  await page.getByTestId('email-input').fill(E2E_EMAIL)
  await page.getByTestId('password-input').fill(E2E_PASSWORD)
  await page.getByTestId('login-submit').click()
  await page.waitForURL(/\/app\/?$/)

  await page.goto('/app/rules')
  // design round 2: the create form lives in a right Sheet behind "Add rule"
  await page.getByTestId('rule-add-open').click()
  await expect(page.getByTestId('rule-kind')).toBeVisible()
  // overspeed is the default kind → the speed config field is shown
  await expect(page.getByTestId('rule-cfg-speedKmh')).toBeVisible()
  await page.getByTestId('rule-name').fill('Speeding')
  await page.getByTestId('rule-cfg-speedKmh').fill('80')
  await page.getByTestId('rule-create').click()

  // it lands in the list, enabled by default
  const row = page.locator('li[data-testid^="rule-"]').filter({ hasText: 'Speeding' })
  await expect(row).toBeVisible({ timeout: 15_000 })
  // controlled AdminSwitch (round-2 control sweep): aria-checked reflects server state,
  // which only flips after the PATCH + refetch round-trips — the assertion polls for it.
  await row.getByRole('switch').click()
  await expect(row.getByRole('switch')).toHaveAttribute('aria-checked', 'false')

  // switching kind to geofence swaps the config fields (form lives in the Sheet — reopen it;
  // the kind picker is a Combobox: open the trigger, click the option)
  await page.getByTestId('rule-add-open').click()
  await page.getByTestId('rule-kind').click()
  await page.getByRole('option', { name: 'Geofence', exact: true }).click()
  await expect(page.getByTestId('rule-cfg-on')).toBeVisible()
  await page.keyboard.press('Escape') // close the sheet to uncover the list

  // delete is gated by a danger ConfirmDialog (round 2)
  await row.getByTestId(/rule-del-/).click()
  await page.getByTestId('confirm-ok').click()
  await expect(row).toHaveCount(0)
})

test('events: timeline page loads with filters (E05-6)', async ({ page }) => {
  await page.goto('/login')
  await page.getByTestId('email-input').fill(E2E_EMAIL)
  await page.getByTestId('password-input').fill(E2E_PASSWORD)
  await page.getByTestId('login-submit').click()
  await page.waitForURL(/\/app\/?$/)

  await page.goto('/app/events')
  // filters are present; the list is either a table or the empty state (no events required)
  await expect(page.getByTestId('events-kind')).toBeVisible()
  await expect(page.getByTestId('events-device')).toBeVisible()
  await expect(page.getByTestId('events-from')).toBeVisible()
  // a garbage-safe filter change must not error the page (repo sanitizes)
  // (kind filter is a Combobox: open the trigger, click the option)
  await page.getByTestId('events-kind').click()
  await page.getByRole('option', { name: 'Panic', exact: true }).click()
  await expect(page.getByTestId('events-table').or(page.getByTestId('events-empty'))).toBeVisible()
})

test('reports: run a report over a range (E06-2)', async ({ page }) => {
  await page.goto('/login')
  await page.getByTestId('email-input').fill(E2E_EMAIL)
  await page.getByTestId('password-input').fill(E2E_PASSWORD)
  await page.getByTestId('login-submit').click()
  await page.waitForURL(/\/app\/?$/)

  await page.goto('/app/reports')
  await expect(page.getByTestId('report-type')).toBeVisible()
  await expect(page.getByTestId('report-idle')).toBeVisible() // nothing run yet
  // Run is disabled until both bounds are set
  await expect(page.getByTestId('report-run')).toBeDisabled()
  // date pickers are DayPicker popovers (round-2 amendment); day cells render as
  // role=gridcell buttons carrying a full yyyy-MM-dd accessible name. The picker opens on the
  // CURRENT month, so pick dates IN it (computed at run time, not hardcoded — a fixed July date
  // became unreachable once wall-clock rolled past it). Day 01 + 28 exist in every month; the
  // report only needs to RUN (result asserts table OR empty), so no seeded data in-range is needed.
  const now = new Date()
  const ym = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
  await page.getByTestId('report-from').click()
  await page.getByRole('gridcell', { name: `${ym}-01`, exact: true }).click()
  await page.getByTestId('report-to').click()
  await page.getByRole('gridcell', { name: `${ym}-28`, exact: true }).click()
  await page.getByTestId('report-run').click()
  // the result panel resolves to a table or the empty state (no trips required)
  await expect(page.getByTestId('report-table').or(page.getByTestId('report-empty'))).toBeVisible()
})

test('api keys: create shows the plaintext once, then revoke (E06-3 UI)', async ({ page }) => {
  await page.goto('/login')
  await page.getByTestId('email-input').fill(E2E_EMAIL)
  await page.getByTestId('password-input').fill(E2E_PASSWORD)
  await page.getByTestId('login-submit').click()
  await page.waitForURL(/\/app\/?$/)

  await page.goto('/app/api-keys')
  // design round 2: the create form lives in a right Sheet behind "Create a key"
  await page.getByTestId('apikey-add-open').click()
  await expect(page.getByTestId('apikey-name')).toBeVisible()
  await page.getByTestId('apikey-name').fill('CI integration')
  await page.getByTestId('apikey-create').click()

  // the plaintext key is shown ONCE
  const fresh = page.getByTestId('apikey-value')
  await expect(fresh).toBeVisible()
  await expect(fresh).toHaveText(/^orb_live_/)
  await page.getByTestId('apikey-dismiss').click()
  await expect(page.getByTestId('apikey-fresh')).toHaveCount(0)

  // it lands in the list, active; revoking flips it
  const row = page.locator('li[data-testid^="apikey-"]').filter({ hasText: 'CI integration' })
  await expect(row).toBeVisible({ timeout: 15_000 })
  // revoke is gated by a danger ConfirmDialog (round 2)
  await row.getByTestId(/apikey-revoke-/).click()
  await page.getByTestId('confirm-ok').click()
  await expect(row.getByText(/Revoked|Atšauktas|Widerrufen|Odwołany/)).toBeVisible()
})

test('webhooks: create (secret shown once) → toggle → delete (E06-4 UI)', async ({ page }) => {
  await page.goto('/login')
  await page.getByTestId('email-input').fill(E2E_EMAIL)
  await page.getByTestId('password-input').fill(E2E_PASSWORD)
  await page.getByTestId('login-submit').click()
  await page.waitForURL(/\/app\/?$/)

  await page.goto('/app/webhooks')
  // design round 2: the create form lives in a right Sheet behind "Add a webhook"
  await page.getByTestId('webhook-add-open').click()
  await expect(page.getByTestId('webhook-url')).toBeVisible()
  await page.getByTestId('webhook-url').fill('https://example.com/hook')
  // AdminCheckbox (round-2 control sweep): a button with role=checkbox + aria-checked
  await page.getByTestId('webhook-kind-panic').click()
  await expect(page.getByTestId('webhook-kind-panic')).toHaveAttribute('aria-checked', 'true')
  await page.getByTestId('webhook-create').click()

  // the signing secret is shown once (48 hex chars)
  const secret = page.getByTestId('webhook-secret')
  await expect(secret).toBeVisible()
  await expect(secret).toHaveText(/^[0-9a-f]{48}$/)
  await page.getByTestId('webhook-dismiss').click()

  const row = page.locator('li[data-testid^="webhook-"]').filter({ hasText: 'example.com/hook' })
  await expect(row).toBeVisible({ timeout: 15_000 })
  await row.getByRole('switch').click() // AdminSwitch: toggle enabled off (polls server state)
  await expect(row.getByRole('switch')).toHaveAttribute('aria-checked', 'false')
  // delete is gated by a danger ConfirmDialog (round 2)
  await row.getByTestId(/webhook-del-/).click()
  await page.getByTestId('confirm-ok').click()
  await expect(row).toHaveCount(0)
})

test('affiliates: a platform_admin invites a partner → appears pending → activate (item 5 / W9)', async ({ page }) => {
  await page.goto('/login')
  await page.getByTestId('email-input').fill(PLATFORM_EMAIL)
  await page.getByTestId('password-input').fill(PLATFORM_PASSWORD)
  await page.getByTestId('login-submit').click()
  await page.waitForURL('**/platform')

  // the OLD in-app URL now redirects into the console — asserting the landing here means a stale
  // bookmark or an old link keeps working rather than 404-ing after the pages moved
  await page.goto('/app/affiliates')
  await page.waitForURL('**/platform/partners')
  await page.getByTestId('affiliate-add-open').click()
  await expect(page.getByTestId('affiliate-name')).toBeVisible()
  const email = `partner-${Date.now()}@e2e.test`
  await page.getByTestId('affiliate-name').fill('E2E Partner')
  await page.getByTestId('affiliate-email').fill(email)
  await page.getByTestId('affiliate-create').click()

  // it lands in the list, pending, with an auto-generated code; activating flips the badge
  const row = page.locator('li[data-testid^="affiliate-"]').filter({ hasText: 'E2E Partner' })
  await expect(row).toBeVisible({ timeout: 15_000 })
  await expect(row.getByText(/Pending|Laukiama|Ausstehend|Oczekujący/)).toBeVisible()
  await row.getByTestId(/affiliate-activate-/).click()
  await expect(row.getByText(/Active|Aktyvus|Aktiv|Aktywny/)).toBeVisible({ timeout: 15_000 })
})

test('affiliates: a tenant admin cannot reach the affiliates panel (platform gate)', async ({ page }) => {
  await page.goto('/login')
  await page.getByTestId('email-input').fill(E2E_EMAIL)
  await page.getByTestId('password-input').fill(E2E_PASSWORD)
  await page.getByTestId('login-submit').click()
  await page.waitForURL(/\/app\/?$/)
  // nav link is platform-only; direct URL renders the in-page denied notice (server also 403s the API)
  await page.goto('/app/affiliates')
  await expect(page.getByTestId('affiliates-denied')).toBeVisible()
})

/** Shared login step for the coverage-gap tests below (mirrors the E2E flow above). */
async function login(page: import('@playwright/test').Page): Promise<void> {
  await page.goto('/login')
  await page.getByTestId('email-input').fill(E2E_EMAIL)
  await page.getByTestId('password-input').fill(E2E_PASSWORD)
  await page.getByTestId('login-submit').click()
  await page.waitForURL(/\/app\/?$/)
}

test('dashboard: stat cards, 7/30/90 range toggle, charts and lists render (PR #100)', async ({ page }) => {
  await login(page)
  await page.goto('/app/dashboard')
  // the four stat cards render from real seeded data (devices/positions/events/mileage)
  await expect(page.getByTestId('dash-devices')).toBeVisible()
  await expect(page.getByTestId('dash-online')).toBeVisible({ timeout: 15_000 })
  await expect(page.getByTestId('dash-today')).toBeVisible()
  await expect(page.getByTestId('dash-events')).toBeVisible()
  await expect(page.getByTestId('dash-critical')).toBeVisible()

  // the 7/30/90 d range toggle: 7 d is active by default; clicking 30 d moves the active state
  await expect(page.getByTestId('dash-range-7d')).toHaveAttribute('aria-pressed', 'true')
  await page.getByTestId('dash-range-30d').click()
  await expect(page.getByTestId('dash-range-30d')).toHaveAttribute('aria-pressed', 'true')
  await expect(page.getByTestId('dash-range-7d')).toHaveAttribute('aria-pressed', 'false')

  // fleet-activity area resolves to the chart or its explicit empty state (both have testids)
  await expect(page.getByTestId('dash-mileage-chart').or(page.getByTestId('dash-mileage-empty'))).toBeVisible({ timeout: 20_000 })
  // the donut + hourly widgets mount (headings are data-independent; the seeded stack fires no
  // rule events, so the charts themselves may show their "No data yet" state — the section
  // rendering is what regresses silently). The recent-events list always renders.
  await expect(page.getByRole('heading', { name: 'Events (7 d)' })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Activity by time of day' })).toBeVisible()
  await expect(page.getByTestId('dash-recent')).toBeVisible()
})

test('drivers: full CRUD — add sheet → row → edit → delete via ConfirmDialog', async ({ page }) => {
  await login(page)
  await page.goto('/app/drivers')

  // create through the right Sheet
  await page.getByTestId('driver-add-open').click()
  await page.getByTestId('driver-name').fill('E2E Driver Alpha')
  await page.getByTestId('driver-license').fill('LIC-ALPHA-1')
  const [createRes] = await Promise.all([
    page.waitForResponse((r) => r.url().includes('/v1/drivers') && r.request().method() === 'POST'),
    page.getByTestId('driver-save').click(),
  ])
  expect(createRes.status()).toBe(201) // tenant-wide single-account create must succeed
  const id = ((await createRes.json()) as { id: string }).id
  await expect(page.getByTestId(`driver-${id}`)).toBeVisible({ timeout: 15_000 })

  // edit via the per-row "..." menu → the header Sheet opens prefilled
  await page.getByTestId(`driver-menu-${id}`).click()
  await page.getByTestId(`driver-edit-${id}`).click()
  await page.getByTestId('driver-name').fill('E2E Driver Renamed')
  await page.getByTestId('driver-save').click()
  await expect(page.getByTestId(`driver-${id}`)).toContainText('E2E Driver Renamed', { timeout: 15_000 })

  // delete is gated by the danger ConfirmDialog
  await page.getByTestId(`driver-menu-${id}`).click()
  await page.getByTestId(`driver-delete-${id}`).click()
  await page.getByTestId('confirm-ok').click()
  await expect(page.getByTestId(`driver-${id}`)).toHaveCount(0, { timeout: 15_000 })
})

test('display prefs: changing speed→mph + time→12h flips a rendered value on another page (PR #101)', async ({ page }) => {
  await login(page)

  // prefs live on the Profile tab (default). Combobox: click the trigger, pick the option.
  await page.goto('/app/settings')
  await expect(page.getByTestId('settings-page')).toBeVisible()
  await page.getByTestId('pref-speed').click()
  await page.getByRole('option', { name: 'mph', exact: true }).click()
  await expect(page.getByTestId('pref-speed')).toHaveAttribute('data-value', 'mph')
  await page.getByTestId('pref-timeformat').click()
  await page.getByRole('option', { name: '12-hour (AM/PM)', exact: true }).click()
  await expect(page.getByTestId('pref-timeformat')).toHaveAttribute('data-value', '12h')

  // give BASE_IMEI fresh history so playback has a device with samples to render
  expect(
    await runToExit(
      TSX_BIN,
      ['tools/simulator/src/main.ts', '--scenario', 'liveDrive', '--count', '15', '--hz', '4', '--port', String(INGEST_PORT), '--imei', BASE_IMEI],
      {},
    ),
  ).toBe(0)

  // the prefs are device-local (localStorage) → they survive the full-page nav to playback,
  // where the overlay renders BOTH a speed (u.speed) and a time (dt) for the current sample
  await page.goto('/app/playback')
  await page.getByTestId('playback-device').click()
  await page.getByRole('option', { name: 'Good', exact: true }).click()
  await expect(page.getByTestId('speed-chart')).toBeVisible({ timeout: 20_000 })
  await page.getByTestId('playback-start').click()

  const overlay = page.getByTestId('playback-overlay')
  await expect(overlay).toBeVisible()
  await expect(overlay).toContainText('mph') // speed pref flowed through
  await expect(overlay).not.toContainText('km/h')
  // 12h time pref flowed through (uppercase AM/PM; no \b — the overlay flattens the time
  // right up against the '24 mph' speed, e.g. "10:38 PM24 mph")
  await expect(overlay).toContainText(/AM|PM/)
})

test('routing planner: page renders, parse errors surface, optimize degrades gracefully (no OSRM)', async ({ page }) => {
  await login(page)
  await page.goto('/app/routing')
  await expect(page.getByTestId('routing-stops-input')).toBeVisible()
  await expect(page.getByTestId('routing-optimize')).toBeVisible()

  // a malformed line surfaces the per-line parse error and keeps optimize disabled
  await page.getByTestId('routing-stops-input').fill('not-a-coordinate\n54.6872,25.2797')
  await expect(page.getByTestId('routing-parse-error')).toBeVisible()
  await expect(page.getByTestId('routing-optimize')).toBeDisabled()

  // valid stops enable optimize; CI has no OSRM, so accept EITHER a result table OR the
  // graceful "unavailable" error — never require a live route (per the coverage brief)
  await page.getByTestId('routing-stops-input').fill('54.6872,25.2797\n54.8985,23.9036')
  await expect(page.getByTestId('routing-optimize')).toBeEnabled()
  await page.getByTestId('routing-optimize').click()
  await expect(page.getByTestId('routing-result-table').or(page.getByTestId('routing-error'))).toBeVisible({ timeout: 20_000 })
})

/**
 * The vertex that CLOSES the ring must be findable among the others.
 *
 * A polygon finishes by clicking back on its first point, and every point was drawn identically —
 * on a shape with a dozen corners there was nothing to aim at (founder report, 2026-08-31).
 *
 * This also fills a documented gap: the round-trip test below notes that the draw path is
 * "covered only up to editor-mount". It is not flaky when every wait is a CONDITION rather than a
 * duration — no `waitForTimeout` here, deliberately.
 */
test('geofences: the vertex that closes the polygon is marked, and only that one', async ({ page }) => {
  await login(page)
  await page.goto('/app/geofences')
  const canvas = page.getByTestId('geofence-map')
  await expect(canvas).toBeVisible()

  // the draft layers are added on style.load — wait for the layer, not for a guess at how long
  const layerReady = () =>
    page.evaluate(() => {
      const el = document.querySelector('[data-testid="geofence-map"]') as
        | (HTMLDivElement & { __map?: { getLayer: (id: string) => unknown } })
        | null
      return el?.__map?.getLayer('gf-draft-pts') !== undefined
    })
  await expect.poll(layerReady, { timeout: 30_000 }).toBe(true)

  /** vertices currently in the draft source, deduped — querySourceFeatures repeats per TILE */
  const vertices = () =>
    page.evaluate(() => {
      const el = document.querySelector('[data-testid="geofence-map"]') as
        | (HTMLDivElement & { __map?: { querySourceFeatures: (s: string) => { geometry: { type: string; coordinates: number[] }; properties: Record<string, unknown> }[] } })
        | null
      const uniq = new Map<string, { anchor: boolean; armed: boolean }>()
      for (const f of el?.__map?.querySourceFeatures('gf-draft') ?? []) {
        if (f.geometry.type !== 'Point') continue
        uniq.set(JSON.stringify(f.geometry.coordinates), {
          anchor: f.properties['anchor'] === true,
          armed: f.properties['armed'] === true,
        })
      }
      return [...uniq.values()]
    })

  await page.getByTestId('gf-mode-polygon').click()
  const box = (await canvas.boundingBox())!
  const corners: [number, number][] = [
    [box.x + 220, box.y + 150],
    [box.x + 380, box.y + 160],
    [box.x + 400, box.y + 300],
    [box.x + 210, box.y + 290],
  ]
  for (const [i, [x, y]] of corners.entries()) {
    await page.mouse.click(x, y)
    await expect.poll(async () => (await vertices()).length, { timeout: 15_000 }).toBe(i + 1)
  }

  const v = await vertices()
  // exactly one anchor, and at four points the ring can be closed, so it is armed
  expect(v.filter((p) => p.anchor)).toHaveLength(1)
  expect(v.filter((p) => p.armed)).toHaveLength(1)
  expect(v.filter((p) => p.anchor)[0]!.armed).toBe(true)
  await page.screenshot({ path: 'test-results/gf-anchor.png' }) // PR visual artifact
})

test('geofences: create → list → delete+confirm round-trip', async ({ page }) => {
  await login(page)

  // The DRAWING half is covered by the anchor test above, which drives four real clicks on the
  // canvas — that turned out to be deterministic once every wait is a condition rather than a
  // duration (the older note here blamed headless swiftshader, and blamed terra-draw, which has
  // not been a dependency since ee8ff3c). What is still not covered end-to-end is finish→SAVE, so
  // this exercises create→list→delete via a deterministic API create (using the app's own bearer
  // token), then the UI list + the ConfirmDialog-gated delete.
  let bearer = ''
  page.on('request', (req) => {
    const a = req.headers()['authorization']
    if (a?.startsWith('Bearer ') === true) bearer = a
  })
  await page.goto('/app/geofences')
  await expect(page.getByTestId('geofence-map')).toBeVisible()
  await expect.poll(() => bearer).not.toBe('')

  const square = { type: 'Polygon', coordinates: [[[25.27, 54.68], [25.28, 54.68], [25.28, 54.69], [25.27, 54.69], [25.27, 54.68]]] }
  const created = await page.request.post('/v1/geofences', {
    headers: { authorization: bearer, 'content-type': 'application/json' },
    data: { name: 'E2E Zone', kind: 'polygon', color: '#4F46E5', accountId: null, geometry: square },
  })
  expect(created.ok()).toBe(true)
  const gfId = ((await created.json()) as { id: string }).id

  // reload → the list query picks it up → row renders
  await page.reload()
  await expect(page.getByTestId('gf-list')).toBeVisible({ timeout: 15_000 })
  await expect(page.getByTestId(`gf-${gfId}`)).toBeVisible()

  // delete via the row trash button → danger ConfirmDialog
  await page.getByTestId(`gf-del-${gfId}`).click()
  await page.getByTestId('confirm-ok').click()
  await expect(page.getByTestId(`gf-${gfId}`)).toHaveCount(0, { timeout: 15_000 })
})

test('notifications bell + command palette: open, mark-all, keyboard + search nav', async ({ page }) => {
  await login(page)

  // ── bell: opens a popover; mark-all clears any unread badge without crashing ──
  await page.getByTestId('bell').click()
  await expect(page.getByTestId('bell-popover')).toBeVisible()
  // the seeded stack fires no rule events, so an unread badge may or may not be present —
  // handle both deterministically (documented: unread>0 needs seeded events, absent here)
  const hadUnread = await page.getByTestId('bell-count').isVisible()
  await page.getByTestId('bell-mark-all').click()
  if (hadUnread) await expect(page.getByTestId('bell-count')).toHaveCount(0)
  await expect(page.getByTestId('bell-popover')).toBeVisible()
  await page.keyboard.press('Escape')

  // ── command palette: opens via ⌘/Ctrl-K, closes on Escape ──
  await page.keyboard.press('ControlOrMeta+KeyK')
  await expect(page.getByTestId('cmdk-palette')).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(page.getByTestId('cmdk-palette')).toHaveCount(0)

  // ── palette via the topbar search → type a page name → Enter navigates ──
  await page.getByTestId('topbar-search').click()
  await expect(page.getByTestId('cmdk-palette')).toBeVisible()
  await page.getByTestId('cmdk-input').fill('Reports')
  await page.keyboard.press('Enter')
  await page.waitForURL('**/app/reports')
})

test('PWA: manifest served and service worker registers on the built app', async ({ page }) => {
  // The manifest comes from the API now, branded by Host — a static file could never be, so
  // "Install app" offered a white-label tenant's user an app called Orbetra and put our icon on
  // their phone for as long as they kept the shortcut.
  //
  // The old path must no longer serve a MANIFEST. Asserting 404 would be wrong: the SPA's
  // catch-all answers any unknown path with index.html (200 text/html), here and behind Caddy
  // alike. What matters is that a browser still asking for the old URL cannot parse our name out
  // of it — so this asserts the CONTENT, which is the thing that leaked.
  const stale = await page.request.get('/manifest.webmanifest')
  expect(await stale.text()).not.toContain('Orbetra')
  const manifest = await page.request.get('/v1/public/manifest.webmanifest')
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

test('scrubbing the 24 h timeline draws the vehicle where it WAS (founder report 2026-08-19)', async ({ page }) => {
  /**
   * The defect: dragging the scrubber panned the map and drew nothing, because every marker on the
   * map is built from the LIVE frame — the operator was sent to an empty stretch of road.
   *
   * Asserted on RENDERED features through the `__map` handle, the same way the invalid-fix trail
   * test does, because that is the only place the map's own decision is reachable: it lives inside
   * a `useEffect` and this repo has no component-test harness.
   */
  await page.goto('/login')
  await page.getByTestId('email-input').fill(E2E_EMAIL)
  await page.getByTestId('password-input').fill(E2E_PASSWORD)
  await page.getByTestId('login-submit').click()
  await page.waitForURL(/\/app\/?$/)
  await expect(page.getByTestId('conn-badge')).toHaveText(/Live/i, { timeout: 15_000 })

  /**
   * Give the device a PAST: bufferedFlood replays stored records spanning the last two hours with
   * their original timestamps (§3.6), which is exactly the history a scrubber needs.
   *
   * Selected by NAME, not by the `device-row-<id>` testid, and this is the subtle part: the map's
   * row id is the deviceId the WS stream carries, and the CSV-import test earlier in this file
   * creates a real registry device for BASE_IMEI — which re-points `registry:imei` at the new
   * database id. So this IMEI has TWO rows in the store by now: a stale one keyed by the seeded
   * numeric IMEI, from the drives before the import, and the live one keyed by the database id.
   * Clicking the stale one asks the history endpoint for a device that does not exist (404), which
   * is exactly how this test failed first: the scrubber stayed disabled, correctly, for a device
   * whose history we genuinely cannot fetch.
   */
  expect(
    await runToExit(
      TSX_BIN,
      ['tools/simulator/src/main.ts', '--scenario', 'bufferedFlood', '--port', String(INGEST_PORT), '--imei', BASE_IMEI],
      {},
    ),
  ).toBe(0)

  const row = page.locator('[data-testid^="device-row-"]').filter({ hasText: 'Good' }).first()
  await row.click({ timeout: 30_000 })

  // the scrubber enables itself once the track lands and holds something placeable
  const scrub = page.getByTestId('timeline-scrub')
  await expect(scrub).toBeEnabled({ timeout: 30_000 })

  const ghostCount = () =>
    page.evaluate(() => {
      const el = document.querySelector('[data-testid="live-map"]') as
        | (HTMLDivElement & { __map?: { queryRenderedFeatures: (o: { layers: string[] }) => unknown[] } })
        | null
      return el?.__map?.queryRenderedFeatures({ layers: ['scrub-halo'] }).length ?? 0
    })

  // live: no ghost, because there is no past moment selected
  expect(await ghostCount()).toBe(0)

  /**
   * 60 minutes back — inside the flood, so a real record answers for that moment.
   *
   * Read off the axis instead of computing it: the range counts UP toward now, and its unit and
   * span are both the timeline's to decide — it moved from minutes-of-24-h to SECONDS, and the span
   * itself is now zoomable (1/3/6/12/24 h). A literal here silently became "23.6 hours back", which
   * is outside the two hours bufferedFlood replays, so the ghost was correctly absent and the test
   * blamed the map for it.
   */
  const axisMax = Number(await scrub.getAttribute('max'))
  expect(axisMax).toBeGreaterThanOrEqual(3600) // a span shorter than the jump would make this vacuous
  await scrub.fill(String(axisMax - 3600))
  await expect.poll(ghostCount, { timeout: 15_000 }).toBeGreaterThan(0)

  await page.screenshot({ path: 'test-results/scrub-ghost.png' }) // PR visual artifact

  // …and back to live removes it: the ghost is a claim about a moment, not a second vehicle
  await page.getByTestId('timeline-quick-0').click()
  await expect.poll(ghostCount, { timeout: 15_000 }).toBe(0)
})
