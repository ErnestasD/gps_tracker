import { execFileSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import pg from 'pg'
import { GenericContainer, Wait, type StartedTestContainer } from 'testcontainers'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { createDb, readOdometersKm, type Db, type Pool } from '../src/index.js'
import { createPool } from '../src/pool.js'

/**
 * V2 maintenance repo + the odometer batch read. Proves scoped CRUD, markServiced baseline reset,
 * cross-tenant isolation, and that readOdometersKm returns max(odometer_m)/1000 per device.
 */
const IMAGE = 'timescale/timescaledb-ha:pg16'
const PKG_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const actor = { userId: '00000000-0000-0000-0000-00000000000f' }

let container: StartedTestContainer
let url: string
let db: Db
let pool: Pool

beforeAll(async () => {
  container = await new GenericContainer(IMAGE)
    .withEnvironment({ POSTGRES_PASSWORD: 'test', POSTGRES_DB: 'orbetra' })
    .withExposedPorts(5432)
    .withWaitStrategy(Wait.forLogMessage(/database system is ready to accept connections/, 2))
    .withStartupTimeout(240_000)
    .start()
  url = `postgresql://postgres:test@${container.getHost()}:${container.getMappedPort(5432)}/orbetra`
  execFileSync('pnpm', ['exec', 'prisma', 'migrate', 'deploy'], { cwd: PKG_DIR, env: { ...process.env, DATABASE_URL: url }, encoding: 'utf8' })
  execFileSync('pnpm', ['exec', 'tsx', 'sql/migrate.ts'], { cwd: PKG_DIR, env: { ...process.env, DATABASE_URL: url }, encoding: 'utf8' }) // positions hypertable
  db = createDb(url)
  pool = createPool(url)
}, 300_000)

afterAll(async () => {
  await pool?.end()
  await db?.$disconnect()
  await container?.stop()
})

const q = async <T extends pg.QueryResultRow>(sql: string, params?: unknown[]): Promise<T[]> => {
  const c = new pg.Client({ connectionString: url })
  await c.connect()
  try { return (await c.query<T>(sql, params as never)).rows } finally { await c.end() }
}

async function seed(name: string, imei: string) {
  const tenant = await db.tenants.create(actor, { name })
  const account = await db.accounts.create({ tenantId: tenant.id }, actor, { name: `${name} A` })
  const aScope = { tenantId: tenant.id, accountId: account.id }
  const [prof] = await q<{ id: string }>(`INSERT INTO device_profiles(id,key,name) VALUES (gen_random_uuid(),'mt-${imei}','P') RETURNING id`)
  const device = await db.devices.create(aScope, actor, { accountId: account.id, profileId: prof!.id, imei, name: 'Van' })
  return { tenant, account, aScope, deviceId: device.id }
}

describe('V2 maintenance repo', () => {
  it('creates, lists (scoped), updates, marks serviced, removes', async () => {
    const s = await seed('Maint Co', '356307042460001')
    const item = await db.maintenance.create(s.aScope, actor, { accountId: s.account.id, deviceId: s.deviceId, title: 'Oil change', intervalKm: 15000 })
    expect(item.title).toBe('Oil change')
    expect((await db.maintenance.list(s.aScope)).map((i) => i.id)).toContain(item.id)
    expect((await db.maintenance.list(s.aScope, s.deviceId)).length).toBe(1)
    const upd = await db.maintenance.update(s.aScope, actor, item.id, { intervalDays: 365 })
    expect(upd?.intervalDays).toBe(365)
    // mark serviced → baseline set
    const at = new Date('2026-07-01T00:00:00Z')
    const serviced = await db.maintenance.markServiced(s.aScope, actor, item.id, at, 42000)
    expect(serviced?.lastServiceOdoKm).toBe(42000)
    expect(serviced?.lastServiceAt?.toISOString()).toBe(at.toISOString())
    expect(await db.maintenance.remove(s.aScope, actor, item.id)).toBe(true)
    expect(await db.maintenance.get(s.aScope, item.id)).toBeNull()
  })

  it('scopes strictly: another tenant cannot see/update/remove the item', async () => {
    const a = await seed('Tenant A', '356307042460002')
    const b = await seed('Tenant B', '356307042460003')
    const item = await db.maintenance.create(a.aScope, actor, { accountId: a.account.id, deviceId: a.deviceId, title: 'Tyres' })
    expect((await db.maintenance.list(b.aScope)).map((i) => i.id)).not.toContain(item.id)
    expect(await db.maintenance.update(b.aScope, actor, item.id, { title: 'hacked' })).toBeNull()
    expect(await db.maintenance.remove(b.aScope, actor, item.id)).toBe(false)
  })

  it('readOdometersKm returns max(odometer_m)/1000 per device (monotonic → current)', async () => {
    const s = await seed('Odo Co', '356307042460004')
    const T0 = Date.UTC(2026, 6, 1, 0, 0, 0)
    for (const [min, odoM] of [[0, 120_000], [10, 250_500], [5, 200_000]] as const) {
      await q(`INSERT INTO positions (device_id, fix_time, lat, lon, fix_valid, rec_hash, odometer_m) VALUES ($1,$2,54.7,25.3,true,$3,$4)`,
        [s.deviceId.toString(), new Date(T0 + min * 60_000), String(min + 1), odoM])
    }
    const map = await readOdometersKm(pool, [s.deviceId])
    expect(map.get(s.deviceId.toString())).toBe(250.5) // max 250500 m → 250.5 km
    // a device with no odometer rows is simply absent
    expect((await readOdometersKm(pool, [999999n])).size).toBe(0)
  })
})
