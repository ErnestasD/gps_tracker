import { execFileSync } from 'node:child_process'
import { createServer } from 'node:http'
import { resolve } from 'node:path'
import { serve } from '@hono/node-server'
import { Redis } from 'ioredis'
import { GenericContainer, Wait, type StartedTestContainer } from 'testcontainers'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { createDb, createPool, type Db, type Pool } from '@orbetra/db'

import { seedUser } from '../../../packages/db/seed/users.js'
import { createApp } from '../src/app.js'
import { mintTestToken, TEST_JWT_SECRET } from './helpers/auth.js'

/**
 * V1-nice temporary share links — the authed management routes + the PUBLIC (no-auth) resolve.
 * Proves: the public endpoint returns the latest VALID fix (rule 6 — an invalid newest fix is
 * excluded), 404s after revoke/expiry (enforced in SQL), is rate-limited per token and no-store,
 * and a cross-tenant device create is 404.
 */
const PG_IMAGE = 'timescale/timescaledb-ha:pg16'
const DB_PKG = resolve(import.meta.dirname, '../../../packages/db')

let pg: StartedTestContainer
let redisC: StartedTestContainer
let redis: Redis
let db: Db
let pool: Pool
let port: number
let httpServer: ReturnType<typeof createServer>

let t1Token: string
let t2Token: string
/** a third tenant deliberately left UNCONFIGURED — no verified host — plus a device of its own */
let t3Token: string
let t3DevId: string
let devId: string
const T0 = new Date('2026-07-01T06:00:00Z')

const base = () => `http://127.0.0.1:${port}`
const authed = (path: string, token: string, method = 'GET') =>
  fetch(`${base()}${path}`, { method, headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, ...(method === 'POST' ? { body: '{}' } : {}) })
const postJson = (path: string, token: string, body: unknown) =>
  fetch(`${base()}${path}`, { method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: JSON.stringify(body) })
// public fetch with a per-test client IP (trustProxy=true → rate-limit keys on XFF) so one
// test's requests never share another's per-IP bucket
const pub = (path: string, ip = '203.0.113.1') => fetch(`${base()}${path}`, { headers: { 'x-forwarded-for': ip } })

