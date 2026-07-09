import { execFileSync } from 'node:child_process'
import { resolve } from 'node:path'
import type { Pool } from 'pg'
import { GenericContainer, Wait, type StartedTestContainer } from 'testcontainers'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { createPool } from '@orbetra/db'

import { writeGeofenceEvents } from '../src/geofence/writer.js'

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
