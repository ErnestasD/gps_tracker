import { execFileSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import pg from 'pg'
import { GenericContainer, Wait, type StartedTestContainer } from 'testcontainers'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { createDb, createPool, readDriverScores, type Db, type Pool } from '../src/index.js'

/**
 * V2 driver scoring aggregation. Proves the SQL rolls up a driver's trips (count/distance/maxSpeed/
 * idle/drive-time), attributes overspeed events ONLY when they fall within one of that driver's trip
 * windows on that trip's device, includes a driver with no trips (trips=0), and is tenant-scoped.
 */
const IMAGE = 'timescale/timescaledb-ha:pg16'
const PKG_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const actor = { userId: '00000000-0000-0000-0000-000000000010' }
const T0 = new Date('2026-07-10T08:00:00Z')

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

describe('V2 readDriverScores', () => {
  it('aggregates a driver’s trips + attributes only in-window overspeed events; unassigned driver → 0 trips', async () => {
    const tenant = await db.tenants.create(actor, { name: 'Score Co' })
    const account = await db.accounts.create({ tenantId: tenant.id }, actor, { name: 'Fleet' })
    const aScope = { tenantId: tenant.id, accountId: account.id }
    const [prof] = await q<{ id: string }>(`INSERT INTO device_profiles(id,key,name) VALUES (gen_random_uuid(),'ds','P') RETURNING id`)
    const device = await db.devices.create(aScope, actor, { accountId: account.id, profileId: prof!.id, imei: '356307042480001', name: 'Van' })
    const d1 = await db.drivers.create(aScope, actor, { accountId: account.id, name: 'Alice' })
    await db.drivers.create(aScope, actor, { accountId: account.id, name: 'Bob' }) // no trips → trips 0

    const dev = device.id.toString()
    const trip = async (startMin: number, endMin: number, distM: number, maxSpeed: number, idleS: number) => {
      const [r] = await q<{ id: string }>(
        `INSERT INTO trips ("tenantId","accountId","deviceId","status","startTime","endTime","distanceM","maxSpeed","idleS","driverId")
         VALUES ($1,$2,$3,'closed',$4,$5,$6,$7,$8,$9) RETURNING id`,
        [tenant.id, account.id, dev, new Date(T0.getTime() + startMin * 60_000), new Date(T0.getTime() + endMin * 60_000), distM, maxSpeed, idleS, d1.id])
      return r!.id
    }
    await trip(0, 30, 20_000, 88, 120)   // trip 1: 0–30 min
    await trip(60, 90, 30_000, 105, 300) // trip 2: 60–90 min
    const ev = (min: number, kind: string) => q(`INSERT INTO events ("tenantId","accountId","deviceId","kind","at") VALUES ($1,$2,$3,$4,$5)`,
      [tenant.id, account.id, dev, kind, new Date(T0.getTime() + min * 60_000)])
    await ev(10, 'overspeed')  // inside trip 1 → counts
    await ev(75, 'overspeed')  // inside trip 2 → counts
    await ev(45, 'overspeed')  // BETWEEN trips (no trip window) → does NOT count
    await ev(10, 'ignition')   // in-window but wrong kind → does NOT count

    const scores = await readDriverScores(pool, aScope, { from: '2026-07-01T00:00:00Z', to: '2026-07-20T00:00:00Z' })
    const alice = scores.find((s) => s.driverName === 'Alice')!
    expect(alice.trips).toBe(2)
    expect(alice.distanceM).toBe(50_000)
    expect(alice.maxSpeed).toBe(105)
    expect(alice.idleS).toBe(420)
    expect(alice.driveS).toBe(3600) // 30 min + 30 min
    expect(alice.overspeedEvents).toBe(2) // only the two in-window overspeed events
    const bob = scores.find((s) => s.driverName === 'Bob')!
    expect(bob.trips).toBe(0)
    expect(bob.overspeedEvents).toBe(0)
  })

  it('account-scoped: a scope with accountId sees ONLY that account’s drivers (review MED)', async () => {
    const tenant = await db.tenants.create(actor, { name: 'Two-Acct Co' })
    const tScope = { tenantId: tenant.id }
    const a1 = await db.accounts.create(tScope, actor, { name: 'A1' })
    const a2 = await db.accounts.create(tScope, actor, { name: 'A2' })
    await db.drivers.create({ tenantId: tenant.id, accountId: a1.id }, actor, { accountId: a1.id, name: 'A1 Driver' })
    await db.drivers.create({ tenantId: tenant.id, accountId: a2.id }, actor, { accountId: a2.id, name: 'A2 Driver' })
    // tenant-wide scope sees both
    expect((await readDriverScores(pool, tScope, {})).map((s) => s.driverName).sort()).toEqual(['A1 Driver', 'A2 Driver'])
    // account A1 scope sees ONLY A1's driver (the $4 accountId filter)
    expect((await readDriverScores(pool, { tenantId: tenant.id, accountId: a1.id }, {})).map((s) => s.driverName)).toEqual(['A1 Driver'])
  })

  it('is tenant-scoped: another tenant’s drivers never appear', async () => {
    const other = await db.tenants.create(actor, { name: 'Other Co' })
    const oa = await db.accounts.create({ tenantId: other.id }, actor, { name: 'A' })
    await db.drivers.create({ tenantId: other.id, accountId: oa.id }, actor, { accountId: oa.id, name: 'Zoltan' })
    const scores = await readDriverScores(pool, { tenantId: (await db.tenants.create(actor, { name: 'Empty Co' })).id }, {})
    expect(scores).toEqual([]) // a fresh tenant has no drivers
    // and the Other-Co driver is not visible from a different tenant's scope
    const otherScoped = await readDriverScores(pool, { tenantId: other.id }, {})
    expect(otherScoped.map((s) => s.driverName)).toEqual(['Zoltan'])
  })
})
