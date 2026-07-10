import pg from 'pg'
import { GenericContainer, Wait, type StartedTestContainer } from 'testcontainers'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { readFuelSeries } from '../src/fuel.js'
import { migrate } from '../sql/migrate.js'

/**
 * E08-3 fuel-series reader over real positions rows. Seeds attrs jsonb with the forced
 * io_<id> fuel keys (worker normalize contract) plus deliberate garbage, and proves unit
 * handling: io_89/io_48 are %, io_84 is liters ×0.1 (FMB120 sending-params wiki).
 */
const IMAGE = 'timescale/timescaledb-ha:pg16'

let container: StartedTestContainer
let pool: pg.Pool

const T0 = Date.UTC(2026, 6, 1, 12, 0, 0)
const at = (min: number) => new Date(T0 + min * 60_000)

beforeAll(async () => {
  container = await new GenericContainer(IMAGE)
    .withEnvironment({ POSTGRES_PASSWORD: 'test', POSTGRES_DB: 'fuel' })
    .withExposedPorts(5432)
    .withWaitStrategy(Wait.forLogMessage(/database system is ready to accept connections/, 2))
    .withStartupTimeout(240_000)
    .start()
  const url = `postgresql://postgres:test@${container.getHost()}:${container.getMappedPort(5432)}/fuel`
  await migrate(url)
  pool = new pg.Pool({ connectionString: url })

  const insert = `INSERT INTO positions (device_id, fix_time, lat, lon, fix_valid, rec_hash, attrs)
    VALUES ($1, $2, 54.7, 25.3, true, $3, $4::jsonb)`
  let hash = 1n
  const seed = (deviceId: number, minute: number, attrs: Record<string, unknown>) =>
    pool.query(insert, [deviceId, at(minute), (hash++).toString(), JSON.stringify(attrs)])

  await seed(7, 0, { io_89: 80 }) // % only
  await seed(7, 1, { io_89: 79, io_84: 412 }) // % + liters (412 raw → 41.2 l)
  await seed(7, 2, { io_84: 405 }) // liters only
  await seed(7, 3, { io_48: 51 }) // OBD % fallback
  await seed(7, 4, { io_89: 'garbage', io_84: 'NaN' }) // fuel keys with junk values → skipped
  await seed(7, 5, { 'GSM Signal': 4 }) // no fuel keys at all → not selected
  await seed(7, 6, { io_89: 76, io_89_note: 'x' })
  await seed(8, 0, { io_89: 55 }) // another device — must not leak into device 7's series
}, 240_000)

afterAll(async () => {
  await pool?.end()
  await container?.stop()
})

describe('E08-3 readFuelSeries', () => {
  it('returns the chronological fuel series with wiki unit conversion (84 ×0.1)', async () => {
    const rows = await readFuelSeries(pool, 7n)
    expect(rows.map((r) => [r.pct, r.liters])).toEqual([
      [80, null],
      [79, 41.2],
      [null, 40.5],
      [51, null], // io_48 OBD % fallback
      [76, null], // the garbage row (min 4) was skipped, min 5 has no fuel keys
    ])
    expect(rows.map((r) => r.fixTime)).toEqual([...rows.map((r) => r.fixTime)].sort())
  })

  it('scopes strictly by device id', async () => {
    const rows = await readFuelSeries(pool, 8n)
    expect(rows).toHaveLength(1)
    expect(rows[0]!.pct).toBe(55)
  })

  it('applies from/to bounds and ignores garbage dates (never 500s)', async () => {
    const bounded = await readFuelSeries(pool, 7n, { from: at(1).toISOString(), to: at(2).toISOString() })
    expect(bounded.map((r) => r.liters)).toEqual([41.2, 40.5])
    const garbage = await readFuelSeries(pool, 7n, { from: 'not-a-date', to: '+999999999-12-31' })
    expect(garbage).toHaveLength(5) // bounds dropped, full series returned
  })

  it('empty device → empty series; limit clamps', async () => {
    expect(await readFuelSeries(pool, 999n)).toEqual([])
    const limited = await readFuelSeries(pool, 7n, { limit: 2 })
    expect(limited).toHaveLength(2)
  })
})
