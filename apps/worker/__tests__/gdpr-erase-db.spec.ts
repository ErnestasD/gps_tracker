import pg from 'pg'
import { GenericContainer, Wait, type StartedTestContainer } from 'testcontainers'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import type { Redis } from 'ioredis'

import { migrate } from '../../../packages/db/sql/migrate.js'
import { runErase } from '../src/jobs/gdprEraseWorker.js'

/**
 * E08-4 device-erase cascade against a real timescale instance: positions (windowed raw-SQL
 * loop across >30 d of history), trips/events/commands, Redis leftovers, device row LAST.
 * usage_daily is deliberately kept (billing). Idempotency: a re-run finds nothing and
 * still succeeds (crash-retry safety).
 */
const IMAGE = 'timescale/timescaledb-ha:pg16'
const T1 = '00000000-0000-0000-0000-0000000000a1'
const T2 = '00000000-0000-0000-0000-0000000000a2'

let container: StartedTestContainer
let pool: pg.Pool

function fakeRedis() {
  const ops: string[] = []
  return {
    ops,
    redis: {
      del: vi.fn((...keys: string[]) => { ops.push(`del ${keys.length}`); return Promise.resolve(keys.length) }),
      srem: vi.fn((_k: string, m: string) => { ops.push(`srem ${m}`); return Promise.resolve(1) }),
      hdel: vi.fn((k: string, f: string) => { ops.push(`hdel ${k} ${f}`); return Promise.resolve(1) }),
    } as unknown as Redis,
  }
}

const DAY_MS = 24 * 3_600_000
const T0 = Date.UTC(2026, 3, 1)

beforeAll(async () => {
  container = await new GenericContainer(IMAGE)
    .withEnvironment({ POSTGRES_PASSWORD: 'test', POSTGRES_DB: 'erase' })
    .withExposedPorts(5432)
    .withWaitStrategy(Wait.forLogMessage(/database system is ready to accept connections/, 2))
    .withStartupTimeout(240_000)
    .start()
  const url = `postgresql://postgres:test@${container.getHost()}:${container.getMappedPort(5432)}/erase`
  await migrate(url) // positions hypertable
  pool = new pg.Pool({ connectionString: url })
  // minimal relational tables the cascade touches (shape-compatible subsets)
  await pool.query(`CREATE TABLE devices (id bigint PRIMARY KEY, "tenantId" uuid, "accountId" uuid, imei text, name text, "retiredAt" timestamptz)`)
  await pool.query(`CREATE TABLE trips (id bigserial PRIMARY KEY, "deviceId" bigint, "tenantId" uuid)`)
  await pool.query(`CREATE TABLE events (id bigserial PRIMARY KEY, "deviceId" bigint, "tenantId" uuid)`)
  await pool.query(`CREATE TABLE commands (id uuid DEFAULT gen_random_uuid() PRIMARY KEY, "deviceId" bigint, "tenantId" uuid)`)
  await pool.query(`CREATE TABLE usage_daily ("deviceId" bigint, day date, PRIMARY KEY ("deviceId", day))`)

  await pool.query(`INSERT INTO devices VALUES (7, $1, $1, '356307042440030', 'Erase me', now()), (8, $1, $1, '356307042440031', 'Keep me', NULL), (9, $2, $2, '356307042440032', 'Other tenant', now())`, [T1, T2])
  // 90 days of positions for device 7 (3 erase windows) + a few for device 8
  let hash = 1n
  for (let day = 0; day < 90; day += 5) {
    await pool.query(`INSERT INTO positions (device_id, fix_time, lat, lon, fix_valid, rec_hash) VALUES (7, $1, 54.7, 25.3, true, $2)`, [new Date(T0 + day * DAY_MS), (hash++).toString()])
  }
  await pool.query(`INSERT INTO positions (device_id, fix_time, lat, lon, fix_valid, rec_hash) VALUES (8, $1, 54.7, 25.3, true, $2)`, [new Date(T0), (hash++).toString()])
  await pool.query(`INSERT INTO trips ("deviceId","tenantId") VALUES (7,$1),(7,$1),(8,$1)`, [T1])
  await pool.query(`INSERT INTO events ("deviceId","tenantId") VALUES (7,$1),(8,$1)`, [T1])
  await pool.query(`INSERT INTO commands ("deviceId","tenantId") VALUES (7,$1),(8,$1)`, [T1])
  await pool.query(`INSERT INTO usage_daily VALUES (7, '2026-04-01'), (8, '2026-04-01')`)
}, 240_000)

afterAll(async () => {
  await pool?.end()
  await container?.stop()
})

const count = async (sql: string, dev: number): Promise<number> => Number((await pool.query<{ n: string }>(sql, [dev])).rows[0]!.n)

describe('E08-4 runErase (cascade, real pg)', () => {
  it('refuses a live device and a tenant mismatch (scope re-checked from the DB row)', async () => {
    const { redis } = fakeRedis()
    await expect(runErase(pool, redis, { deviceId: '8', tenantId: T1 })).rejects.toThrow(/retired/)
    await expect(runErase(pool, redis, { deviceId: '9', tenantId: T1 })).rejects.toThrow(/tenant mismatch/)
  })

  it('erases positions (windowed), trips, events, commands, redis state, then the device row', async () => {
    const { redis, ops } = fakeRedis()
    const r = await runErase(pool, redis, { deviceId: '7', tenantId: T1 })
    expect(r.positions).toBe(18) // 90/5 seeded rows, spanning 3 windows
    expect(await count(`SELECT count(*) n FROM positions WHERE device_id=$1`, 7)).toBe(0)
    expect(await count(`SELECT count(*) n FROM trips WHERE "deviceId"=$1`, 7)).toBe(0)
    expect(await count(`SELECT count(*) n FROM events WHERE "deviceId"=$1`, 7)).toBe(0)
    expect(await count(`SELECT count(*) n FROM commands WHERE "deviceId"=$1`, 7)).toBe(0)
    expect(await count(`SELECT count(*) n FROM devices WHERE id=$1`, 7)).toBe(0)
    // usage_daily is billing data — deliberately KEPT
    expect(await count(`SELECT count(*) n FROM usage_daily WHERE "deviceId"=$1`, 7)).toBe(1)
    expect(ops.some((o) => o.startsWith('del'))).toBe(true)
    expect(ops).toContain('srem 7')
    // the OTHER device is untouched
    expect(await count(`SELECT count(*) n FROM positions WHERE device_id=$1`, 8)).toBe(1)
    expect(await count(`SELECT count(*) n FROM trips WHERE "deviceId"=$1`, 8)).toBe(1)
  })

  it('is idempotent: a retried job on a fully-erased device succeeds with 0 rows', async () => {
    const { redis } = fakeRedis()
    const r = await runErase(pool, redis, { deviceId: '7', tenantId: T1 })
    expect(r.positions).toBe(0)
  })
})
