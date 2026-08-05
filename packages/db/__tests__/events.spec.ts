import { execFileSync } from 'node:child_process'
import { resolve } from 'node:path'
import pg from 'pg'
import { GenericContainer, Wait, type StartedTestContainer } from 'testcontainers'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { createDb, type Db } from '../src/index.js'

/**
 * Events are read in OCCURRENCE order, not insertion order (audit MED #61).
 *
 * `id` is a sequence, so a device that buffered offline and then flushed inserts hours-old alerts
 * with the newest ids. Every "recent events" view is a `take`-limited first page, so it showed those
 * instead of what actually just happened: a panic from five minutes ago fell off the dashboard
 * because a truck came back into coverage.
 */
const IMAGE = 'timescale/timescaledb-ha:pg16'
const PKG_DIR = resolve(import.meta.dirname, '..')
const actor = { userId: '00000000-0000-0000-0000-0000000000aa' }

let container: StartedTestContainer
let db: Db
let url: string
let scope: { tenantId: string; accountId: string }

const q = async (sql: string, params: unknown[] = []): Promise<void> => {
  const c = new pg.Client({ connectionString: url })
  await c.connect()
  try {
    await c.query(sql, params as never)
  } finally {
    await c.end()
  }
}

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
  const tenant = await db.tenants.create(actor, { name: 'EventsCo' })
  const account = await db.accounts.create({ tenantId: tenant.id }, actor, { name: 'Fleet' })
  scope = { tenantId: tenant.id, accountId: account.id }

  // inserted OLDEST-`at`-LAST, so insertion order is the exact inverse of occurrence order — this
  // is what a buffered flush looks like
  const at = (min: number): string => new Date(Date.UTC(2026, 7, 5, 12, min)).toISOString()
  for (const [kind, when] of [
    ['overspeed', at(50)], // happened 10 minutes before the flush
    ['panic', at(55)], // …and this one 5 minutes before — the newest event
    ['ignition', at(0)], // the buffered device's hour-old backlog, inserted last
    ['geofence', at(5)],
  ] as const) {
    await q(
      `INSERT INTO events ("tenantId","accountId","deviceId",kind,at) VALUES ($1,$2,1,$3,$4)`,
      [scope.tenantId, scope.accountId, kind, when],
    )
  }
}, 300_000)

afterAll(async () => {
  await db?.$disconnect()
  await container?.stop()
})

describe('EventRepo.list ordering', () => {
  it('a take-limited page shows what happened MOST RECENTLY, not what was inserted last', async () => {
    const page = await db.events.list(scope, { take: 2 })
    expect(page.map((e) => e.kind)).toEqual(['panic', 'overspeed'])
  })

  it('the keyset cursor pages through the same order — no skipped or repeated rows', async () => {
    const first = await db.events.list(scope, { take: 2 })
    const tail = first[first.length - 1]!
    const second = await db.events.list(scope, { take: 2, cursor: `${tail.at.toISOString()}|${tail.id.toString()}` })
    expect(second.map((e) => e.kind)).toEqual(['geofence', 'ignition'])
    // the union is every row, exactly once
    expect(new Set([...first, ...second].map((e) => e.id.toString())).size).toBe(4)
  })

  it('a legacy id-only cursor still pages (a client may hold one minted before this change)', async () => {
    const all = await db.events.list(scope, { take: 10 })
    const anyId = all[0]!.id
    const page = await db.events.list(scope, { take: 10, cursor: anyId.toString() })
    expect(page.every((e) => e.id < anyId)).toBe(true)
  })

  it('a malformed cursor starts from the top rather than 500ing or returning the wrong slice', async () => {
    // the oversize-id cases are the point: `BigInt('99999999999999999999')` does NOT throw, it
    // produces a value Postgres rejects at bind time as an unmappable Prisma error — i.e. a 500 from
    // any authenticated caller. `bigid.ts` exists for exactly this.
    for (const bad of [
      'not-a-cursor',
      '|',
      'abc|def',
      '2026-13-45T99:99:99Z|1',
      '2026-08-05T12:00:00.000Z|99999999999999999999',
      '99999999999999999999',
      '2026-08-05T12:00:00.000Z|-1',
    ]) {
      const page = await db.events.list(scope, { take: 1, cursor: bad })
      expect(page.map((e) => e.kind), bad).toEqual(['panic'])
    }
  })

  it('an oversize deviceId or event id is a 404/empty page, never a 500', async () => {
    await expect(db.events.list(scope, { deviceId: '99999999999999999999' })).resolves.toBeInstanceOf(Array)
    await expect(db.events.get(scope, '99999999999999999999')).resolves.toBeNull()
  })

  it('filters still apply on top of the order', async () => {
    expect((await db.events.list(scope, { kind: 'panic' })).map((e) => e.kind)).toEqual(['panic'])
    const window = await db.events.list(scope, {
      from: new Date(Date.UTC(2026, 7, 5, 12, 30)).toISOString(),
      to: new Date(Date.UTC(2026, 7, 5, 13, 0)).toISOString(),
    })
    expect(window.map((e) => e.kind)).toEqual(['panic', 'overspeed'])
  })
})
