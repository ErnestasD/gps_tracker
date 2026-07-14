import pg from 'pg'
import { GenericContainer, Wait, type StartedTestContainer } from 'testcontainers'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { readCanLatest } from '../src/can.js'
import { migrate } from '../sql/migrate.js'

/**
 * V2 CAN/OBD snapshot reader over real positions rows. Proves the newest CAN-bearing row wins,
 * the CAN id is preferred over the OBD id over the dictionary name (collision coalesce), the
 * mileage multiplier (m → km), junk values coerce to null, and a non-CAN device returns null.
 */
const IMAGE = 'timescale/timescaledb-ha:pg16'
let container: StartedTestContainer
let pool: pg.Pool

const T0 = Date.UTC(2026, 6, 1, 12, 0, 0)
const at = (min: number) => new Date(T0 + min * 60_000)

beforeAll(async () => {
  container = await new GenericContainer(IMAGE)
    .withEnvironment({ POSTGRES_PASSWORD: 'test', POSTGRES_DB: 'can' })
    .withExposedPorts(5432)
    .withWaitStrategy(Wait.forLogMessage(/database system is ready to accept connections/, 2))
    .withStartupTimeout(240_000)
    .start()
  const url = `postgresql://postgres:test@${container.getHost()}:${container.getMappedPort(5432)}/can`
  await migrate(url)
  pool = new pg.Pool({ connectionString: url })

  const insert = `INSERT INTO positions (device_id, fix_time, lat, lon, fix_valid, rec_hash, attrs)
    VALUES ($1, $2, 54.7, 25.3, true, $3, $4::jsonb)`
  let hash = 1n
  const seed = (deviceId: number, minute: number, attrs: Record<string, unknown>) =>
    pool.query(insert, [deviceId, at(minute), (hash++).toString(), JSON.stringify(attrs)])

  // device 7: an older full CAN row, then a newer partial one (the newest CAN-bearing row wins)
  await seed(7, 0, { io_85: 900, io_32: 88, io_114: 40, io_41: 15, io_81: 0, io_87: 123_456 })
  await seed(7, 1, { io_85: 1500, io_32: 90, io_87: 123_500 }) // newest with CAN
  await seed(7, 2, { 'GSM Signal': 4 }) // no CAN → must NOT become the "latest CAN"
  // device 8: OBD-id + name fallbacks + garbage
  await seed(8, 0, { io_36: 800, 'Engine RPM': 999, 'Coolant Temperature': 70, 'Engine Load': 'junk' })
  // device 9: no CAN params at all
  await seed(9, 0, { 'GSM Signal': 3, io_67: 12_000 })
}, 240_000)

afterAll(async () => {
  await pool?.end()
  await container?.stop()
})

describe('V2 readCanLatest', () => {
  it('returns the newest CAN-bearing row, ignoring a later non-CAN row', async () => {
    const c = await readCanLatest(pool, 7n)
    expect(c).not.toBeNull()
    expect(c).toMatchObject({ rpm: 1500, coolantC: 90, totalMileageKm: 123.5 }) // 123500 m → 123.5 km
    // params absent from the newest row are null (not carried from the older full row)
    expect(c?.engineLoadPct).toBeNull()
    expect(c?.throttlePct).toBeNull()
  })

  it('coalesces CAN id → OBD id → dictionary name, and junk coerces to null', async () => {
    const c = await readCanLatest(pool, 8n)
    expect(c?.rpm).toBe(800) // io_36 (OBD) wins over the name "Engine RPM" (999)
    expect(c?.coolantC).toBe(70) // via the dictionary name
    expect(c?.engineLoadPct).toBeNull() // 'junk' → null, never a 500
  })

  it('returns null for a non-CAN vehicle', async () => {
    expect(await readCanLatest(pool, 9n)).toBeNull()
  })
})
