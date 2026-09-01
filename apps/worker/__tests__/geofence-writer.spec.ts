import { execFileSync } from 'node:child_process'
import { resolve } from 'node:path'
import type { Pool } from 'pg'
import { GenericContainer, Wait, type StartedTestContainer } from 'testcontainers'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { createPool } from '@orbetra/db'

import { writeGeofenceEvents, closeGeofenceStates, type GeofenceEventRow } from '../src/geofence/writer.js'

const IMAGE = 'timescale/timescaledb-ha:pg16'
const DB_PKG = resolve(import.meta.dirname, '../../../packages/db')
let container: StartedTestContainer
let pool: Pool
const TEN = '11111111-1111-1111-1111-111111111111'
const ACC = '22222222-2222-2222-2222-222222222222'

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

describe('E05-2 writeGeofenceEvents', () => {
  it('inserts geofence events into the events table (kind + payload + lat/lon)', async () => {
    const n = await writeGeofenceEvents(pool, [
      { tenantId: TEN, accountId: ACC, deviceId: 356n, at: new Date('2026-07-01T10:00:00Z'), lat: 54.5, lon: 25.5, payload: { geofenceId: 'gf1', name: 'Depot', transition: 'enter' } },
      { tenantId: TEN, accountId: ACC, deviceId: 356n, at: new Date('2026-07-01T10:05:00Z'), lat: 54.6, lon: 25.6, payload: { geofenceId: 'gf1', name: 'Depot', transition: 'exit' } },
    ])
    expect(n).toBe(2)
    const rows = (await pool.query(`SELECT kind, "deviceId", lat, payload FROM events WHERE kind='geofence' ORDER BY at`)).rows as { kind: string; deviceId: string; lat: number; payload: { transition: string } }[]
    expect(rows).toHaveLength(2)
    expect(rows[0]!.kind).toBe('geofence')
    expect(rows[0]!.deviceId).toBe('356')
    expect(rows[0]!.payload.transition).toBe('enter')
    expect(rows[1]!.payload.transition).toBe('exit')
  })
})

describe('closeGeofenceStates — how long the van was away', () => {
  const GF = 'gf-pair'
  const ev = (deviceId: bigint, at: string, transition: 'enter' | 'exit'): GeofenceEventRow => ({
    tenantId: TEN, accountId: ACC, deviceId, at: new Date(at), lat: 54.5, lon: 25.5,
    payload: { geofenceId: GF, name: 'Depot', transition },
  })
  const rows = async (deviceId: bigint) =>
    (await pool.query<{ at: Date; endedAt: Date | null; payload: { transition: string } }>(
      `SELECT "at","endedAt",payload FROM events WHERE "deviceId"=$1 AND kind='geofence' ORDER BY "at"`,
      [deviceId.toString()],
    )).rows

  it('an enter closes the exit before it — the pair IS the duration', async () => {
    const dev = 2001n
    await writeGeofenceEvents(pool, [ev(dev, '2026-09-01T08:00:00Z', 'exit')])
    await writeGeofenceEvents(pool, [ev(dev, '2026-09-01T17:00:00Z', 'enter')])
    await closeGeofenceStates(pool, [ev(dev, '2026-09-01T17:00:00Z', 'enter')])
    const r = await rows(dev)
    // the EXIT now says how long the vehicle was away; the enter is still open (time inside)
    expect(r[0]!.payload.transition).toBe('exit')
    expect((r[0]!.endedAt!.getTime() - r[0]!.at.getTime()) / 3_600_000).toBe(9)
    expect(r[1]!.endedAt).toBeNull()
  })

  it('is symmetric — an exit closes the enter, giving time INSIDE a restricted zone', async () => {
    const dev = 2002n
    await writeGeofenceEvents(pool, [ev(dev, '2026-09-01T09:00:00Z', 'enter')])
    await writeGeofenceEvents(pool, [ev(dev, '2026-09-01T09:08:00Z', 'exit')])
    await closeGeofenceStates(pool, [ev(dev, '2026-09-01T09:08:00Z', 'exit')])
    const r = await rows(dev)
    expect((r[0]!.endedAt!.getTime() - r[0]!.at.getTime()) / 60_000).toBe(8)
  })

  it('closes only the NEWEST open opposite, never an older one it already closed', async () => {
    const dev = 2003n
    for (const [t, k] of [['10:00', 'exit'], ['10:10', 'enter'], ['11:00', 'exit']] as const) {
      await writeGeofenceEvents(pool, [ev(dev, `2026-09-01T${t}:00Z`, k)])
      await closeGeofenceStates(pool, [ev(dev, `2026-09-01T${t}:00Z`, k)])
    }
    await writeGeofenceEvents(pool, [ev(dev, '2026-09-01T11:30:00Z', 'enter')])
    await closeGeofenceStates(pool, [ev(dev, '2026-09-01T11:30:00Z', 'enter')])
    const r = await rows(dev)
    // the first trip out was 10 minutes and must STAY 10 minutes — the second enter closes the
    // 11:00 exit, not the 10:00 one it already ended
    expect((r[0]!.endedAt!.getTime() - r[0]!.at.getTime()) / 60_000).toBe(10)
    expect((r[2]!.endedAt!.getTime() - r[2]!.at.getTime()) / 60_000).toBe(30)
  })

  it('refuses to pair across a zone the vehicle abandoned months ago', async () => {
    const dev = 2004n
    await writeGeofenceEvents(pool, [ev(dev, '2026-01-01T08:00:00Z', 'exit')])
    const n = await closeGeofenceStates(pool, [ev(dev, '2026-09-01T08:00:00Z', 'enter')])
    expect(n).toBe(0) // otherwise this would report a vehicle "away" for eight months
  })
})
