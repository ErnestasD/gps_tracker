import { execFileSync } from 'node:child_process'
import { resolve } from 'node:path'
import { Redis } from 'ioredis'
import type { Pool } from 'pg'
import { GenericContainer, Wait, type StartedTestContainer } from 'testcontainers'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { createPool } from '@orbetra/db'

import { createRecomputeQueue, enqueueRecompute, redisConnection } from '../src/jobs/queue.js'
import { resolveTripScope, startRecomputeWorker } from '../src/jobs/recomputeWorker.js'

const IMAGE = 'timescale/timescaledb-ha:pg16'
const DB_PKG = resolve(import.meta.dirname, '../../../packages/db')

let pg: StartedTestContainer
let redisC: StartedTestContainer
let pool: Pool
let redis: Redis
let redisUrl: string

const DEV = 356_307_042_440_200n
const REG_TEN = '33333333-3333-3333-3333-333333333333'
const REG_ACC = '44444444-4444-4444-4444-444444444444'
const OLD_TEN = '55555555-5555-5555-5555-555555555555'
const OLD_ACC = '66666666-6666-6666-6666-666666666666'
const T0 = new Date('2026-07-02T09:00:00Z')
const at = (sec: number) => new Date(T0.getTime() + sec * 1000)

beforeAll(async () => {
  ;[pg, redisC] = await Promise.all([
    new GenericContainer(IMAGE)
      .withEnvironment({ POSTGRES_PASSWORD: 'test', POSTGRES_DB: 'orbetra' })
      .withExposedPorts(5432)
      .withWaitStrategy(Wait.forLogMessage(/database system is ready to accept connections/, 2))
      .withStartupTimeout(240_000)
      .start(),
    new GenericContainer('redis:7-alpine').withExposedPorts(6379).withWaitStrategy(Wait.forLogMessage(/Ready to accept connections/)).start(),
  ])
  const url = `postgresql://postgres:test@${pg.getHost()}:${pg.getMappedPort(5432)}/orbetra`
  execFileSync('pnpm', ['exec', 'prisma', 'migrate', 'deploy'], { cwd: DB_PKG, env: { ...process.env, DATABASE_URL: url }, encoding: 'utf8' })
  execFileSync('pnpm', ['exec', 'tsx', 'sql/migrate.ts'], { cwd: DB_PKG, env: { ...process.env, DATABASE_URL: url }, encoding: 'utf8' })
  pool = createPool(url)
  redisUrl = `redis://${redisC.getHost()}:${redisC.getMappedPort(6379)}`
  redis = new Redis(redisUrl, { maxRetriesPerRequest: null })
}, 300_000)

afterAll(async () => {
  await pool?.end()
  await redis?.quit()
  await Promise.all([pg?.stop(), redisC?.stop()])
})

let h = 0
async function insertDrive(): Promise<void> {
  const pts: [number, number, number, boolean, bigint][] = [] // sec, lat, speed, ign, odo
  for (let i = 0; i < 12; i++) pts.push([i * 10, 54.0 + i * 0.0002, 8, true, 100_000n + BigInt(i) * 100n])
  pts.push([130, 54.0022, 0, false, 101_100n])
  pts.push([320, 54.0022, 0, false, 101_100n])
  for (const [sec, lat, speed, ign, odo] of pts) {
    await pool.query(
      `INSERT INTO positions (device_id, fix_time, server_time, lat, lon, speed, fix_valid, ignition, movement, odometer_m, rec_hash)
       VALUES ($1,$2,$2,$3,25.0,$4,true,$5,$5,$6,$7)`,
      [DEV.toString(), at(sec), lat, speed, ign, odo.toString(), ++h],
    )
  }
}

describe('E04-2 resolveTripScope', () => {
  it('prefers an existing trip’s scope; falls back to the registry; else null', async () => {
    await redis.hset('device:tenant', DEV.toString(), REG_TEN)
    await redis.hset('device:account', DEV.toString(), REG_ACC)
    // no trip yet → registry
    expect(await resolveTripScope(pool, redis, DEV.toString())).toEqual({ tenantId: REG_TEN, accountId: REG_ACC })
    // an existing trip wins over the registry (historical trips keep their tenant)
    await pool.query(`INSERT INTO trips ("tenantId","accountId","deviceId","status","startTime") VALUES ($1,$2,$3,'closed',$4)`, [OLD_TEN, OLD_ACC, DEV.toString(), at(0)])
    expect(await resolveTripScope(pool, redis, DEV.toString())).toEqual({ tenantId: OLD_TEN, accountId: OLD_ACC })
    // unknown device, no trip → null
    expect(await resolveTripScope(pool, redis, '999')).toBeNull()
    await pool.query('DELETE FROM trips WHERE "deviceId"=$1', [DEV.toString()])
  })
})

describe('E04-2 recompute BullMQ worker (end-to-end)', () => {
  it('processes an enqueued job → the drive materializes as a trip row', async () => {
    await pool.query('DELETE FROM trips')
    await pool.query('DELETE FROM positions')
    await insertDrive()
    await redis.hset('device:tenant', DEV.toString(), REG_TEN)
    await redis.hset('device:account', DEV.toString(), REG_ACC)

    const conn = redisConnection(redisUrl)
    const queue = createRecomputeQueue(conn)
    const done = new Promise<{ deleted: number; created: number }>((res) => {
      const worker = startRecomputeWorker({
        connection: conn,
        pool,
        redis,
        onDone: (r) => {
          void worker.close()
          res(r)
        },
      })
    })

    await enqueueRecompute(queue, DEV, at(-10), at(400))
    const result = await done
    expect(result.created).toBe(1)

    const trips = await pool.query('SELECT status, "tenantId", "distanceM" FROM trips WHERE "deviceId"=$1', [DEV.toString()])
    expect(trips.rowCount).toBe(1)
    const row = trips.rows[0] as { status: string; tenantId: string; distanceM: number }
    expect(row.status).toBe('closed')
    expect(row.tenantId).toBe(REG_TEN) // scoped from the registry (first computation)
    expect(row.distanceM).toBeGreaterThan(0)
    await queue.close()
  }, 30_000)

  it('(H2) recompute honours the device:config odometerSource — gps forces haversine', async () => {
    await pool.query('DELETE FROM trips')
    await pool.query('DELETE FROM positions')
    await insertDrive() // monotonic odometer present → 'auto' would use it
    await redis.hset('device:tenant', DEV.toString(), REG_TEN)
    await redis.hset('device:account', DEV.toString(), REG_ACC)
    await redis.hset('device:config', DEV.toString(), JSON.stringify({ presenceRules: {}, odometerSource: 'gps' }))

    const conn = redisConnection(redisUrl)
    const queue = createRecomputeQueue(conn)
    const done = new Promise<void>((res) => {
      const worker = startRecomputeWorker({ connection: conn, pool, redis, onDone: () => { void worker.close(); res() } })
    })
    await enqueueRecompute(queue, DEV, at(-10), at(400))
    await done

    const trip = (await pool.query('SELECT "distanceSource" FROM trips WHERE "deviceId"=$1', [DEV.toString()])).rows[0] as { distanceSource: string }
    expect(trip.distanceSource).toBe('gps') // config respected: NOT 'odometer' despite a clean odometer
    await queue.close()
  }, 30_000)
})
