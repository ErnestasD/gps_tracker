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
  await seed(9, 0, { 'GSM level': 4, 'External Power Voltage': 12400 }) // fm36's spellings
  await seed(9, 1, { 'GSM signal': 3 }) // atc700's spelling
  await seed(10, 0, { 'External Voltage': 126 }) // FMB930: its own factor, see extVoltageScale
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

  it('reads EVERY spelling of an id whose meaning is constant across tables', async () => {
    // The attrs key is the device's OWN table's name now. id 21 is "GSM Signal" on 32 tables,
    // "GSM signal" on atc700 and "GSM level" on fm36; id 66 is "External Voltage" on 21 and
    // "External Power Voltage" on fm36. One spelling sufficed only while every device decoded as
    // FMB120 — without the union, an FM36 or ATC700 health chart is blank with no error.
    expect((await readHealthSeries(pool, 9n)).map((r) => [r.gsm, r.extV])).toEqual([[4, 12.4], [3, null]])
  })

  it('scales AVL 66 by the MODEL — FMB930 reports it on a different factor', async () => {
    // The wiki says so itself: "FMB930 shows external voltage 10 times lower than it actually is.
    // Multiply the value by 10 at the backend." Effective factor 0.01 × 10 = 0.1. Applying the
    // usual 0.001 renders a 12.6 V vehicle battery as 0.126 V.
    expect((await readHealthSeries(pool, 10n, { avlTable: 'fmb930' }))[0]?.extV).toBeCloseTo(12.6)
    expect((await readHealthSeries(pool, 10n))[0]?.extV).toBeCloseTo(0.126) // unattributed → majority factor
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
