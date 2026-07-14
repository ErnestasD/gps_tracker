import { execFileSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import pg from 'pg'
import { GenericContainer, Wait, type StartedTestContainer } from 'testcontainers'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { createDb, DriverNotInScopeError, type Db } from '../src/index.js'

/**
 * V2 trip↔driver assignment. Proves: assignDriver stamps the driver + exposes the joined name,
 * clearing (null) works, a cross-tenant/-account driver is REFUSED (DriverNotInScopeError, never
 * assigned), an out-of-scope trip → null (not a leak), and deleting a driver SET NULLs the trip
 * (history survives). Trips are pipeline-written (raw SQL) so we seed one via the pool.
 */
const IMAGE = 'timescale/timescaledb-ha:pg16'
const PKG_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const actor = { userId: '00000000-0000-0000-0000-00000000000e' }

let container: StartedTestContainer
let url: string
let db: Db

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
}, 300_000)

afterAll(async () => {
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
  const [prof] = await q<{ id: string }>(`INSERT INTO device_profiles(id,key,name) VALUES (gen_random_uuid(),'td-${imei}','P') RETURNING id`)
  const device = await db.devices.create(aScope, actor, { accountId: account.id, profileId: prof!.id, imei, name: 'Van' })
  const [trip] = await q<{ id: string }>(
    `INSERT INTO trips ("tenantId","accountId","deviceId","status","startTime") VALUES ($1,$2,$3,'closed',now()) RETURNING id`,
    [tenant.id, account.id, device.id.toString()],
  )
  const driver = await db.drivers.create(aScope, actor, { accountId: account.id, name: `${name} Driver` })
  return { tenant, account, aScope, tripId: trip!.id, driver }
}

describe('V2 trip driver assignment', () => {
  it('assigns, exposes the joined driver name, and clears', async () => {
    const s = await seed('Assign Co', '356307042450001')
    const assigned = await db.trips.assignDriver(s.aScope, actor, s.tripId, s.driver.id)
    expect(assigned?.driverId).toBe(s.driver.id)
    expect(assigned?.driverName).toBe('Assign Co Driver')
    // the read (get/list) exposes the joined name
    expect((await db.trips.get(s.aScope, s.tripId))?.driverName).toBe('Assign Co Driver')
    // clear
    const cleared = await db.trips.assignDriver(s.aScope, actor, s.tripId, null)
    expect(cleared?.driverId).toBeNull()
    expect(cleared?.driverName).toBeNull()
  })

  it('refuses a driver from another tenant/account (never assigns it), and an out-of-scope trip → null', async () => {
    const a = await seed('Tenant A', '356307042450002')
    const b = await seed('Tenant B', '356307042450003')
    // B's driver cannot be assigned to A's trip
    await expect(db.trips.assignDriver(a.aScope, actor, a.tripId, b.driver.id)).rejects.toBeInstanceOf(DriverNotInScopeError)
    expect((await db.trips.get(a.aScope, a.tripId))?.driverId).toBeNull() // unchanged
    // A cannot touch B's trip at all (out of scope → null, not a leak)
    expect(await db.trips.assignDriver(a.aScope, actor, b.tripId, a.driver.id)).toBeNull()
  })

  it('deleting an assigned driver SET NULLs the trip (history survives)', async () => {
    const s = await seed('Del Co', '356307042450004')
    await db.trips.assignDriver(s.aScope, actor, s.tripId, s.driver.id)
    expect(await db.drivers.remove(s.aScope, actor, s.driver.id)).toBe(true)
    const after = await db.trips.get(s.aScope, s.tripId)
    expect(after).not.toBeNull() // trip still there
    expect(after?.driverId).toBeNull() // FK SET NULL
  })
})
