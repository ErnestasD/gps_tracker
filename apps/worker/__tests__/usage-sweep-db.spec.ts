import { execFileSync } from 'node:child_process'
import { resolve } from 'node:path'
import type { Pool } from 'pg'
import { GenericContainer, Wait, type StartedTestContainer } from 'testcontainers'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { createPool } from '@orbetra/db'

import { runUsageSweep } from '../src/jobs/usageWorker.js'

/**
 * E07-4 — the sweep against the REAL schema (positions hypertable + devices + usage_daily).
 * Billing-correctness properties: every UTC day with ≥1 position gets exactly ONE row
 * (incl. the midnight-crossing trip the last-fix design lost — review HIGH), re-sweeps are
 * no-ops, invalid fixes still count (presence §3.4), and a wider lookback backfills.
 */
const IMAGE = 'timescale/timescaledb-ha:pg16'
const DB_PKG = resolve(import.meta.dirname, '../../../packages/db')
let container: StartedTestContainer
let pool: Pool
const TEN = '11111111-1111-1111-1111-111111111111'
const ACC = '22222222-2222-2222-2222-222222222222'
const NOW = Date.parse('2026-07-10T10:00:00Z')
const H = 3_600_000

async function seedDevice(id: number, retired = false): Promise<void> {
  await pool.query(
    `INSERT INTO devices (id,"tenantId","accountId","profileId",imei,name,"retiredAt")
     VALUES ($1,$2,$3,(SELECT id FROM device_profiles LIMIT 1),$4,$5,$6)`,
    [id, TEN, ACC, String(356307042440000 + id), `dev-${id}`, retired ? new Date(NOW) : null],
  )
}
async function seedPosition(deviceId: number, iso: string, fixValid = true): Promise<void> {
  await pool.query(`INSERT INTO positions (device_id, fix_time, lat, lon, fix_valid, satellites, rec_hash) VALUES ($1,$2,54.7,25.3,$3,$4,$5)`, [
    deviceId,
    iso,
    fixValid,
    fixValid ? 9 : 0,
    BigInt(Date.parse(iso)), // unique-enough hash per row
  ])
}

beforeAll(async () => {
  container = await new GenericContainer(IMAGE)
    .withEnvironment({ POSTGRES_PASSWORD: 'test', POSTGRES_DB: 'orbetra' })
    .withExposedPorts(5432)
    .withWaitStrategy(Wait.forLogMessage(/database system is ready to accept connections/, 2))
    .withStartupTimeout(240_000)
    .start()
  const url = `postgresql://postgres:test@${container.getHost()}:${container.getMappedPort(5432)}/orbetra`
  execFileSync('pnpm', ['exec', 'prisma', 'migrate', 'deploy'], { cwd: DB_PKG, env: { ...process.env, DATABASE_URL: url }, encoding: 'utf8' })
  // positions hypertable lives in the numbered-SQL layer, not Prisma
  execFileSync('pnpm', ['exec', 'tsx', 'sql/migrate.ts'], { cwd: DB_PKG, env: { ...process.env, DATABASE_URL: url }, encoding: 'utf8' })
  pool = createPool(url)
  await pool.query(`INSERT INTO tenants (id,name) VALUES ($1,'T1')`, [TEN])
  await pool.query(`INSERT INTO accounts (id,"tenantId",name) VALUES ($1,$2,'A1')`, [ACC, TEN])
  await pool.query(`INSERT INTO device_profiles (id,key,name) VALUES (gen_random_uuid(),'fmb1xx','FMB1xx')`)
}, 300_000)

afterAll(async () => {
  await pool?.end()
  await container?.stop()
})

describe('E07-4 runUsageSweep (positions → usage_daily)', () => {
  it('a trip CROSSING UTC MIDNIGHT bills BOTH days (the case a last-fix sweep loses)', async () => {
    await seedDevice(42)
    await seedPosition(42, '2026-07-09T23:30:00Z') // day D, 23:30
    await seedPosition(42, '2026-07-10T00:15:00Z') // day D+1 — overwrote "last fix" in the old design
    const n = await runUsageSweep(pool, NOW)
    expect(n).toBe(2)
    const days = (await pool.query(`SELECT day::text AS day FROM usage_daily WHERE "deviceId"=42 ORDER BY day`)).rows as { day: string }[]
    expect(days.map((r) => r.day)).toEqual(['2026-07-09', '2026-07-10'])
  })

  it('a re-sweep is a NO-OP (never double-counts a billed day)', async () => {
    expect(await runUsageSweep(pool, NOW)).toBe(0)
    expect(await runUsageSweep(pool, NOW + H)).toBe(0)
  })

  it('an INVALID fix still counts (presence semantics §3.4 — the device reported)', async () => {
    await seedDevice(43)
    await seedPosition(43, '2026-07-10T08:00:00Z', false) // satellites=0, fix_valid=false
    expect(await runUsageSweep(pool, NOW)).toBe(1)
    const rows = (await pool.query(`SELECT day::text AS day FROM usage_daily WHERE "deviceId"=43`)).rows
    expect(rows).toHaveLength(1)
  })

  it('positions for a device with NO devices row are skipped (JOIN drops — never a guessed scope)', async () => {
    await seedPosition(999, '2026-07-10T09:00:00Z')
    expect(await runUsageSweep(pool, NOW)).toBe(0)
  })

  it('a RETIRED device still bills the day it actually reported', async () => {
    await seedDevice(44, true)
    await seedPosition(44, '2026-07-10T07:00:00Z')
    expect(await runUsageSweep(pool, NOW)).toBe(1)
  })

  it('outside the lookback → skipped; a WIDER lookback backfills it (month-close reconciliation)', async () => {
    await seedDevice(45)
    await seedPosition(45, '2026-07-05T12:00:00Z') // 5 days old
    expect(await runUsageSweep(pool, NOW)).toBe(0) // default 48h misses it
    expect(await runUsageSweep(pool, NOW, 7 * 24 * H)).toBe(1) // 7d lookback backfills
    const rows = (await pool.query(`SELECT day::text AS day, "tenantId" FROM usage_daily WHERE "deviceId"=45`)).rows as { day: string; tenantId: string }[]
    expect(rows[0]).toMatchObject({ day: '2026-07-05', tenantId: TEN })
  })
})
