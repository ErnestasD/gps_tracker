import { execFileSync } from 'node:child_process'
import { resolve } from 'node:path'
import pg from 'pg'
import { GenericContainer, Wait, type StartedTestContainer } from 'testcontainers'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { createDb, type Db } from '../src/index.js'

/**
 * The Stripe overage REPORT LOG (audit MED #21) — the row that lets the reporter submit a delta.
 *
 * Against a real database because everything that matters here is schema: the composite primary key
 * that makes the write idempotent per tenant-day, the DATE column the day string round-trips through,
 * and the cascade that stops a deleted tenant's log from outliving it.
 */
const IMAGE = 'timescale/timescaledb-ha:pg16'
const PKG_DIR = resolve(import.meta.dirname, '..')
const actor = { userId: '00000000-0000-0000-0000-0000000000aa' }

let container: StartedTestContainer
let db: Db
let url: string
let tenantId: string

beforeAll(async () => {
  container = await new GenericContainer(IMAGE)
    .withEnvironment({ POSTGRES_PASSWORD: 'test', POSTGRES_DB: 'orbetra' })
    .withExposedPorts(5432)
    .withWaitStrategy(Wait.forLogMessage(/database system is ready to accept connections/, 2))
    .withStartupTimeout(240_000)
    .start()
  url = `postgresql://postgres:test@${container.getHost()}:${container.getMappedPort(5432)}/orbetra`
  execFileSync('pnpm', ['exec', 'prisma', 'migrate', 'deploy'], { cwd: PKG_DIR, env: { ...process.env, DATABASE_URL: url }, encoding: 'utf8' })
  db = createDb(url)
  tenantId = (await db.tenants.create(actor, { name: 'MeterCo' })).id
}, 300_000)

afterAll(async () => {
  await db?.$disconnect()
  await container?.stop()
})

describe('usage report log', () => {
  it('records the CUMULATIVE reported value per day and reads it back by day string', async () => {
    await db.usage.recordOverageReport(tenantId, '2026-07-11', { reported: 5, included: 200 })
    await db.usage.recordOverageReport(tenantId, '2026-07-12', { reported: 3, included: 200 })
    const got = await db.usage.reportedOverage(tenantId, { from: '2026-07-11', to: '2026-07-12' })
    expect([...got.entries()].sort()).toEqual([
      ['2026-07-11', { reported: 5, included: 200 }],
      ['2026-07-12', { reported: 3, included: 200 }],
    ])
  })

  it('a second write for the same day OVERWRITES rather than erroring or duplicating', async () => {
    // the reporter re-walks a trailing window, so it writes the same tenant-day repeatedly; anything
    // other than an upsert would make the second run of every day throw
    await db.usage.recordOverageReport(tenantId, '2026-07-11', { reported: 9, included: 200 })
    expect((await db.usage.reportedOverage(tenantId, { from: '2026-07-11', to: '2026-07-11' })).get('2026-07-11')).toEqual({ reported: 9, included: 200 })
  })

  it('keeps the ALLOWANCE the day was billed against, so a later downgrade cannot re-bill it', async () => {
    // the reporter re-walks past days; recomputing them against a smaller allowance would charge
    // hundreds of device-days the customer's plan actually covered at the time
    await db.usage.recordOverageReport(tenantId, '2026-07-13', { reported: 4, included: 750 })
    expect((await db.usage.reportedOverage(tenantId, { from: '2026-07-13', to: '2026-07-13' })).get('2026-07-13')).toEqual({ reported: 4, included: 750 })
  })

  it('reads are bounded by the window — an old day outside it is not returned', async () => {
    await db.usage.recordOverageReport(tenantId, '2026-01-02', { reported: 42, included: 200 })
    const got = await db.usage.reportedOverage(tenantId, { from: '2026-07-11', to: '2026-07-12' })
    expect(got.has('2026-01-02')).toBe(false)
  })

  it('another tenant’s log is never visible — the reporter must not read across tenants', async () => {
    const other = (await db.tenants.create(actor, { name: 'OtherCo' })).id
    await db.usage.recordOverageReport(other, '2026-07-11', { reported: 77, included: 200 })
    expect((await db.usage.reportedOverage(tenantId, { from: '2026-07-11', to: '2026-07-11' })).get('2026-07-11')?.reported).toBe(9)
    expect((await db.usage.reportedOverage(other, { from: '2026-07-11', to: '2026-07-11' })).get('2026-07-11')?.reported).toBe(77)
  })

  it('a malformed day THROWS instead of reaching Postgres as an Invalid Date', async () => {
    // this runs in a background job with no request behind it; an unmappable Prisma error there is a
    // stack trace in a log nobody reads, so the guard names the bad value
    await expect(db.usage.recordOverageReport(tenantId, 'not-a-day', { reported: 1, included: 200 })).rejects.toThrow(/unusable day/)
    await expect(db.usage.recordOverageReport(tenantId, '2026-13-45', { reported: 1, included: 200 })).rejects.toThrow(/unusable day/)
  })

  it('the log dies with its tenant (FK cascade) — no orphan billing rows', async () => {
    const doomed = (await db.tenants.create(actor, { name: 'DoomedCo' })).id
    await db.usage.recordOverageReport(doomed, '2026-07-11', { reported: 4, included: 200 })
    await db.tenants.remove(actor, doomed)
    const c = new pg.Client({ connectionString: url })
    await c.connect()
    try {
      const { rows } = await c.query<{ n: number }>('SELECT count(*)::int AS n FROM usage_reports WHERE "tenantId" = $1', [doomed])
      expect(rows[0]?.n).toBe(0)
    } finally {
      await c.end()
    }
  })
})
