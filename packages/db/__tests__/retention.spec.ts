import { execFileSync } from 'node:child_process'
import { resolve } from 'node:path'
import pg from 'pg'
import { GenericContainer, Wait, type StartedTestContainer } from 'testcontainers'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { createDb, type Db } from '../src/index.js'

/**
 * Retention for DERIVED location data and the auth token tables (audit MED #53).
 *
 * Against a real database because the prunes are raw SQL whose whole job is the WHERE clause:
 * which rows go, which stay, and — for trips — that the row survives with its coordinates gone.
 * `add_retention_policy('positions', …)` was the only horizon in the codebase, so at month 14 the
 * raw chunks were dropped while `events` kept lat/lon for every geofence crossing and panic and
 * `trips` kept exact start/end coordinates, after the privacy policy, the Terms and the DPA had all
 * told the customer that data was deleted.
 */
const IMAGE = 'timescale/timescaledb-ha:pg16'
const PKG_DIR = resolve(import.meta.dirname, '..')
const actor = { userId: '00000000-0000-0000-0000-0000000000aa' }

let container: StartedTestContainer
let db: Db
let url: string
let scope: { tenantId: string; accountId: string }

async function q<T extends pg.QueryResultRow>(sql: string, params: unknown[] = []): Promise<T[]> {
  const c = new pg.Client({ connectionString: url })
  await c.connect()
  try {
    return (await c.query<T>(sql, params as never)).rows
  } finally {
    await c.end()
  }
}

const OLD = new Date(Date.UTC(2024, 0, 15)) // well past any horizon
const RECENT = new Date(Date.UTC(2026, 7, 1))
const CUTOFF = new Date(Date.UTC(2025, 6, 1))

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
  const tenant = await db.tenants.create(actor, { name: 'RetentionCo' })
  const account = await db.accounts.create({ tenantId: tenant.id }, actor, { name: 'Fleet' })
  scope = { tenantId: tenant.id, accountId: account.id }
}, 300_000)

afterAll(async () => {
  await db?.$disconnect()
  await container?.stop()
})

describe('events retention', () => {
  it('deletes events past the horizon and keeps the rest', async () => {
    for (const [kind, at] of [
      ['panic', OLD],
      ['overspeed', OLD],
      ['geofence', RECENT],
    ] as const) {
      await q(`INSERT INTO events ("tenantId","accountId","deviceId",kind,at,lat,lon) VALUES ($1,$2,1,$3,$4,54.68,25.27)`, [scope.tenantId, scope.accountId, kind, at])
    }
    expect(await db.events.pruneOlderThan(CUTOFF)).toBe(2)
    const left = await q<{ kind: string; lat: number | null }>(`SELECT kind, lat FROM events WHERE "tenantId" = $1`, [scope.tenantId])
    expect(left.map((r) => r.kind)).toEqual(['geofence'])
    expect(left[0]?.lat).not.toBeNull() // the recent one keeps its coordinates — it is inside the window
  })

  it('is idempotent: a second run finds nothing left to do', async () => {
    expect(await db.events.pruneOlderThan(CUTOFF)).toBe(0)
  })

  it('batches, and the loop terminates on an exact multiple of the batch size', async () => {
    // the `n < size` exit is the whole termination argument; a batch that fills exactly must still
    // stop on the following empty one rather than spinning
    for (let i = 0; i < 6; i++) {
      await q(`INSERT INTO events ("tenantId","accountId","deviceId",kind,at) VALUES ($1,$2,1,'ignition',$3)`, [scope.tenantId, scope.accountId, OLD])
    }
    expect(await db.events.pruneOlderThan(CUTOFF, 3)).toBe(6)
    expect((await q<{ n: string }>(`SELECT count(*) AS n FROM events WHERE at < $1`, [CUTOFF]))[0]?.n).toBe('0')
  })
})

