import { execFileSync } from 'node:child_process'
import { resolve } from 'node:path'
import type { Pool } from 'pg'
import { GenericContainer, Wait, type StartedTestContainer } from 'testcontainers'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { createPool } from '@orbetra/db'

import { closeTrip, openTrip } from '../src/trip/writer.js'

/**
 * `trips."distanceM"` is INTEGER; the wire field feeding it is not.
 *
 * AVL id 16 (Total Odometer) is 4 bytes UNSIGNED — 0…4,294,967,295 m in the FMB120 dictionary this
 * repo ships — and int4 stops at 2,147,483,647, so the column cannot hold the top half of the
 * protocol's own range. A stuck-high or sentinel odometer (0xFFFFFFFF) is *monotonic*, so the
 * engine's only odometer sanity check (a DECREASE marks it broken) accepts it and picks
 * `distanceSource: 'odometer'`.
 *
 * Before the clamp, `closeTrip` threw 22003 on the hot path. That is the expensive part: the engine
 * has already dropped the trip from memory, so the row stays open until the next journey force-
 * closes it at 0 km, and the compensating recompute carries the same value — three attempts, all
 * failing, then discarded. One bad reading destroyed a journey's mileage AND disabled the
 * authoritative rebuild for every window containing it.
 */
const IMAGE = 'timescale/timescaledb-ha:pg16'
const DB_PKG = resolve(import.meta.dirname, '../../../packages/db')
const DEV = 356_307_042_440_777n
const SCOPE = { tenantId: '11111111-1111-1111-1111-111111111111', accountId: '22222222-2222-2222-2222-222222222222' }
const INT4_MAX = 2_147_483_647
/** the 4-byte unsigned sentinel a Teltonika odometer reports when the value is unavailable */
const ODO_SENTINEL_DELTA = 4_294_967_295

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

describe('a garbage odometer must not throw on the trip close path', () => {
  it('saturates at int4 instead of raising 22003 and stranding the trip', async () => {
    const id = await openTrip(pool, {
      tenantId: SCOPE.tenantId, accountId: SCOPE.accountId, deviceId: DEV,
      startTime: new Date('2026-07-01T08:00:00Z'), startLat: 54.68, startLon: 25.27,
    })
    await expect(
      closeTrip(pool, id, {
        endTime: new Date('2026-07-01T08:30:00Z'), endLat: 54.7, endLon: 25.3,
        distanceM: ODO_SENTINEL_DELTA, distanceSource: 'odometer', maxSpeed: 90, idleS: 0,
      }),
    ).resolves.toBe(true) // …and it reports that a row was written, which is what the metric counts

    const { rows } = await pool.query<{ status: string; distanceM: number }>(
      'SELECT status, "distanceM" FROM trips WHERE id = $1', [id],
    )
    // CLOSED is the assertion that matters — an open row bills engine-hours to now() until the
    // device's next journey, and that journey's force-close writes 0 km over it
    expect(rows[0]!.status).toBe('closed')
    expect(rows[0]!.distanceM).toBe(INT4_MAX)
  }, 60_000)

  it('leaves an ordinary distance untouched — the clamp must not round real journeys', async () => {
    const id = await openTrip(pool, {
      tenantId: SCOPE.tenantId, accountId: SCOPE.accountId, deviceId: DEV,
      startTime: new Date('2026-07-02T08:00:00Z'), startLat: 54.68, startLon: 25.27,
    })
    await closeTrip(pool, id, {
      endTime: new Date('2026-07-02T08:30:00Z'), endLat: 54.7, endLon: 25.3,
      distanceM: 14_011, distanceSource: 'gps', maxSpeed: 92, idleS: 137,
    })
    const { rows } = await pool.query<{ distanceM: number; maxSpeed: number; idleS: number }>(
      'SELECT "distanceM", "maxSpeed", "idleS" FROM trips WHERE id = $1', [id],
    )
    expect(rows[0]).toEqual({ distanceM: 14_011, maxSpeed: 92, idleS: 137 })
  }, 60_000)
})
