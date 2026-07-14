import { execFileSync } from 'node:child_process'
import { resolve } from 'node:path'
import type { Pool } from 'pg'
import { GenericContainer, Wait, type StartedTestContainer } from 'testcontainers'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { createPool } from '@orbetra/db'

import { closeTrip, openTrip } from '../src/trip/writer.js'

const IMAGE = 'timescale/timescaledb-ha:pg16'
const DB_PKG = resolve(import.meta.dirname, '../../../packages/db')

let container: StartedTestContainer
let pool: Pool

beforeAll(async () => {
  container = await new GenericContainer(IMAGE)
    .withEnvironment({ POSTGRES_PASSWORD: 'test', POSTGRES_DB: 'orbetra' })
    .withExposedPorts(5432)
    .withWaitStrategy(Wait.forLogMessage(/database system is ready to accept connections/, 2))
    .withStartupTimeout(240_000)
    .start()
  const url = `postgresql://postgres:test@${container.getHost()}:${container.getMappedPort(5432)}/orbetra`
  execFileSync('pnpm', ['exec', 'prisma', 'migrate', 'deploy'], { cwd: DB_PKG, env: { ...process.env, DATABASE_URL: url }, encoding: 'utf8' })
  pool = createPool(url)
}, 300_000)

afterAll(async () => {
  await pool?.end()
  await container?.stop()
})

const TEN = '11111111-1111-1111-1111-111111111111'
const ACC = '22222222-2222-2222-2222-222222222222'

describe('E04-1 trip writer (raw SQL persistence)', () => {
  it('openTrip inserts an open row; closeTrip finalizes it', async () => {
    const id = await openTrip(pool, { tenantId: TEN, accountId: ACC, deviceId: 356n, startTime: new Date('2026-07-01T10:00:00Z'), startLat: 54.68, startLon: 25.28 })
    const open = (await pool.query('SELECT * FROM trips WHERE id=$1', [id])).rows[0] as Record<string, unknown>
    expect(open['status']).toBe('open')
    expect(open['tenantId']).toBe(TEN)
    expect(open['deviceId']).toBe('356')
    expect(open['endTime']).toBeNull()

    await closeTrip(pool, id, { endTime: new Date('2026-07-01T10:30:00Z'), endLat: 54.7, endLon: 25.3, distanceM: 5400, distanceSource: 'odometer', maxSpeed: 92, idleS: 180 })
    const closed = (await pool.query('SELECT * FROM trips WHERE id=$1', [id])).rows[0] as Record<string, unknown>
    expect(closed['status']).toBe('closed')
    expect(closed['distanceM']).toBe(5400)
    expect(closed['distanceSource']).toBe('odometer')
    expect(closed['maxSpeed']).toBe(92)
    expect(closed['idleS']).toBe(180)
    expect(closed['endTime']).not.toBeNull()
  })

  it('closeTrip auto-sets driverId on a null-driver trip, but COALESCE keeps a manual assignment (V2 Part B)', async () => {
    const drvA = '33333333-3333-3333-3333-333333333333'
    const drvB = '44444444-4444-4444-4444-444444444444'
    await pool.query(`INSERT INTO drivers (id,"tenantId","accountId",name) VALUES ($1,$2,$3,'Auto'),($4,$2,$3,'Manual')`, [drvA, TEN, ACC, drvB])

    // (1) fresh trip (driverId null) → auto-resolved driver fills it
    const id1 = await openTrip(pool, { tenantId: TEN, accountId: ACC, deviceId: 358n, startTime: new Date('2026-07-02T10:00:00Z'), startLat: 54, startLon: 25 })
    await closeTrip(pool, id1, { endTime: new Date('2026-07-02T10:30:00Z'), endLat: 54, endLon: 25, distanceM: 100, distanceSource: 'gps', maxSpeed: 40, idleS: 0, driverId: drvA })
    expect(((await pool.query('SELECT "driverId" FROM trips WHERE id=$1', [id1])).rows[0] as Record<string, unknown>)['driverId']).toBe(drvA)

    // (2) trip manually assigned (drvB) while open → auto close with a DIFFERENT driver must NOT overwrite it
    const id2 = await openTrip(pool, { tenantId: TEN, accountId: ACC, deviceId: 359n, startTime: new Date('2026-07-02T11:00:00Z'), startLat: 54, startLon: 25 })
    await pool.query('UPDATE trips SET "driverId"=$2 WHERE id=$1', [id2, drvB]) // manual assignment
    await closeTrip(pool, id2, { endTime: new Date('2026-07-02T11:30:00Z'), endLat: 54, endLon: 25, distanceM: 100, distanceSource: 'gps', maxSpeed: 40, idleS: 0, driverId: drvA })
    expect(((await pool.query('SELECT "driverId" FROM trips WHERE id=$1', [id2])).rows[0] as Record<string, unknown>)['driverId']).toBe(drvB) // manual wins
  })

  it('closeTrip on an already-closed row is a no-op (guarded on status=open — replay-safe)', async () => {
    const id = await openTrip(pool, { tenantId: TEN, accountId: ACC, deviceId: 357n, startTime: new Date('2026-07-01T11:00:00Z'), startLat: 54, startLon: 25 })
    await closeTrip(pool, id, { endTime: new Date('2026-07-01T11:10:00Z'), endLat: 54, endLon: 25, distanceM: 1000, distanceSource: 'gps', maxSpeed: 50, idleS: 0 })
    // a replayed/duplicate close must not overwrite the finalized row
    await closeTrip(pool, id, { endTime: new Date('2026-07-01T12:00:00Z'), endLat: 99, endLon: 99, distanceM: 9999, distanceSource: 'gps', maxSpeed: 1, idleS: 1 })
    const row = (await pool.query('SELECT * FROM trips WHERE id=$1', [id])).rows[0] as Record<string, unknown>
    expect(row['distanceM']).toBe(1000) // unchanged by the second close
    expect(row['maxSpeed']).toBe(50)
  })
})
