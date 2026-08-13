import { execFileSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import pg from 'pg'
import { GenericContainer, Wait, type StartedTestContainer } from 'testcontainers'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { DuplicateImeiError, createDb, type Db } from '../src/index.js'

/**
 * Who holds an IMEI, and for how long (audit 2026-08-11, module 2, finding #2).
 *
 * The cross-tenant hold is deliberate and its reason is data protection, not identifier hygiene:
 * the physical tracker may still be wired to a vehicle and transmitting, and whoever holds the IMEI
 * in `registry:imei` receives its live positions. A stranger reclaiming it starts receiving another
 * company's vehicle. That is why the hold must NOT expire on a timer — a timer would open exactly
 * that door for any tracker its owner retired but never uninstalled.
 *
 * What the hold got wrong is that it had no way OUT. `countActive` filters `retiredAt: null` while
 * the hold predicate does not, so retiring freed the plan slot and kept the block: create→retire in
 * a loop squatted an unbounded number of IMEIs against every other tenant, from a free trial
 * account, with no rate limit, and no remedy — deleting the squatting tenant fails on a RESTRICT
 * foreign key, so releasing one needed manual SQL.
 *
 * The remedy is the one mature telematics platforms use: an identifier dispute is settled by the
 * OPERATOR, not self-service. A platform_admin claiming out of quarantine may override a RETIRED
 * holder, and never an active one. Quarantine membership is a PRECONDITION, not evidence — anyone
 * with a socket can put an IMEI there, and a tracker retired but never uninstalled produces the
 * same entry as a squatted one. What owns the hardware is decided off-platform.
 */
const IMAGE = 'timescale/timescaledb-ha:pg16'
const PKG_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const actor = { userId: '00000000-0000-0000-0000-00000000000e' }
const IMEI_RETIRED = '356307042440111'
const IMEI_ACTIVE = '356307042440222'

let container: StartedTestContainer
let db: Db
let squatter: { tenantId: string }
let victim: { tenantId: string }
let squatterAccount: string
let victimAccount: string
let profileId: string
let url: string

beforeAll(async () => {
  container = await new GenericContainer(IMAGE)
    .withEnvironment({ POSTGRES_PASSWORD: 'test', POSTGRES_DB: 'orbetra' })
    .withExposedPorts(5432)
    .withWaitStrategy(Wait.forLogMessage(/database system is ready to accept connections/, 2))
    .withStartupTimeout(240_000)
    .start()
  url = `postgresql://postgres:test@${container.getHost()}:${container.getMappedPort(5432)}/orbetra`
  execFileSync('pnpm', ['exec', 'prisma', 'migrate', 'deploy'], { cwd: PKG_DIR, env: { ...process.env, DATABASE_URL: url }, encoding: 'utf8' })
  db = createDb(url)

  const t1 = await db.tenants.create(actor, { name: 'Squatter Ltd' })
  const t2 = await db.tenants.create(actor, { name: 'Victim Logistics' })
  squatter = { tenantId: t1.id }
  victim = { tenantId: t2.id }
  squatterAccount = (await db.accounts.create(squatter, actor, { name: 'Fleet' })).id
  victimAccount = (await db.accounts.create(victim, actor, { name: 'Fleet' })).id
  // device_profiles is global reference data seeded outside migrations; make one for the FK
  const c = new pg.Client({ connectionString: url })
  await c.connect()
  try {
    profileId = (await c.query<{ id: string }>(`INSERT INTO device_profiles(id,key,name) VALUES (gen_random_uuid(),'imei-hold-k','P') RETURNING id`)).rows[0]!.id
  } finally {
    await c.end()
  }
}, 300_000)

afterAll(async () => {
  await db?.$disconnect()
  await container?.stop()
})

describe('IMEI hold across tenants', () => {
  it('retiring frees the plan slot but NOT the hold — this is the squat, and it still holds by default', async () => {
    const d = await db.devices.create(squatter, actor, { accountId: squatterAccount, profileId, imei: IMEI_RETIRED, name: 'squat' })
    expect(await db.devices.countActive(squatter)).toBe(1)
    await db.devices.retire(squatter, actor, d.id.toString())
    // the asymmetry that made the squat free: the cap denominator drops, the block does not
    expect(await db.devices.countActive(squatter)).toBe(0)
    await expect(
      db.devices.create(victim, actor, { accountId: victimAccount, profileId, imei: IMEI_RETIRED, name: 'mine' }),
    ).rejects.toBeInstanceOf(DuplicateImeiError)
  })

  it('a platform claim MAY override a RETIRED holder — the operator remedy that did not exist', async () => {
    // precondition in production: the IMEI is in quarantine. That bounds WHERE the override can be
    // aimed — never at a hold at rest — and nothing more; the ownership decision is the operator's.
    const claimed = await db.devices.create(
      victim,
      actor,
      { accountId: victimAccount, profileId, imei: IMEI_RETIRED, name: 'reclaimed' },
      { overrideRetiredHolder: true },
    )
    expect(claimed.imei).toBe(IMEI_RETIRED)
    expect(claimed.tenantId).toBe(victim.tenantId)
  })

  /**
   * The two below lock the behaviour, and it is worth being straight about WHERE the guarantee comes
   * from, because review proved these two keep passing even if the repo predicate is replaced with
   * `null` outright. They are not testing the predicate. The active-holder guarantee lives in the
   * database: `devices_imei_active_key`, a GLOBAL partial unique index on `(imei) WHERE "retiredAt"
   * IS NULL` (migration 20260805150000), makes two live rows on one IMEI impossible, so every
   * active-vs-active collision surfaces as P2002 → DuplicateImeiError no matter what the repo does.
   * The predicate's own load-bearing job is the RETIRED cross-tenant holder, which the index cannot
   * see and which the first two tests cover. `the index that actually enforces it` below is the
   * test that would go red if the real mechanism were dropped.
   */
  it('…and NEVER an ACTIVE one, however the claim is made', async () => {
    // The whole reason the hold exists. An active holder means the tracker is in service in another
    // account and its positions are being delivered there; handing the IMEI to anyone else points
    // another company's vehicle into a stranger's map. No override, no platform role, no quarantine
    // entry may cross this.
    await db.devices.create(squatter, actor, { accountId: squatterAccount, profileId, imei: IMEI_ACTIVE, name: 'in service' })
    await expect(
      db.devices.create(victim, actor, { accountId: victimAccount, profileId, imei: IMEI_ACTIVE, name: 'steal' }, { overrideRetiredHolder: true }),
    ).rejects.toBeInstanceOf(DuplicateImeiError)
  })

  it('a retired row parked beside a live one is not a skeleton key', async () => {
    // A retired row and an active row can both carry the same IMEI — the unique index is partial on
    // `retiredAt IS NULL`. The override narrows WHICH rows block; it must not become "ignore this
    // IMEI's history entirely".
    const imei = '356307042440333'
    const held = await db.devices.create(squatter, actor, { accountId: squatterAccount, profileId, imei, name: 'first' })
    await db.devices.retire(squatter, actor, held.id.toString())
    await db.devices.create(squatter, actor, { accountId: squatterAccount, profileId, imei, name: 'back in service' })
    await expect(
      db.devices.create(victim, actor, { accountId: victimAccount, profileId, imei, name: 'steal' }, { overrideRetiredHolder: true }),
    ).rejects.toBeInstanceOf(DuplicateImeiError)
  })

  it('a SUSPENDED tenant\'s devices are not offered to the boot rehydrate', async () => {
    // Billing suspension IS the removal of the Redis registry keys; `suspendedAt` is the durable
    // record. The rehydrate rebuilds that registry from `devices`, so without this predicate every
    // API restart put a cut-off fleet back on the air — customer emailed "your fleet has been
    // stopped", vehicles back on the map, admin panel still saying suspended, traffic metered. The
    // daily lapse sweep re-asserted it eventually, and never at all for a tenant suspended by a
    // platform admin rather than by the ladder.
    const before = await db.devices.listAllForRegistry()
    expect(before.some((d) => d.tenantId === squatter.tenantId)).toBe(true)
    const c = new pg.Client({ connectionString: url })
    await c.connect()
    try {
      await c.query(`UPDATE tenants SET "suspendedAt" = now() WHERE id = $1`, [squatter.tenantId])
      const during = await db.devices.listAllForRegistry()
      expect(during.some((d) => d.tenantId === squatter.tenantId)).toBe(false)
      expect(during.some((d) => d.tenantId === victim.tenantId)).toBe(true) // …and only that tenant
      await c.query(`UPDATE tenants SET "suspendedAt" = NULL WHERE id = $1`, [squatter.tenantId])
      expect((await db.devices.listAllForRegistry()).some((d) => d.tenantId === squatter.tenantId)).toBe(true)
    } finally {
      await c.end()
    }
  })

  it('the index that actually enforces it is still there, and still partial on retiredAt', async () => {
    // Drop or widen this index and the two tests above keep passing while the guarantee is gone.
    // This is the one that notices.
    const c = new pg.Client({ connectionString: url })
    await c.connect()
    try {
      const { rows } = await c.query<{ indexdef: string }>(
        `SELECT indexdef FROM pg_indexes WHERE tablename = 'devices' AND indexname = 'devices_imei_active_key'`,
      )
      expect(rows).toHaveLength(1)
      expect(rows[0]!.indexdef).toMatch(/UNIQUE/)
      expect(rows[0]!.indexdef).toMatch(/\(imei\)/)
      expect(rows[0]!.indexdef).toMatch(/WHERE \("retiredAt" IS NULL\)/)
      // and NOT scoped to a tenant — a per-tenant index would let two tenants both hold it live
      expect(rows[0]!.indexdef).not.toMatch(/tenantId/)
    } finally {
      await c.end()
    }
  })
})
