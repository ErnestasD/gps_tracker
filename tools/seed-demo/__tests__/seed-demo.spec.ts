import { execFileSync } from 'node:child_process'
import { resolve } from 'node:path'

import { Redis } from 'ioredis'
import { GenericContainer, Wait, type StartedTestContainer } from 'testcontainers'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { createDb, type Db } from '@orbetra/db'
import { createIngestServer, DEFAULT_CONFIG, type IngestServer } from '@orbetra/ingest'

import { seedDemo } from '../src/main.js'
import { DEMO_DEVICES } from '../src/plan.js'

/**
 * E08-5 integration: seed-demo against real pg + redis + an in-process ingest server.
 * Proves the whole provisioning path (tenant/accounts/users/devices/geofence/rules through
 * the scoped repos, registry sync via activateDevice) AND that the history drives flow
 * through the real ingest transport (records ACKed into the raw streams). The worker half
 * of the pipeline is covered by its own suites — here the stream depth is the receipt.
 */
const PG_IMAGE = 'timescale/timescaledb-ha:pg16'
const DB_PKG = resolve(import.meta.dirname, '../../../packages/db')

let pg: StartedTestContainer
let redisC: StartedTestContainer
let redis: Redis
let db: Db
let ingest: IngestServer
let ingestPort: number
let databaseUrl: string

beforeAll(async () => {
  ;[pg, redisC] = await Promise.all([
    new GenericContainer(PG_IMAGE).withEnvironment({ POSTGRES_PASSWORD: 'test', POSTGRES_DB: 'demo' }).withExposedPorts(5432).withWaitStrategy(Wait.forLogMessage(/database system is ready to accept connections/, 2)).withStartupTimeout(240_000).start(),
    new GenericContainer('redis:7-alpine').withExposedPorts(6379).withWaitStrategy(Wait.forLogMessage(/Ready to accept connections/)).start(),
  ])
  databaseUrl = `postgresql://postgres:test@${pg.getHost()}:${pg.getMappedPort(5432)}/demo`
  execFileSync('pnpm', ['exec', 'prisma', 'migrate', 'deploy'], { cwd: DB_PKG, env: { ...process.env, DATABASE_URL: databaseUrl } })
  redis = new Redis(redisC.getMappedPort(6379), redisC.getHost(), { maxRetriesPerRequest: null })
  db = createDb(databaseUrl)
  ingest = createIngestServer(redis, DEFAULT_CONFIG)
  ingestPort = await new Promise<number>((r) => ingest.server.listen(0, '127.0.0.1', () => r((ingest.server.address() as { port: number }).port)))
}, 300_000)

afterAll(async () => {
  await new Promise<void>((r) => ingest.server.close(() => r()))
  await db?.$disconnect()
  await redis?.quit()
  await Promise.all([pg?.stop(), redisC?.stop()])
})

describe('E08-5 seedDemo (integration)', () => {
  it('provisions the demo tenant end-to-end and drives history through real ingest', async () => {
    const redisUrl = `redis://${redisC.getHost()}:${redisC.getMappedPort(6379)}`
    const r = await seedDemo({ databaseUrl, redisUrl, ingestHost: '127.0.0.1', ingestPort, password: 'demo-test-password', log: () => undefined })

    expect(r.devices).toEqual({ created: DEMO_DEVICES, existing: 0, imeiConflicts: 0 })
    expect(r.drives.rejected).toBe(0)
    expect(r.drives.acked).toBeGreaterThan(DEMO_DEVICES * 6 * 100) // ~120 records × 6 drives × 12 devices

    const scope = { tenantId: r.tenantId }
    expect((await db.accounts.list(scope)).map((a) => a.name).sort()).toEqual(['Kaunas Fleet', 'Vilnius Fleet'])
    const users = await db.users.list(scope)
    expect(users.map((u) => u.email).sort()).toEqual(['demo-admin@orbetra.test', 'demo-manager@orbetra.test', 'demo-viewer@orbetra.test'])
    expect((await db.devices.list(scope))).toHaveLength(DEMO_DEVICES)
    const fences = (await db.geofences.list(scope)).map((g) => g.name).sort()
    expect(fences).toEqual(['Vilnius Depot', 'Vilnius–Kaunas corridor'])
    expect((await db.rules.list(scope)).map((x) => x.name).sort()).toEqual(['Demo corridor exit', 'Demo fuel theft', 'Demo overspeed 60', 'Demo panic'])
    // V2 enrichment: drivers (iButton), a maintenance reminder, a scheduled report
    expect((await db.drivers.list(scope)).map((d) => d.name).sort()).toEqual(['Andrius Kazlauskas', 'Jonas Petrauskas'])
    expect((await db.maintenance.list(scope)).some((m) => m.title === 'Oil change')).toBe(true)
    expect((await db.scheduledReports.list(scope)).some((s) => s.reportType === 'trips')).toBe(true)
    // driver iButton map is populated so the worker can auto-resolve AVL 78 taps
    const acc0 = (await db.accounts.list(scope)).find((a) => a.name === 'Vilnius Fleet')!
    expect(Object.keys(await redis.hgetall(`driver:ibutton:${r.tenantId}:${acc0.id}`))).toHaveLength(1)

    // registry sync: ingest accepted the fleet (records durably in the raw shards)
    let streamed = 0
    for (let s = 0; s < 16; s++) streamed += await redis.xlen(`raw:${s}`)
    expect(streamed).toBe(r.drives.acked) // acked == persisted to stream (rule 4)
  }, 240_000)

  it('is idempotent: a re-run creates no rows AND sends no duplicate history', async () => {
    const redisUrl = `redis://${redisC.getHost()}:${redisC.getMappedPort(6379)}`
    let before = 0
    for (let s = 0; s < 16; s++) before += await redis.xlen(`raw:${s}`)
    const r = await seedDemo({ databaseUrl, redisUrl, ingestHost: '127.0.0.1', ingestPort, password: 'demo-test-password-2', log: () => undefined })
    expect(r.devices).toEqual({ created: 0, existing: DEMO_DEVICES, imeiConflicts: 0 })
    expect(r.drives.total).toBe(0) // history SKIPPED — no duplicate trails (review MED-3)
    let after = 0
    for (let s = 0; s < 16; s++) after += await redis.xlen(`raw:${s}`)
    expect(after).toBe(before) // stream depth unchanged
    const scope = { tenantId: r.tenantId }
    expect((await db.devices.list(scope))).toHaveLength(DEMO_DEVICES) // no duplicates
    expect(await db.users.list(scope)).toHaveLength(3)
    expect((await db.rules.list(scope))).toHaveLength(4)
    expect((await db.drivers.list(scope))).toHaveLength(2) // no duplicate drivers on re-run
    expect((await db.maintenance.list(scope)).filter((m) => m.title === 'Oil change')).toHaveLength(1) // no dup
    expect((await db.scheduledReports.list(scope)).filter((s) => s.reportType === 'trips')).toHaveLength(1) // no dup
    // the worker caches got synced: rules + geofences present in Redis for the tenant
    expect(Object.keys(await redis.hgetall(`rule:tenant:${r.tenantId}`))).toHaveLength(4)
    expect(Object.keys(await redis.hgetall(`geofence:tenant:${r.tenantId}`))).toHaveLength(2)
  }, 240_000)
})