beforeAll(async () => {
  ;[pg, redisC] = await Promise.all([
    new GenericContainer(PG_IMAGE)
      .withEnvironment({ POSTGRES_PASSWORD: 'test', POSTGRES_DB: 'orbetra' })
      .withExposedPorts(5432)
      .withWaitStrategy(Wait.forLogMessage(/database system is ready to accept connections/, 2))
      .withStartupTimeout(240_000)
      .start(),
    new GenericContainer('redis:7-alpine').withExposedPorts(6379).withWaitStrategy(Wait.forLogMessage(/Ready to accept connections/)).start(),
  ])
  const databaseUrl = `postgresql://postgres:test@${pg.getHost()}:${pg.getMappedPort(5432)}/orbetra`
  execFileSync('pnpm', ['exec', 'prisma', 'migrate', 'deploy'], { cwd: DB_PKG, env: { ...process.env, DATABASE_URL: databaseUrl } })
  execFileSync('pnpm', ['exec', 'tsx', 'sql/migrate.ts'], { cwd: DB_PKG, env: { ...process.env, DATABASE_URL: databaseUrl } })
  redis = new Redis(redisC.getMappedPort(6379), redisC.getHost(), { maxRetriesPerRequest: null })
  db = createDb(databaseUrl)
  pool = createPool(databaseUrl)

  const s1 = await seedUser({ databaseUrl, email: 'a@s1.test', password: 'password12', role: 'tsp_admin', tenantName: 'S1', accountName: 'Fleet' })
  const s2 = await seedUser({ databaseUrl, email: 'a@s2.test', password: 'password12', role: 'tsp_admin', tenantName: 'S2' })
  t1Token = await mintTestToken({ userId: s1.userId, tenantId: s1.tenantId, role: 'tsp_admin' })
  t2Token = await mintTestToken({ userId: s2.userId, tenantId: s2.tenantId, role: 'tsp_admin' })

  // A share link is handed to somebody OUTSIDE the workspace and opens an unauthenticated page whose
  // branding resolves by Host — so a reseller who has configured nothing would be showing OUR brand
  // to their customer's customer. Minting one is therefore behind the readiness gate (plan W2), and
  // these fixtures give both tenants a verified host so the suite tests SHARES rather than the gate.
  // Written straight through the repo, `verified: true`, the same way a platform subdomain is
  // created — there is no DNS to prove in a fixture.
  await db.tenantDomains.create({ tenantId: s1.tenantId }, { userId: s1.userId }, 'fleet.s1.test', 'tok-s1', { verified: true })
  await db.tenantDomains.create({ tenantId: s2.tenantId }, { userId: s2.userId }, 'fleet.s2.test', 'tok-s2', { verified: true })

  const acct = (await db.accounts.list({ tenantId: s1.tenantId }))[0]!
  const [prof] = await pool.query<{ id: string }>(`INSERT INTO device_profiles(id,key,name) VALUES (gen_random_uuid(),'sk','P') RETURNING id`).then((r) => r.rows)
  const dev = await db.devices.create({ tenantId: s1.tenantId, accountId: acct.id }, { userId: s1.userId }, { accountId: acct.id, profileId: prof!.id, imei: '356307042449010', name: 'Courier Van' })
  devId = dev.id.toString()

  // …and one tenant with NO domain at all, so the readiness gate is reachable in this suite. Giving
  // S1 and S2 a verified host was necessary for the tests above, but it also made the gate invisible
  // everywhere — including to the cross-tenant 404 sweep that caught the ordering bug in the first
  // place. Without an unready tenant, moving requireReady back above the scope check would pass.
  const s3 = await seedUser({ databaseUrl, email: 'a@s3.test', password: 'password12', role: 'tsp_admin', tenantName: 'S3Unready', accountName: 'Fleet3' })
  t3Token = await mintTestToken({ userId: s3.userId, tenantId: s3.tenantId, role: 'tsp_admin' })
  const acct3 = (await db.accounts.list({ tenantId: s3.tenantId }))[0]!
  const dev3 = await db.devices.create({ tenantId: s3.tenantId, accountId: acct3.id }, { userId: s3.userId }, { accountId: acct3.id, profileId: prof!.id, imei: '356307042449028', name: 'Unready Van' })
  t3DevId = dev3.id.toString()

  // positions where the NEWEST fix is INVALID (satellites==0) — the public view must show the
  // latest VALID one (sec 30), never the invalid newest (sec 40)
  let h = 0
  for (const [sec, valid, speed, course] of [[10, true, 20, 90], [30, true, 42, 180], [40, false, 0, 0]] as const) {
    await pool.query(
      `INSERT INTO positions (device_id, fix_time, server_time, lat, lon, speed, course, fix_valid, rec_hash)
       VALUES ($1,$2,$2,$3,$4,$5,$6,$7,$8)`,
      [devId, new Date(T0.getTime() + sec * 1000), 54.0 + sec * 0.001, 25.0 + sec * 0.001, speed, course, valid, ++h],
    )
  }

  const app = createApp({
    redis, redisSub: redis, db, pool,
    jwtSecret: TEST_JWT_SECRET, jwtTtlS: 900, refreshTtlS: 3600, ticketTtlS: 30,
    lockout: { maxFails: 100, windowS: 900 }, secureCookies: false, trustProxy: true, getRemoteAddr: () => '127.0.0.1',
    shareRateLimit: { max: 5, windowS: 60 },
  })
  httpServer = serve({ fetch: app.fetch, port: 0, createServer }) as ReturnType<typeof createServer>
  port = await new Promise<number>((r) => httpServer.on('listening', () => r((httpServer.address() as { port: number }).port)))
}, 300_000)

afterAll(async () => {
  httpServer?.closeAllConnections?.()
  await new Promise<void>((r) => httpServer.close(() => r()))
  await pool.end()
  await db.$disconnect()
  await redis.quit()
  await Promise.all([pg.stop(), redisC.stop()])
})

describe('V1-nice share links — management', () => {
  it('creates a share, returns the token once + a relative path, lists it', async () => {
    const res = await postJson(`/v1/devices/${devId}/shares`, t1Token, { ttlHours: 24, label: 'Courier ETA' })
    expect(res.status).toBe(201)
    const created = (await res.json()) as { token: string; path: string; view: { id: string; prefix: string; label: string } }
    expect(created.token).toMatch(/^[0-9a-f]{64}$/)
    expect(created.path).toBe(`/s/${created.token}`)
    expect(created.view.prefix).toBe(created.token.slice(0, 8))
    expect(created.view.label).toBe('Courier ETA')

    const list = (await (await authed(`/v1/devices/${devId}/shares`, t1Token)).json()) as { id: string }[]
    expect(list.map((s) => s.id)).toContain(created.view.id)
    // and the tenant-wide /v1/shares collection
    const all = (await (await authed('/v1/shares', t1Token)).json()) as { id: string }[]
    expect(all.map((s) => s.id)).toContain(created.view.id)
  })

  it('rejects a bad body (ttl out of range) with 400, cross-tenant device with 404', async () => {
    expect((await postJson(`/v1/devices/${devId}/shares`, t1Token, { ttlHours: 0 })).status).toBe(400)
    expect((await postJson(`/v1/devices/${devId}/shares`, t1Token, { ttlHours: 100000 })).status).toBe(400)
    // T2 cannot create a share for T1's device — scope gate before body validation
    expect((await postJson(`/v1/devices/${devId}/shares`, t2Token, { ttlHours: 24 })).status).toBe(404)
  })
})

