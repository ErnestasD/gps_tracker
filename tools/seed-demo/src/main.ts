import { randomBytes } from 'node:crypto'
import { realpathSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { Redis } from 'ioredis'

import { activateDevice, hashPassword, syncDriverIbutton, syncGeofence, syncRule } from '@orbetra/api'
import { createDb, DuplicateImeiError, type Db, type Scope } from '@orbetra/db'
import { fuelTheft, invalidFix, liveDrive, panic, runScenario, type Scenario } from '@orbetra/simulator'
import { seedProfiles } from '../../../packages/db/seed/profiles.js'
import { DEMO_DRIVERS, planDemoFleet, type DemoDrive } from './plan.js'

/**
 * tools/seed-demo (E08-5, W8 S4): provision a complete, realistic demo tenant for sales
 * calls against a RUNNING stack. Provisioning goes through the SAME layers production
 * uses — @orbetra/db scoped repos + the api's activateDevice/syncRule/syncGeofence
 * registry syncs (the worker reads rules/geofences from Redis, so DB rows alone would
 * demo NOTHING — review HIGH-1) — and history is driven through the REAL pipeline
 * (simulator → ingest TCP → worker). Every drive ends with an ignition-off park tail so
 * the trip engine actually CLOSES trips (review HIGH-2).
 *
 * Idempotent for rows (lookup-or-create by imei/name/email; demo users' password is
 * re-stamped so the printed password always works). History is sent only when devices
 * were newly created (or --with-history) — re-runs don't pile up duplicate trails.
 *
 * Requires: DATABASE_URL; optional REDIS_URL, INGEST_HOST/INGEST_PORT (default
 * 127.0.0.1:5027), DEMO_PASSWORD (default: random, PRINTED). Run the full local stack
 * first (`make up` + ingest + worker + api) or point the env at staging with
 * SEED_DEMO_ALLOW=1 (any non-loopback target requires the explicit opt-in).
 */
const TENANT_NAME = 'Demo Logistics'
const ACCOUNT_NAMES = ['Vilnius Fleet', 'Kaunas Fleet'] as const
const SCENARIOS: Record<DemoDrive['scenario'], Scenario> = { liveDrive, panic, invalidFix, fuelTheft }

// A SECOND demo tenant on a Direct (Track-A) plan (WP5) so staging can demo BOTH sides of the plan
// axis: the primary 'Demo Logistics' tenant keeps the DB-default tsp_grow (full white-label + API +
// webhooks + sub-accounts, uncapped); this one is direct_10 — single account, NO white-label / API /
// webhooks, capped at 10 devices. Seeding 4 devices leaves room to demo the cap by adding 7 more.
const DIRECT_TENANT_NAME = 'Demo Direct Fleet'
const DIRECT_ACCOUNT_NAME = 'Direct Fleet'
const DIRECT_ADMIN_EMAIL = 'demo-direct-admin@orbetra.test'
const DIRECT_BASE_IMEI = 867000120000040n // distinct block from the 12 tsp_grow demo devices (…010–…021)
const DIRECT_DEVICE_COUNT = 4

const ACTOR = { userId: '00000000-0000-0000-0000-00000000d000' } // audit rows attribute to a fixed seed actor

interface SeedResult {
  tenantId: string
  accounts: string[]
  devices: { created: number; existing: number; imeiConflicts: number }
  drives: { total: number; acked: number; rejected: number }
  password: string
  /** the second (Direct-plan) demo tenant — WP5. */
  direct: { tenantId: string; devices: { created: number; existing: number } }
}

/**
 * Seed the SECOND demo tenant on a Direct (Track-A) plan (WP5) — direct_10: a single account, the
 * feature-gated surfaces (white-label / API / webhooks / sub-accounts) all 403, and a 10-device cap.
 * Provisioned through the SAME scoped repos + activateDevice sync as the primary demo. Idempotent:
 * tenant/account/user looked up by name/email (the admin's password re-stamped so the printed one
 * always works), devices by imei. No pipeline history — a few live devices are enough to show the
 * Direct experience (and leave headroom under the cap).
 */
async function seedDirectDemo(
  db: Db,
  redis: Redis,
  profile: { id: string; presenceRules: unknown; avlTable: string },
  passwordHash: string,
  log: (line: string) => void,
): Promise<SeedResult['direct']> {
  const tenant =
    (await db.tenants.list()).find((t) => t.name === DIRECT_TENANT_NAME) ??
    (await db.tenants.create(ACTOR, { name: DIRECT_TENANT_NAME, plan: 'direct_10', branding: { productName: DIRECT_TENANT_NAME } }))
  const scope: Scope = { tenantId: tenant.id }
  const accountId =
    (await db.accounts.list(scope)).find((a) => a.name === DIRECT_ACCOUNT_NAME)?.id ??
    (await db.accounts.create(scope, ACTOR, { name: DIRECT_ACCOUNT_NAME, timezone: 'Europe/Vilnius' })).id

  // its own admin — Direct plans still administer via the tsp_admin role (roles are ORTHOGONAL to
  // plans); the plan, not the role, is what gates the TSP-only features.
  const existingAdmin = (await db.users.list(scope)).find((u) => u.email === DIRECT_ADMIN_EMAIL)
  if (existingAdmin === undefined) await db.users.create(scope, ACTOR, { email: DIRECT_ADMIN_EMAIL, role: 'tsp_admin', accountId: null, passwordHash })
  else await db.users.update(scope, ACTOR, existingAdmin.id, { passwordHash })

  let created = 0
  let existing = 0
  for (let i = 0; i < DIRECT_DEVICE_COUNT; i++) {
    const imei = (DIRECT_BASE_IMEI + BigInt(i)).toString()
    if ((await db.devices.getByImei(scope, imei)) !== null) {
      existing++
      continue
    }
    try {
      const dev = await db.devices.create(scope, ACTOR, { accountId, profileId: profile.id, imei, name: `Direct Van ${String(i + 1).padStart(2, '0')}`, plate: `DIR ${100 + i}` })
      await activateDevice(redis, { id: dev.id, imei, tenantId: tenant.id, accountId, config: { presenceRules: profile.presenceRules ?? {}, odometerSource: 'auto', avlTable: profile.avlTable } })
      created++
    } catch (err) {
      if (err instanceof DuplicateImeiError) {
        log(`  SKIP ${imei}: already claimed (active here, or held by another tenant)`)
      } else throw err
    }
  }
  log(`direct demo tenant ready: ${DIRECT_TENANT_NAME} (${tenant.id}) — plan direct_10`)
  log(`  account: ${DIRECT_ACCOUNT_NAME}; devices: ${created} created, ${existing} already existed (cap 10)`)
  log(`  login: ${DIRECT_ADMIN_EMAIL}  (same password as above)`)
  return { tenantId: tenant.id, devices: { created, existing } }
}

export async function seedDemo(opts: {
  databaseUrl: string
  redisUrl: string
  ingestHost: string
  ingestPort: number
  password?: string
  nowMs?: number
  withHistory?: boolean
  log?: (line: string) => void
}): Promise<SeedResult> {
  const log = opts.log ?? console.log
  const password = opts.password ?? `demo-${randomBytes(9).toString('base64url')}`
  const nowMs = opts.nowMs ?? Date.now()
  const db: Db = createDb(opts.databaseUrl)
  const redis = new Redis(opts.redisUrl, { maxRetriesPerRequest: null })

  try {
    // tenant + accounts (lookup-or-create by name — idempotent re-runs)
    const tenant =
      (await db.tenants.list()).find((t) => t.name === TENANT_NAME) ??
      (await db.tenants.create(ACTOR, { name: TENANT_NAME, branding: { productName: 'Demo Logistics', primary: '#0e7490', accent: '#0e7490' } }))
    const scope: Scope = { tenantId: tenant.id }
    const accountIds: string[] = []
    for (const name of ACCOUNT_NAMES) {
      const existing = (await db.accounts.list(scope)).find((a) => a.name === name)
      accountIds.push(existing?.id ?? (await db.accounts.create(scope, ACTOR, { name, timezone: 'Europe/Vilnius' })).id)
    }

    // users — the printed password must ALWAYS work, so existing demo users get their
    // hash re-stamped on re-runs (review MED-2)
    const passwordHash = await hashPassword(password)
    const wanted: { email: string; role: 'tsp_admin' | 'account_manager' | 'viewer'; accountId: string | null }[] = [
      { email: 'demo-admin@orbetra.test', role: 'tsp_admin', accountId: null },
      { email: 'demo-manager@orbetra.test', role: 'account_manager', accountId: accountIds[0]! },
      { email: 'demo-viewer@orbetra.test', role: 'viewer', accountId: accountIds[0]! },
    ]
    const users = await db.users.list(scope)
    for (const u of wanted) {
      const existing = users.find((x) => x.email === u.email)
      if (existing === undefined) await db.users.create(scope, ACTOR, { ...u, passwordHash })
      else await db.users.update(scope, ACTOR, existing.id, { passwordHash })
    }

    // device profiles + fleet
    await seedProfiles(opts.databaseUrl)
    // `fmb120`, the model, not `fmb1xx`, the retired family row. Profiles became per-MODEL, and the
    // four family rows are now legacy — kept because live devices reference them, hidden from
    // `list()`, which is the picker's list. The demo fleet should look like a fleet an operator
    // would actually create.
    const profile = (await db.profiles.list()).find((p) => p.key === 'fmb120')
    if (profile === undefined) throw new Error('fmb120 profile missing after seed — run the profile seed first')
    const { devices, drives } = planDemoFleet(nowMs)
    let created = 0
    let existing = 0
    let imeiConflicts = 0
    for (const spec of devices) {
      const accountId = accountIds[spec.account]!
      const found = await db.devices.getByImei(scope, spec.imei)
      if (found !== null) {
        existing++
        continue
      }
      try {
        const dev = await db.devices.create(scope, ACTOR, { accountId, profileId: profile.id, imei: spec.imei, name: spec.name, plate: spec.plate })
        // same config shape the CRUD path syncs (profile presence rules, not hardcoded)
        await activateDevice(redis, { id: dev.id, imei: spec.imei, tenantId: tenant.id, accountId, config: { presenceRules: profile.presenceRules ?? {}, odometerSource: 'auto', avlTable: profile.avlTable } })
        created++
      } catch (err) {
        if (err instanceof DuplicateImeiError) {
          // the IMEI exists in ANOTHER tenant (getByImei is scoped) — e.g. a quarantine
          // claim took it. Skip with an actionable note; the run stays resumable.
          imeiConflicts++
          log(`  SKIP ${spec.imei}: already claimed (active here, or held by another tenant) (clean it up or change DEMO_BASE_IMEI)`)
        } else throw err
      }
    }

    // geofence + rules — DB rows AND the worker's Redis caches (the engines read Redis
    // only; without syncRule/syncGeofence the demo events would never fire)
    const fences = await db.geofences.list(scope)
    let fence = fences.find((f) => f.name === 'Vilnius Depot')
    if (fence === undefined) {
      fence = await db.geofences.create(scope, ACTOR, {
        name: 'Vilnius Depot',
        kind: 'polygon',
        accountId: accountIds[0]!,
        // Kirtimai industrial zone (south Vilnius, dry land) — the old square sat over the
        // Neris and half of Old Town, which read as fake on every screenshot. The city loop
        // route passes through here, so enter/exit events still fire every lap.
        geometry: { type: 'Polygon', coordinates: [[[25.2975, 54.6312], [25.3185, 54.6295], [25.322, 54.6382], [25.308, 54.6428], [25.296, 54.639], [25.2975, 54.6312]]] },
      })
    }
    await syncGeofence(redis, fence)
    // corridor geofence (V2): a buffered route line — "left the corridor" = a geofence rule on 'exit'
    const corridor =
      fences.find((f) => f.name === 'Vilnius–Kaunas corridor') ??
      (await db.geofences.create(scope, ACTOR, {
        name: 'Vilnius–Kaunas corridor',
        kind: 'corridor',
        accountId: accountIds[0]!,
        // The A1 motorway centre-line (OSRM driving route over OSM Lithuania, downsampled to
        // 60 pts) — the old 3-point line cut cross-country north of the highway, which looked
        // obviously fake buffered on the geofences map.
        line: { type: 'LineString', coordinates: [[25.2598, 54.7029], [25.263, 54.7018], [25.2624, 54.6987], [25.2536, 54.6995], [25.242, 54.6993], [25.2341, 54.7005], [25.222, 54.6997], [25.2125, 54.6998], [25.2074, 54.7009], [25.2078, 54.6998], [25.1953, 54.6847], [25.1956, 54.6769], [25.1931, 54.6717], [25.1785, 54.6694], [25.1719, 54.6639], [25.1601, 54.6592], [25.1508, 54.6566], [25.1432, 54.6577], [25.1094, 54.6686], [25.0868, 54.6753], [25.0714, 54.6785], [25.0538, 54.6857], [25.0431, 54.6903], [25.0267, 54.694], [24.9981, 54.7072], [24.9777, 54.7156], [24.9549, 54.7334], [24.939, 54.7453], [24.9288, 54.7491], [24.909, 54.7537], [24.8834, 54.7565], [24.8705, 54.7584], [24.8505, 54.7653], [24.8326, 54.769], [24.8062, 54.7757], [24.7919, 54.7788], [24.7172, 54.7872], [24.6576, 54.791], [24.581, 54.7958], [24.5463, 54.7979], [24.5025, 54.8035], [24.4568, 54.8113], [24.3966, 54.8265], [24.3343, 54.8442], [24.2761, 54.8591], [24.2333, 54.8717], [24.1867, 54.8847], [24.1444, 54.8977], [24.1123, 54.9086], [24.0821, 54.9211], [24.0686, 54.9261], [24.0464, 54.9277], [24.0048, 54.9305], [23.9813, 54.9334], [23.981, 54.9345], [23.9842, 54.9342], [23.9756, 54.9298], [23.97, 54.9273], [23.9654, 54.9281], [23.9596, 54.9281]] },
        bufferM: 500,
      }))
    await syncGeofence(redis, corridor)

    const rules = await db.rules.list(scope)
    // overspeed limit 60: demo drives cruise 30–70 km/h, so the rule VISIBLY fires. fuel_theft (V2)
    // fires on device 7's parked fuel drop. The corridor-exit rule makes the corridor a real alert.
    const wantedRules: { name: string; kind: 'overspeed' | 'panic' | 'fuel_theft' | 'geofence'; config: Record<string, unknown> }[] = [
      { name: 'Demo overspeed 60', kind: 'overspeed', config: { speedKmh: 60 } },
      { name: 'Demo panic', kind: 'panic', config: {} },
      { name: 'Demo fuel theft', kind: 'fuel_theft', config: { dropPct: 15 } },
      { name: 'Demo corridor exit', kind: 'geofence', config: { geofenceId: corridor.id, on: 'exit' } },
    ]
    for (const w of wantedRules) {
      const rule = rules.find((r) => r.name === w.name) ?? (await db.rules.create(scope, ACTOR, { accountId: accountIds[0]!, kind: w.kind, name: w.name, config: w.config }))
      // sync the DB ROW (exactly like crud.ts) — a hand-built object would overwrite UI
      // edits (enabled/limits) in Redis while the DB kept them (review MED)
      await syncRule(redis, rule)
    }

    // drivers (V2 iButton) — DB rows AND the driver:ibutton Redis map the worker resolves AVL 78
    // against; without the sync a tap would never auto-assign a trip.
    const existingDrivers = await db.drivers.list(scope)
    for (const dr of DEMO_DRIVERS) {
      const accountId = accountIds[dr.account]!
      const found = existingDrivers.find((x) => x.name === dr.name)
      const row = found ?? (await db.drivers.create(scope, ACTOR, { accountId, name: dr.name, ibutton: dr.ibutton, licenseNo: dr.licenseNo }))
      await syncDriverIbutton(redis, tenant.id, accountId, row.id, dr.ibutton, found?.ibutton ?? null)
    }

    // one maintenance reminder + one scheduled report so those panels aren't empty on a demo. The
    // reminder must sit on a device IN account 0 (its accountId is stored verbatim), so pick one.
    const acc0Device = (await db.devices.list(scope)).find((d) => d.accountId === accountIds[0])
    if (acc0Device !== undefined) {
      const maint = await db.maintenance.list(scope, acc0Device.id)
      if (!maint.some((m) => m.title === 'Oil change')) {
        await db.maintenance.create(scope, ACTOR, { accountId: acc0Device.accountId, deviceId: acc0Device.id, title: 'Oil change', intervalKm: 15_000, lastServiceOdoKm: 8_000 })
      }
    }
    const schedules = await db.scheduledReports.list(scope)
    if (!schedules.some((s) => s.reportType === 'trips')) {
      await db.scheduledReports.create(scope, ACTOR, { accountId: accountIds[0]!, reportType: 'trips', cadence: 'daily', hourUtc: 6, recipients: ['demo-admin@orbetra.test'], timezone: 'Europe/Vilnius' })
    }

    // history through the REAL pipeline: simulator → ingest TCP (worker persists async).
    // Only when devices are fresh (or forced) — re-runs must not pile duplicate trails
    // shifted by wall-clock (positions ON CONFLICT can't dedupe different timestamps).
    let acked = 0
    let rejected = 0
    const sendHistory = created > 0 || opts.withHistory === true
    if (sendHistory) {
      for (const drive of drives) {
        const res = await runScenario(SCENARIOS[drive.scenario], {
          imei: drive.imei,
          seed: drive.seed,
          count: drive.count,
          startMs: drive.startMs,
          startDistanceM: drive.startDistanceM,
          ...(drive.routeName !== undefined ? { routeName: drive.routeName } : {}),
          parkTailS: 240, // ignition-off tail > parkedIgnitionOffS(180) → the trip CLOSES
          hz: 0, // as fast as the socket allows — record timestamps carry the history spacing
          host: opts.ingestHost,
          port: opts.ingestPort,
          ...(drive.ibutton !== undefined ? { ibutton: drive.ibutton } : {}),
          ...(drive.can === true ? { can: true } : {}),
        })
        acked += res.ackedRecords
        if (res.rejectedByImei) rejected++
      }
    }

    // second demo tenant on a Direct plan (WP5) — so staging can demo the plan-gated experience too
    const direct = await seedDirectDemo(db, redis, profile, passwordHash, log)

    log(`demo tenant ready: ${TENANT_NAME} (${tenant.id})`)
    log(`  accounts: ${ACCOUNT_NAMES.join(', ')}`)
    log(`  devices: ${created} created, ${existing} already existed${imeiConflicts > 0 ? `, ${imeiConflicts} imei conflicts SKIPPED` : ''}`)
    log(sendHistory
      ? `  history: ${drives.length} drives sent, ${acked} records acked${rejected > 0 ? `, ${rejected} REJECTED (is ingest running with this Redis?)` : ''}`
      : `  history: skipped (devices already existed; pass --with-history to re-drive)`)
    log(`  login: demo-admin@orbetra.test / demo-manager@… / demo-viewer@…  password: ${password}`)
    log(`  NOTE: positions/trips appear once the worker drains the stream (seconds).`)
    return { tenantId: tenant.id, accounts: accountIds, devices: { created, existing, imeiConflicts }, drives: { total: sendHistory ? drives.length : 0, acked, rejected }, password, direct }
  } finally {
    await redis.quit()
    await db.$disconnect()
  }
}

const isLoopback = (host: string): boolean => host === '127.0.0.1' || host === 'localhost' || host === '::1'

async function main(): Promise<void> {
  const databaseUrl = process.env['DATABASE_URL'] ?? ''
  if (databaseUrl === '') {
    console.error('DATABASE_URL is required')
    process.exit(2)
  }
  const ingestHost = process.env['INGEST_HOST'] ?? '127.0.0.1'
  const ingestPort = Number(process.env['INGEST_PORT'] ?? 5027)
  if (!Number.isInteger(ingestPort) || ingestPort < 1 || ingestPort > 65535) {
    console.error(`INGEST_PORT must be a port number, got '${process.env['INGEST_PORT']}'`)
    process.exit(2)
  }
  // demo data does not belong anywhere near production. POSITIVE opt-in for any
  // non-loopback target (an unset NODE_ENV on a prod box must not slip through) plus
  // the NODE_ENV belt.
  const hostOf = (url: string): string => {
    try {
      return new URL(url).hostname
    } catch {
      return '' // malformed → treated as remote → refuses (safe default)
    }
  }
  const redisUrl = process.env['REDIS_URL'] ?? 'redis://127.0.0.1:6379'
  const remoteTarget = !isLoopback(ingestHost) || !isLoopback(hostOf(databaseUrl)) || !isLoopback(hostOf(redisUrl))
  const allowed = process.env['SEED_DEMO_ALLOW'] === '1' || process.argv.includes('--yes')
  if (remoteTarget && !allowed) {
    console.error(`refusing to seed demo data against a non-loopback target (db=${hostOf(databaseUrl)}, redis=${hostOf(redisUrl)}, ingest=${ingestHost}); set SEED_DEMO_ALLOW=1 or pass --yes`)
    process.exit(2)
  }
  if (process.env['NODE_ENV'] === 'production' && !process.argv.includes('--force')) {
    console.error('refusing to seed demo data with NODE_ENV=production (pass --force to override)')
    process.exit(2)
  }
  await seedDemo({
    databaseUrl,
    redisUrl,
    ingestHost,
    ingestPort,
    withHistory: process.argv.includes('--with-history'),
    ...(process.env['DEMO_PASSWORD'] !== undefined ? { password: process.env['DEMO_PASSWORD'] } : {}),
  })
}

// entrypoint guard by realpath (basename endsWith was flagged fragile in a prior review)
const isEntrypoint = (() => {
  try {
    return process.argv[1] !== undefined && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url))
  } catch {
    return false
  }
})()
if (isEntrypoint) {
  main().catch((err: unknown) => {
    console.error(err)
    process.exit(1)
  })
}
