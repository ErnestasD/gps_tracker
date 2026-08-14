import { randomBytes } from 'node:crypto'
import { realpathSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { Redis } from 'ioredis'

import { activateDevice, hashPassword, syncGeofence, syncRule } from '@orbetra/api'
import { createDb, DuplicateImeiError, type Db, type Scope } from '@orbetra/db'
import { seedProfiles } from '../../../packages/db/seed/profiles.js'
import { PARTNERS, PLATFORM_TENANT, SEED_ACTOR, SEED_PASSWORD_DEFAULT, SUPER_ADMIN_EMAIL, TENANTS, type TenantSpec } from './scenarios.js'

/**
 * tools/seed-demo — the SCENARIO seed (as opposed to `main.ts`, the single sales-demo tenant).
 *
 * Provisions the whole plan matrix at once: every Direct tier, every TSP tier with its own branding
 * and custom domain, three partners with real referrals behind them, and one platform admin. Written
 * for a founder who wants to log in AS each kind of customer and see the product differ.
 *
 * Everything goes through the same scoped repositories production uses (CLAUDE.md rule 2) and the
 * same `activateDevice` registry sync the CRUD path performs — a device row without its Redis entry
 * is invisible to ingest, so seeding the DB alone would produce a fleet that can never report.
 *
 * Idempotent by lookup-or-create on name/email/imei, and passwords are re-stamped every run so the
 * printed password is always the working one.
 */
export interface ScenarioSeedResult {
  password: string
  partners: { name: string; email: string; code: string }[]
  tenants: { name: string; plan: string; track: string; devices: number; users: string[]; domain?: string; partner: string | null }[]
  superAdmin: string
  totals: { tenants: number; users: number; devices: number; imeiConflicts: number }
}

export async function seedScenarios(opts: {
  databaseUrl: string
  redisUrl: string
  password?: string
  log?: (line: string) => void
}): Promise<ScenarioSeedResult> {
  const log = opts.log ?? console.log
  const password = opts.password ?? SEED_PASSWORD_DEFAULT
  const db: Db = createDb(opts.databaseUrl)
  const redis = new Redis(opts.redisUrl, { maxRetriesPerRequest: null })

  try {
    // Device profiles are global reference data, not tenant data — a wiped database has none, and
    // every device create needs a profileId, so this must run first rather than be assumed.
    await seedProfiles(opts.databaseUrl)
    const profile = (await db.profiles.list()).find((p) => p.key === 'fmb120')
    if (profile === undefined) throw new Error('fmb120 profile missing after seedProfiles')

    // ONE hash for every account. Argon2 is deliberately expensive; hashing it ~30 times would add
    // minutes to the run for no benefit, since the password is identical by design.
    const passwordHash = await hashPassword(password)

    // ── partners first: a tenant's referral attribution is set AT CREATE and cannot be added later
    const existingAffiliates = await db.affiliates.list()
    const affiliateIds = new Map<string, string>()
    for (const p of PARTNERS) {
      const found = existingAffiliates.find((a) => a.email === p.email)
      const row =
        found ??
        (await db.affiliates.create(SEED_ACTOR, {
          name: p.name,
          email: p.email,
          code: p.code,
          commissionPct: p.commissionPct,
          commissionMonths: p.commissionMonths,
        }))
      // `pending` is the create default — a pending partner's code does not resolve, so an
      // unapproved partner would silently attribute nothing and the referral columns would be empty
      // for reasons that look like a bug.
      await db.affiliates.update(SEED_ACTOR, row.id, { status: 'active', locale: p.locale })
      await db.affiliates.setPassword(row.id, passwordHash)
      affiliateIds.set(p.key, row.id)
      log(`partner: ${p.name} (${p.code}) — ${p.commissionPct}% for ${p.commissionMonths} months`)
    }

    const out: ScenarioSeedResult['tenants'] = []
    let totalUsers = 0
    let totalDevices = 0
    let imeiConflicts = 0

    for (const spec of TENANTS) {
      const { tenantId, users, devices, conflicts } = await seedTenant(db, redis, spec, profile, passwordHash, affiliateIds, log)
      totalUsers += users
      totalDevices += devices
      imeiConflicts += conflicts
      out.push({
        name: spec.name,
        plan: spec.plan,
        track: spec.track,
        devices,
        users: spec.users.map((u) => u.email),
        ...(spec.domain !== undefined ? { domain: spec.domain } : {}),
        partner: spec.referredBy,
      })
      log(`tenant: ${spec.name} [${spec.plan}] ${tenantId} — ${devices} devices, ${users} users`)
    }

    // ── the platform admin, last: it belongs to no customer
    const platformTenant =
      (await db.tenants.list()).find((t) => t.name === PLATFORM_TENANT.name) ??
      (await db.tenants.create(SEED_ACTOR, { name: PLATFORM_TENANT.name, plan: PLATFORM_TENANT.plan, branding: { productName: 'Orbetra' } }))
    const platformScope: Scope = { tenantId: platformTenant.id }
    const platformAccountId =
      (await db.accounts.list(platformScope)).find((a) => a.name === PLATFORM_TENANT.account)?.id ??
      (await db.accounts.create(platformScope, SEED_ACTOR, { name: PLATFORM_TENANT.account, timezone: 'Europe/Vilnius' })).id
    const existingSuper = (await db.users.list(platformScope)).find((u) => u.email === SUPER_ADMIN_EMAIL)
    if (existingSuper === undefined) {
      await db.users.create(platformScope, SEED_ACTOR, { email: SUPER_ADMIN_EMAIL, role: 'platform_admin', accountId: null, passwordHash, locale: 'lt' })
    } else {
      await db.users.update(platformScope, SEED_ACTOR, existingSuper.id, { passwordHash, role: 'platform_admin' })
    }
    totalUsers++
    void platformAccountId
    log(`platform admin: ${SUPER_ADMIN_EMAIL} in tenant ${PLATFORM_TENANT.name} (${platformTenant.id})`)

    return {
      password,
      partners: PARTNERS.map((p) => ({ name: p.name, email: p.email, code: p.code })),
      tenants: out,
      superAdmin: SUPER_ADMIN_EMAIL,
      totals: { tenants: TENANTS.length + 1, users: totalUsers, devices: totalDevices, imeiConflicts },
    }
  } finally {
    await redis.quit()
    await db.$disconnect()
  }
}

async function seedTenant(
  db: Db,
  redis: Redis,
  spec: TenantSpec,
  profile: { id: string; presenceRules: unknown; avlTable: string },
  passwordHash: string,
  affiliateIds: Map<string, string>,
  log: (line: string) => void,
): Promise<{ tenantId: string; users: number; devices: number; conflicts: number }> {
  const referredByAffiliateId = spec.referredBy !== null ? (affiliateIds.get(spec.referredBy) ?? null) : null
  const tenant =
    (await db.tenants.list()).find((t) => t.name === spec.name) ??
    (await db.tenants.create(SEED_ACTOR, {
      name: spec.name,
      plan: spec.plan,
      branding: spec.branding ?? { productName: spec.name },
      referredByAffiliateId,
    }))
  const scope: Scope = { tenantId: tenant.id }

  const existingAccounts = await db.accounts.list(scope)
  const accountIds: string[] = []
  for (const a of spec.accounts) {
    const found = existingAccounts.find((x) => x.name === a.name)
    accountIds.push(found?.id ?? (await db.accounts.create(scope, SEED_ACTOR, { name: a.name, timezone: a.timezone })).id)
  }

  const existingUsers = await db.users.list(scope)
  for (const u of spec.users) {
    const accountId = u.account === null ? null : (accountIds[u.account] ?? null)
    const found = existingUsers.find((x) => x.email === u.email)
    if (found === undefined) {
      await db.users.create(scope, SEED_ACTOR, { email: u.email, role: u.role, accountId, passwordHash, ...(u.locale !== undefined ? { locale: u.locale } : {}) })
    } else {
      await db.users.update(scope, SEED_ACTOR, found.id, { passwordHash, role: u.role, accountId })
    }
  }

  // white-label domain, seeded VERIFIED: the point is to show the finished state of the setup
  // screens. It cannot resolve (`.test`), which is correct — a seed must not claim a real hostname.
  if (spec.domain !== undefined) {
    const domains = await db.tenantDomains.list(scope)
    if (!domains.some((d) => d.domain === spec.domain)) {
      await db.tenantDomains.create(scope, SEED_ACTOR, spec.domain, randomBytes(16).toString('hex'), { verified: true })
    }
  }

  let created = 0
  let conflicts = 0
  for (let i = 0; i < spec.devices; i++) {
    const imei = (spec.imeiBase + BigInt(i)).toString()
    if ((await db.devices.getByImei(scope, imei)) !== null) {
      created++ // already present from an earlier run — still counts toward the fleet
      continue
    }
    const accountId = accountIds[i % accountIds.length]!
    try {
      const dev = await db.devices.create(scope, SEED_ACTOR, {
        accountId,
        profileId: profile.id,
        imei,
        name: `${spec.vehicle.label} ${String(i + 1).padStart(2, '0')}`,
        plate: `${spec.vehicle.plate} ${String(100 + i).slice(-3)}`,
      })
      await activateDevice(redis, {
        id: dev.id,
        imei,
        tenantId: tenant.id,
        accountId,
        config: { presenceRules: profile.presenceRules ?? {}, odometerSource: 'auto', avlTable: profile.avlTable },
      })
      created++
    } catch (err) {
      if (err instanceof DuplicateImeiError) {
        conflicts++
        log(`  SKIP ${imei}: already claimed by another tenant`)
      } else throw err
    }
  }

  // A geofence and an overspeed rule per tenant, synced to Redis as well as written — the engines
  // read Redis only, so a DB row alone would leave every alert screen permanently empty.
  const fenceName = `${spec.vehicle.plate} bazė`
  const fences = await db.geofences.list(scope)
  const fence =
    fences.find((f) => f.name === fenceName) ??
    (await db.geofences.create(scope, SEED_ACTOR, {
      name: fenceName,
      kind: 'polygon',
      accountId: accountIds[0]!,
      geometry: { type: 'Polygon', coordinates: [[[25.26, 54.67], [25.30, 54.67], [25.30, 54.70], [25.26, 54.70], [25.26, 54.67]]] },
    }))
  await syncGeofence(redis, fence)

  const rules = await db.rules.list(scope)
  const ruleName = 'Greičio viršijimas 90'
  const rule =
    rules.find((r) => r.name === ruleName) ??
    (await db.rules.create(scope, SEED_ACTOR, { accountId: accountIds[0]!, kind: 'overspeed', name: ruleName, config: { speedKmh: 90 } }))
  await syncRule(redis, rule)

  return { tenantId: tenant.id, users: spec.users.length, devices: created, conflicts }
}

const isLoopback = (host: string): boolean => host === '127.0.0.1' || host === 'localhost' || host === '::1'
const hostOf = (url: string): string => {
  try {
    return new URL(url).hostname
  } catch {
    return '' // malformed → treated as remote → refuses (safe default)
  }
}

async function main(): Promise<void> {
  const databaseUrl = process.env['DATABASE_URL'] ?? ''
  if (databaseUrl === '') {
    console.error('DATABASE_URL is required')
    process.exit(2)
  }
  const redisUrl = process.env['REDIS_URL'] ?? 'redis://127.0.0.1:6379'
  // same positive opt-in as the demo seed: scenario data does not belong near production by accident
  const remote = !isLoopback(hostOf(databaseUrl)) || !isLoopback(hostOf(redisUrl))
  if (remote && process.env['SEED_DEMO_ALLOW'] !== '1' && !process.argv.includes('--yes')) {
    console.error(`refusing to seed against a non-loopback target (db=${hostOf(databaseUrl)}, redis=${hostOf(redisUrl)}); set SEED_DEMO_ALLOW=1 or pass --yes`)
    process.exit(2)
  }
  const res = await seedScenarios({
    databaseUrl,
    redisUrl,
    ...(process.env['DEMO_PASSWORD'] !== undefined ? { password: process.env['DEMO_PASSWORD'] } : {}),
  })
  console.log('')
  console.log(`=== seeded ${res.totals.tenants} tenants, ${res.totals.users} users, ${res.totals.devices} devices ===`)
  console.log(`password for EVERY account: ${res.password}`)
  if (res.totals.imeiConflicts > 0) console.log(`WARNING: ${res.totals.imeiConflicts} IMEI conflicts skipped`)
}

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
