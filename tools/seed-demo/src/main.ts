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

const ACTOR = { userId: '00000000-0000-0000-0000-00000000d000' } // audit rows attribute to a fixed seed actor

interface SeedResult {
  tenantId: string
  accounts: string[]
  devices: { created: number; existing: number; imeiConflicts: number }
  drives: { total: number; acked: number; rejected: number }
  password: string
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
    const profile = (await db.profiles.list()).find((p) => p.key === 'fmb1xx')
    if (profile === undefined) throw new Error('fmb1xx profile missing after seed')
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
        await activateDevice(redis, { id: dev.id, imei: spec.imei, tenantId: tenant.id, accountId, config: { presenceRules: profile.presenceRules ?? {}, odometerSource: 'auto' } })
        created++
      } catch (err) {
        if (err instanceof DuplicateImeiError) {
          // the IMEI exists in ANOTHER tenant (getByImei is scoped) — e.g. a quarantine
          // claim took it. Skip with an actionable note; the run stays resumable.
          imeiConflicts++
          log(`  SKIP ${spec.imei}: already registered in another tenant (clean it up or change DEMO_BASE_IMEI)`)
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
        geometry: { type: 'Polygon', coordinates: [[[25.26, 54.67], [25.30, 54.67], [25.30, 54.70], [25.26, 54.70], [25.26, 54.67]]] },
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
        line: { type: 'LineString', coordinates: [[25.28, 54.69], [24.6, 54.95], [23.9, 54.9]] },
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

    log(`demo tenant ready: ${TENANT_NAME} (${tenant.id})`)
    log(`  accounts: ${ACCOUNT_NAMES.join(', ')}`)
    log(`  devices: ${created} created, ${existing} already existed${imeiConflicts > 0 ? `, ${imeiConflicts} imei conflicts SKIPPED` : ''}`)
    log(sendHistory
      ? `  history: ${drives.length} drives sent, ${acked} records acked${rejected > 0 ? `, ${rejected} REJECTED (is ingest running with this Redis?)` : ''}`
      : `  history: skipped (devices already existed; pass --with-history to re-drive)`)
    log(`  login: demo-admin@orbetra.test / demo-manager@… / demo-viewer@…  password: ${password}`)
    log(`  NOTE: positions/trips appear once the worker drains the stream (seconds).`)
    return { tenantId: tenant.id, accounts: accountIds, devices: { created, existing, imeiConflicts }, drives: { total: sendHistory ? drives.length : 0, acked, rejected }, password }
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
