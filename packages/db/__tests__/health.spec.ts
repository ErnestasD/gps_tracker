import pg from 'pg'
import { GenericContainer, Wait, type StartedTestContainer } from 'testcontainers'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { readHealthSeries } from '../src/health.js'
import { migrate } from '../sql/migrate.js'

/**
 * V1-nice device-health reader over real positions rows. Seeds attrs with both the
 * dictionary-name keys (what normalize writes) and io_<id> fallbacks, plus garbage, and
 * proves voltage scaling (mV→V ×0.001) + GSM passthrough + scoping.
 */
const IMAGE = 'timescale/timescaledb-ha:pg16'
let container: StartedTestContainer
let pool: pg.Pool
const T0 = Date.UTC(2026, 6, 1, 12, 0, 0)
const at = (min: number) => new Date(T0 + min * 60_000)

beforeAll(async () => {
  container = await new GenericContainer(IMAGE)
    .withEnvironment({ POSTGRES_PASSWORD: 'test', POSTGRES_DB: 'health' })
    .withExposedPorts(5432)
    .withWaitStrategy(Wait.forLogMessage(/database system is ready to accept connections/, 2))
    .withStartupTimeout(240_000)
    .start()
  const url = `postgresql://postgres:test@${container.getHost()}:${container.getMappedPort(5432)}/health`
  await migrate(url)
  pool = new pg.Pool({ connectionString: url })
  const insert = `INSERT INTO positions (device_id, fix_time, lat, lon, fix_valid, rec_hash, attrs) VALUES ($1,$2,54.7,25.3,true,$3,$4::jsonb)`
  let hash = 1n
  const seed = (d: number, m: number, attrs: Record<string, unknown>) => pool.query(insert, [d, at(m), (hash++).toString(), JSON.stringify(attrs)])

  await seed(7, 0, { 'GSM Signal': 4, 'External Voltage': 12400, 'Battery Voltage': 4100 }) // dictionary-name keys
  await seed(7, 1, { io_21: 3, io_66: 12100, io_67: 4050 }) // io_<id> fallback keys
  await seed(7, 2, { 'GSM Signal': 5 }) // GSM only
  await seed(7, 3, { 'GSM Signal': 'x', 'External Voltage': 'NaN' }) // garbage → skipped
  await seed(7, 4, { odometer: 1000 }) // no health keys → not selected
  await seed(8, 0, { 'GSM Signal': 2 }) // another device — must not leak
}, 240_000)

afterAll(async () => { await pool?.end(); await container?.stop() })

describe('V1-nice readHealthSeries', () => {
  it('reads GSM + voltages (mV→V ×0.001) from name OR io_<id> keys, chronological', async () => {
    const rows = await readHealthSeries(pool, 7n)
    expect(rows.map((r) => [r.gsm, r.extV, r.battV])).toEqual([
      [4, 12.4, 4.1],   // dictionary-name keys, mV scaled to V
      [3, 12.1, 4.05],  // io_<id> fallback keys
      [5, null, null],  // GSM only
      // garbage row skipped; no-health row not selected
    ])
  })

  it('scopes strictly by device id', async () => {
    const rows = await readHealthSeries(pool, 8n)
    expect(rows).toHaveLength(1)
    expect(rows[0]!.gsm).toBe(2)
  })

  it('from/to bounds; empty device → []', async () => {
    const bounded = await readHealthSeries(pool, 7n, { from: at(1).toISOString(), to: at(2).toISOString() })
    expect(bounded.map((r) => r.gsm)).toEqual([3, 5])
    expect(await readHealthSeries(pool, 999n)).toEqual([])
  })
})