/**
 * A share link is the purest audience-creating action there is: it is handed to somebody outside the
 * workspace entirely and opens an unauthenticated page whose branding resolves by Host. A reseller
 * who has configured nothing would be showing OUR brand to their customer's customer.
 *
 * Both halves matter, and the second is the one that decays silently.
 */
describe('W2 readiness gates share links, and does not speak before authorization does', () => {
  it('an unconfigured reseller is refused, and told what is missing', async () => {
    const res = await postJson(`/v1/devices/${t3DevId}/shares`, t3Token, { ttlHours: 24, label: 'Too early' })
    expect(res.status).toBe(403)
    expect(JSON.stringify(await res.json())).toContain('no_verified_domain')
  })

  it('★ but a FOREIGN device is still 404 to them — the gate never answers before the scope check', async () => {
    // Placed above `db.devices.get`, requireReady turned this 404 into a 403: a different sentence,
    // about a device in somebody else's tenant, telling the caller it exists. The 403 above proves
    // the gate is live for this tenant, so a 404 here can only mean the ordering held.
    const res = await postJson(`/v1/devices/${devId}/shares`, t3Token, { ttlHours: 24 })
    expect(res.status).toBe(404)
  })
})

describe('V1-nice share links — public resolve', () => {
  it('exposes the link LABEL (never the device name) + latest VALID position, no-store', async () => {
    const { token } = (await (await postJson(`/v1/devices/${devId}/shares`, t1Token, { ttlHours: 24, label: 'Track me' })).json()) as { token: string }
    const res = await pub(`/v1/public/share/${token}`, '203.0.113.10')
    expect(res.status).toBe(200)
    expect(res.headers.get('cache-control')).toBe('no-store')
    const view = (await res.json()) as Record<string, unknown> & { label: string | null; position: { fixTime: string; speedKph: number } | null }
    expect(view.label).toBe('Track me')
    // the device's internal name must NOT leak to the public payload (review MED — PII)
    expect(JSON.stringify(view)).not.toContain('Courier Van')
    expect(view).not.toHaveProperty('deviceLabel')
    // sec 30 is the newest VALID fix; sec 40 (invalid) must NOT be returned
    expect(view.position!.fixTime).toBe(new Date(T0.getTime() + 30_000).toISOString())
    expect(view.position!.speedKph).toBe(42)
    // an unlabeled share exposes label:null (still no device name)
    const { token: t2 } = (await (await postJson(`/v1/devices/${devId}/shares`, t1Token, { ttlHours: 24 })).json()) as { token: string }
    expect(((await (await pub(`/v1/public/share/${t2}`, '203.0.113.11')).json()) as { label: string | null }).label).toBeNull()
  })

  it('404s on a malformed token and an unknown (well-formed) token', async () => {
    expect((await pub('/v1/public/share/not-a-token', '203.0.113.12')).status).toBe(404)
    expect((await pub(`/v1/public/share/${'a'.repeat(64)}`, '203.0.113.12')).status).toBe(404)
  })

  it('404s after the link is revoked (enforced in the resolve query)', async () => {
    const { token, view } = (await (await postJson(`/v1/devices/${devId}/shares`, t1Token, { ttlHours: 24 })).json()) as { token: string; view: { id: string } }
    expect((await pub(`/v1/public/share/${token}`, '203.0.113.13')).status).toBe(200)
    expect((await authed(`/v1/shares/${view.id}`, t1Token, 'DELETE')).status).toBe(200)
    expect((await pub(`/v1/public/share/${token}`, '203.0.113.13')).status).toBe(404)
  })

  it('404s once expired (expiresAt in the past)', async () => {
    const { token, view } = (await (await postJson(`/v1/devices/${devId}/shares`, t1Token, { ttlHours: 1 })).json()) as { token: string; view: { id: string } }
    await pool.query(`UPDATE share_links SET "expiresAt" = now() - interval '1 hour' WHERE id=$1`, [view.id])
    expect((await pub(`/v1/public/share/${token}`, '203.0.113.14')).status).toBe(404)
  })

  it('rate-limits per CLIENT IP (429 past the window budget); a different IP is unaffected', async () => {
    const { token } = (await (await postJson(`/v1/devices/${devId}/shares`, t1Token, { ttlHours: 24 })).json()) as { token: string }
    const attacker = '198.51.100.7'
    const codes: number[] = []
    for (let i = 0; i < 7; i++) codes.push((await pub(`/v1/public/share/${token}`, attacker)).status)
    expect(codes.filter((c) => c === 200).length).toBe(5) // max per IP
    expect(codes).toContain(429)
    // the SAME token from a DIFFERENT IP still resolves — legit viewers don't share a bucket
    expect((await pub(`/v1/public/share/${token}`, '198.51.100.8')).status).toBe(200)
  })
})