describe('trip coordinate stripping', () => {
  const insertTrip = async (startTime: Date): Promise<string> => {
    const rows = await q<{ id: string }>(
      `INSERT INTO trips ("tenantId","accountId","deviceId","startTime","endTime",status,"startLat","startLon","endLat","endLon","distanceM")
       VALUES ($1,$2,1,$3,$3,'closed',54.68,25.27,54.90,23.90,12345) RETURNING id::text`,
      [scope.tenantId, scope.accountId, startTime],
    )
    return rows[0]!.id
  }

  it('nulls the coordinates but KEEPS the trip — distance and times survive', async () => {
    const oldId = await insertTrip(OLD)
    const freshId = await insertTrip(RECENT)
    expect(await db.trips.stripCoordinatesOlderThan(CUTOFF)).toBe(1)

    const [stripped] = await q<{ startLat: number | null; endLon: number | null; distanceM: number; endTime: Date }>(
      `SELECT "startLat","endLon","distanceM","endTime" FROM trips WHERE id = $1::bigint`,
      [oldId],
    )
    expect(stripped?.startLat).toBeNull()
    expect(stripped?.endLon).toBeNull()
    expect(stripped?.distanceM).toBe(12345) // the reporting basis is untouched
    expect(stripped?.endTime).toBeInstanceOf(Date)

    const [kept] = await q<{ startLat: number | null }>(`SELECT "startLat" FROM trips WHERE id = $1::bigint`, [freshId])
    expect(kept?.startLat).toBeCloseTo(54.68) // inside the window, untouched
  })

  it('is idempotent — an already-stripped trip is not rewritten on every daily run', async () => {
    // without the `IS NOT NULL` predicate this would re-update the whole tail of the table forever,
    // and the batch loop's exit condition would never be reached honestly
    expect(await db.trips.stripCoordinatesOlderThan(CUTOFF)).toBe(0)
  })
})

describe('token retention', () => {
  it('deletes DEAD tokens past their own expiry and never a live one', async () => {
    const tenant = await db.tenants.create(actor, { name: 'TokenCo' })
    const account = await db.accounts.create({ tenantId: tenant.id }, actor, { name: 'A' })
    const [user] = await q<{ id: string }>(
      `INSERT INTO users (id,"tenantId","accountId",email,"passwordHash",role) VALUES (gen_random_uuid(),$1,$2,'tok@x.test','h','tsp_admin') RETURNING id::text`,
      [tenant.id, account.id],
    )
    const uid = user!.id
    const mk = async (id: string, expiresAt: Date, revoked: Date | null, rotated: Date | null): Promise<void> => {
      await q(
        `INSERT INTO refresh_tokens (id,"familyId","userId","tokenHash","expiresAt","revokedAt","rotatedAt") VALUES ($1::uuid,gen_random_uuid(),$2::uuid,$1,$3,$4,$5)`,
        [id, uid, expiresAt, revoked, rotated],
      )
    }
    const A = '11111111-1111-1111-1111-111111111111'
    const B = '22222222-2222-2222-2222-222222222222'
    const C = '33333333-3333-3333-3333-333333333333'
    await mk(A, OLD, OLD, null) // long expired AND revoked → goes
    await mk(B, OLD, null, null) // long expired, never revoked → goes (expiry alone is death)
    await mk(C, new Date(Date.now() + 86_400_000), null, null) // live → stays

    expect(await db.auth.tokenRetention.pruneRefreshTokens(CUTOFF)).toBe(2)
    const left = await q<{ id: string }>(`SELECT id::text FROM refresh_tokens WHERE "userId" = $1::uuid`, [uid])
    expect(left.map((r) => r.id)).toEqual([C])

    // reset + affiliate tokens: same shape, keyed on expiry
    await q(`INSERT INTO password_reset_tokens (id,"userId","tokenHash","expiresAt") VALUES (gen_random_uuid(),$1::uuid,'rh-old',$2)`, [uid, OLD])
    await q(`INSERT INTO password_reset_tokens (id,"userId","tokenHash","expiresAt") VALUES (gen_random_uuid(),$1::uuid,'rh-new',$2)`, [uid, RECENT])
    expect(await db.auth.tokenRetention.pruneResetTokens(CUTOFF)).toBe(1)
    expect((await q<{ n: string }>(`SELECT count(*) AS n FROM password_reset_tokens`))[0]?.n).toBe('1')

    const aff = await db.affiliates.create(actor, { name: 'Tok Partner', email: 'tokpartner@x.test', code: 'TOKP01' })
    await db.affiliates.createPwToken(aff.id, 'aff-old', OLD)
    await db.affiliates.createPwToken(aff.id, 'aff-new', RECENT)
    expect(await db.auth.tokenRetention.pruneAffiliateTokens(CUTOFF)).toBe(1)
    expect((await q<{ n: string }>(`SELECT count(*) AS n FROM affiliate_password_tokens`))[0]?.n).toBe('1')
  })
})
