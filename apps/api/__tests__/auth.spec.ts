import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { createServer } from 'node:http'
import { resolve } from 'node:path'
import { serve } from '@hono/node-server'
import { Hono } from 'hono'
import { Redis } from 'ioredis'
import { GenericContainer, Wait, type StartedTestContainer } from 'testcontainers'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

import { createDb, type Db } from '@orbetra/db'
import { ROLES, type AuthSession, type Role } from '@orbetra/shared'

import { seedUser } from '../../../packages/db/seed/users.js'
import { createApp, type ApiDeps } from '../src/app.js'
import { verifyAccessToken } from '../src/auth/jwt.js'
import { authMiddleware, requireRole, type AuthEnv } from '../src/auth/middleware.js'
import { hashPassword, verifyPassword } from '../src/auth/passwords.js'
import * as passwords from '../src/auth/passwords.js'
import { mintTestToken, TEST_JWT_SECRET } from './helpers/auth.js'
import { markSessionsRevoked } from '../src/ws.js'

const PG_IMAGE = 'timescale/timescaledb-ha:pg16'
const DB_PKG = resolve(import.meta.dirname, '../../../packages/db')

let pg: StartedTestContainer
let redisC: StartedTestContainer
let redis: Redis
let redisSub: Redis
let db: Db
let databaseUrl: string
let port: number
let httpServer: ReturnType<typeof createServer>
let deps: ApiDeps

const PW = 'correct horse battery staple'
const seeded: Record<Role, { email: string }> = {
  platform_admin: { email: 'pa@orbetra.test' },
  tsp_admin: { email: 'ta@orbetra.test' },
  account_manager: { email: 'am@orbetra.test' },
  viewer: { email: 'vw@orbetra.test' },
}
const tokens = {} as Record<Role, string>

const base = () => `http://127.0.0.1:${port}`
const login = (email: string, password: string): Promise<Response> =>
  fetch(`${base()}/v1/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, password }),
  })
const cookieOf = (res: Response): string => {
  const setCookie = res.headers.get('set-cookie') ?? ''
  return /orb_refresh=([^;]+)/.exec(setCookie)?.[1] ?? ''
}
const refresh = (cookie: string): Promise<Response> =>
  fetch(`${base()}/v1/auth/refresh`, { method: 'POST', headers: { cookie: `orb_refresh=${cookie}` } })

beforeAll(async () => {
  ;[pg, redisC] = await Promise.all([
    new GenericContainer(PG_IMAGE)
      .withEnvironment({ POSTGRES_PASSWORD: 'test', POSTGRES_DB: 'orbetra' })
      .withExposedPorts(5432)
      .withWaitStrategy(Wait.forLogMessage(/database system is ready to accept connections/, 2))
      .withStartupTimeout(240_000)
      .start(),
    new GenericContainer('redis:7-alpine')
      .withExposedPorts(6379)
      .withWaitStrategy(Wait.forLogMessage(/Ready to accept connections/))
      .start(),
  ])
  databaseUrl = `postgresql://postgres:test@${pg.getHost()}:${pg.getMappedPort(5432)}/orbetra`
  execFileSync('pnpm', ['exec', 'prisma', 'migrate', 'deploy'], {
    cwd: DB_PKG,
    env: { ...process.env, DATABASE_URL: databaseUrl },
  })
  const opts = { maxRetriesPerRequest: null }
  redis = new Redis(redisC.getMappedPort(6379), redisC.getHost(), opts)
  redisSub = new Redis(redisC.getMappedPort(6379), redisC.getHost(), opts)
  db = createDb(databaseUrl)

  // one user per role in one tenant; account-scoped roles get an account
  for (const role of ROLES) {
    await seedUser({
      databaseUrl,
      email: seeded[role].email,
      password: PW,
      role,
      tenantName: 'T1',
      ...(role === 'account_manager' || role === 'viewer' ? { accountName: 'A1' } : {}),
    })
  }

  deps = {
    redis,
    redisSub,
    db,
    jwtSecret: TEST_JWT_SECRET,
    jwtTtlS: 900,
    refreshTtlS: 3600,
    ticketTtlS: 30,
    // The window must comfortably outlast FIVE argon2 verifies (~115 ms each locally, far more on
    // a loaded CI runner) — at windowS: 2 the counter expired mid-test and the 6th login answered
    // 200, which read as a lockout regression rather than a stopwatch problem. The unlock case
    // deletes the key instead of sleeping: that IS what expiry does, and it is deterministic.
    // The per-IP / per-email ceilings are raised well out of the way here: EVERY test in this file
    // shares one source IP, so the suite's own accumulated failures would otherwise trip an abuse
    // ceiling meant for a stranger. The dedicated tests below build their own app with tight values.
    lockout: { maxFails: 5, windowS: 30, maxFailsPerIp: 10_000, maxAttemptsPerIpHard: 100_000, maxFailIpsPerEmail: 10_000 },
    secureCookies: false,
    trustProxy: false,
    getRemoteAddr: () => '127.0.0.1',
  }
  const app = createApp(deps)

  // AC[2] 403 rows: probe sub-app built from the PRODUCTION requireRole — no real
  // role-restricted endpoint exists until E03-2 CRUD / E03-4 quarantine; this
  // exercises the guard mechanism itself (E03-2 extends the matrix with real routes)
  const probes = new Hono<AuthEnv>()
  probes.use('*', authMiddleware({ jwtSecret: TEST_JWT_SECRET }))
  probes.get('/platform-only', requireRole('platform_admin'), (c) => c.json({ ok: true }))
  probes.get('/admins', requireRole('platform_admin', 'tsp_admin'), (c) => c.json({ ok: true }))
  app.route('/test', probes)

  httpServer = serve({ fetch: app.fetch, port: 0, createServer }) as ReturnType<typeof createServer>
  port = await new Promise<number>((r) => {
    httpServer.on('listening', () => r((httpServer.address() as { port: number }).port))
  })

  for (const role of ROLES) {
    const res = await login(seeded[role].email, PW)
    tokens[role] = ((await res.json()) as AuthSession).accessToken
  }
}, 300_000)

afterAll(async () => {
  httpServer?.closeAllConnections?.()
  await new Promise<void>((r) => httpServer.close(() => r()))
  await db.$disconnect()
  await redis.quit()
  await redisSub.quit()
  await Promise.all([pg.stop(), redisC.stop()])
})

describe('E03-1 AC[3]: argon2id params pinned', () => {
  it('hashes carry m=65536,t=3,p=4 argon2id PHC prefix (silent weakening fails here)', async () => {
    const h = await hashPassword('x')
    expect(h).toMatch(/^\$argon2id\$v=19\$m=65536,t=3,p=4\$/)
    expect(await verifyPassword(h, 'x')).toBe(true)
    expect(await verifyPassword(h, 'y')).toBe(false)
  })

  it('seed script produces the same PHC params (single source)', async () => {
    const u = await db.auth.users.findByEmailAllTenants(seeded.viewer.email)
    expect(u[0]!.passwordHash).toMatch(/^\$argon2id\$v=19\$m=65536,t=3,p=4\$/)
  })
})

describe('E03-1 login', () => {
  it('happy path: session + cookie attributes + claims', async () => {
    const res = await login(seeded.tsp_admin.email, PW)
    expect(res.status).toBe(200)
    const setCookie = res.headers.get('set-cookie')!
    expect(setCookie).toContain('orb_refresh=')
    expect(setCookie).toContain('HttpOnly')
    expect(setCookie).toContain('Path=/v1/auth')
    expect(setCookie).toContain('SameSite=Strict')
    expect(setCookie).toContain('Max-Age=3600')
    const body = (await res.json()) as AuthSession
    expect(body.expiresInS).toBe(900)
    expect(body.user.role).toBe('tsp_admin')
    const claims = await verifyAccessToken(body.accessToken, TEST_JWT_SECRET)
    expect(claims).toMatchObject({ ten: body.user.tenantId, role: 'tsp_admin' })
    expect(claims!.acc).toBeUndefined() // tenant-wide user
  })

  it('account-scoped user carries acc claim', async () => {
    const res = await login(seeded.viewer.email, PW)
    const body = (await res.json()) as AuthSession
    const claims = await verifyAccessToken(body.accessToken, TEST_JWT_SECRET)
    expect(claims!.acc).toBe(body.user.accountId)
  })

  it('wrong password / unknown email → 401 problem+json; malformed body → 400', async () => {
    const wrong = await login(seeded.viewer.email, 'nope')
    expect(wrong.status).toBe(401)
    expect(wrong.headers.get('content-type')).toContain('application/problem+json')
    expect((await login('ghost@orbetra.test', PW)).status).toBe(401)
    const bad = await fetch(`${base()}/v1/auth/login`, { method: 'POST', body: 'not json' })
    expect(bad.status).toBe(400)
  })

  it('a DISABLED account is refused exactly like a wrong password, and lastLoginAt is stamped on success', async () => {
    const email = seeded.viewer.email
    // a normal login works and records the visit — the console reads this to tell a seat nobody
    // uses from a customer who is here daily
    expect((await login(email, PW)).status).toBe(200)
    const before = await db.platform.users({ limit: 500 })
    expect(before.find((u) => u.email === email)?.lastLoginAt).not.toBeNull()

    const target = before.find((u) => u.email === email)!
    await db.platform.setUserDisabled({ userId: '00000000-0000-0000-0000-0000000000aa' }, target.id, true)

    // …and now it is refused. The status, the content type and the body must be IDENTICAL to a
    // wrong password: any difference tells an anonymous caller this address exists and is switched
    // off, which is the account oracle the unverified branch was folded in to close.
    const disabled = await login(email, PW)
    const wrong = await login(email, 'definitely-not-the-password')
    expect(disabled.status).toBe(wrong.status)
    expect(disabled.status).toBe(401)
    expect(disabled.headers.get('content-type')).toBe(wrong.headers.get('content-type'))
    expect(await disabled.text()).toBe(await wrong.text())

    // re-enabling restores access — a disable must be reversible, or it is a delete with extra steps
    await db.platform.setUserDisabled({ userId: '00000000-0000-0000-0000-0000000000aa' }, target.id, false)
    expect((await login(email, PW)).status).toBe(200)
  })

  it('email case/whitespace normalized', async () => {
    expect((await login(`  ${seeded.viewer.email.toUpperCase()}  `, PW)).status).toBe(200)
  })

  it('timing equalization: unknown email still runs exactly one verify', async () => {
    const spy = vi.spyOn(passwords, 'verifyPassword')
    await login('nobody@orbetra.test', PW)
    expect(spy).toHaveBeenCalledTimes(1)
    spy.mockRestore()
  })

  it('cross-tenant same email, different passwords → each lands in its own tenant', async () => {
    await seedUser({ databaseUrl, email: 'dual@orbetra.test', password: 'pw-one', role: 'tsp_admin', tenantName: 'T1' })
    const t2 = await seedUser({ databaseUrl, email: 'dual@orbetra.test', password: 'pw-two', role: 'tsp_admin', tenantName: 'T2' })
    const one = (await (await login('dual@orbetra.test', 'pw-one')).json()) as AuthSession
    const two = (await (await login('dual@orbetra.test', 'pw-two')).json()) as AuthSession
    expect(one.user.tenantId).not.toBe(two.user.tenantId)
    expect(two.user.tenantId).toBe(t2.tenantId)
  })

  it('same email AND password in two tenants → 409 ambiguous-identity (founder decision)', async () => {
    await seedUser({ databaseUrl, email: 'ambig@orbetra.test', password: PW, role: 'tsp_admin', tenantName: 'T1' })
    await seedUser({ databaseUrl, email: 'ambig@orbetra.test', password: PW, role: 'tsp_admin', tenantName: 'T2' })
    const res = await login('ambig@orbetra.test', PW)
    expect(res.status).toBe(409)
    expect(((await res.json()) as { type: string }).type).toContain('ambiguous-identity')
  })
})

describe('E03-1 AC[1]: refresh rotation + family revocation', () => {
  it('reuse of a rotated token revokes the WHOLE family', async () => {
    const a = cookieOf(await login(seeded.account_manager.email, PW))
    const resB = await refresh(a)
    expect(resB.status).toBe(200)
    const b = cookieOf(resB)
    expect(b).not.toBe(a)

    const replayA = await refresh(a) // reuse after rotation
    expect(replayA.status).toBe(401)
    expect(replayA.headers.get('set-cookie')).toContain('Max-Age=0') // cookie cleared

    const resB2 = await refresh(b) // sibling must be dead too — family revoked
    expect(resB2.status).toBe(401)
  })

  it('concurrent refresh race: exactly one winner, family strictly revoked after', async () => {
    const a = cookieOf(await login(seeded.account_manager.email, PW))
    const [r1, r2] = await Promise.all([refresh(a), refresh(a)])
    expect([r1.status, r2.status].sort()).toEqual([200, 401])
    const winner = cookieOf(r1.status === 200 ? r1 : r2)
    // loser's failed claim looked like reuse → family is revoked; winner is dead too
    expect((await refresh(winner)).status).toBe(401)
  })

  it('a password reset LANDING MID-REFRESH cannot be outrun — the family stays dead (audit high)', async () => {
    // The eviction paths are all `UPDATE refresh_tokens SET revoked_at WHERE revoked_at IS NULL`,
    // which cannot match a row inserted after they ran. So a refresh in flight during a reset used
    // to write an UNREVOKED successor and rotate for the full 14-day TTL — the reset evicted nobody.
    // A re-read after the insert does not fix it either: under READ COMMITTED a reader never sees an
    // UNCOMMITTED eviction. Only `rotate`'s SELECT … FOR UPDATE on the user row serializes the two.
    // Fired repeatedly so both lock orders (eviction-first and rotation-first) are exercised.
    const email = seeded.viewer.email
    const viewerId = (await db.auth.users.findByEmailAllTenants(email))[0]!.id
    for (let i = 0; i < 6; i++) {
      const c = cookieOf(await login(email, PW))
      const [refreshed] = await Promise.all([
        refresh(c),
        db.auth.refreshTokens.revokeAllForUser(viewerId, new Date()),
      ])
      if (refreshed.status === 200) {
        // rotation won the lock: the eviction ran after it, so its sweep covered the successor
        expect((await refresh(cookieOf(refreshed))).status).toBe(401)
      } else {
        expect(refreshed.status).toBe(401) // eviction won: no successor was ever handed out
      }
      // either way NOTHING in that family is live afterwards
      expect((await refresh(c)).status).toBe(401)
    }
  })

  it('an ordinary rotation is unaffected by the epoch (no self-inflicted logout)', async () => {
    // the fence keys on User.sessionsRevokedAt, not on "any revoked sibling" — otherwise the
    // reuse-detection path (two tabs restoring at once) would 401 the legitimate winner too
    const c = cookieOf(await login(seeded.tsp_admin.email, PW))
    let cur = c
    for (let i = 0; i < 3; i++) {
      const res = await refresh(cur)
      expect(res.status).toBe(200)
      cur = cookieOf(res)
    }
  })

  it('refresh returns a fresh session with current user data', async () => {
    const c = cookieOf(await login(seeded.tsp_admin.email, PW))
    const res = await refresh(c)
    const body = (await res.json()) as AuthSession
    expect(body.user.email).toBe(seeded.tsp_admin.email)
    expect((await verifyAccessToken(body.accessToken, TEST_JWT_SECRET))!.role).toBe('tsp_admin')
  })

  it('no cookie / garbage cookie → 401', async () => {
    expect((await fetch(`${base()}/v1/auth/refresh`, { method: 'POST' })).status).toBe(401)
    expect((await refresh('deadbeef'.repeat(8))).status).toBe(401)
  })

  it('logout revokes the family and clears the cookie', async () => {
    const c = cookieOf(await login(seeded.tsp_admin.email, PW))
    const out = await fetch(`${base()}/v1/auth/logout`, {
      method: 'POST',
      headers: { cookie: `orb_refresh=${c}` },
    })
    expect(out.status).toBe(200)
    expect(out.headers.get('set-cookie')).toContain('Max-Age=0')
    expect((await refresh(c)).status).toBe(401)
  })

  it('logout without a cookie still succeeds and clears (review LOW)', async () => {
    const out = await fetch(`${base()}/v1/auth/logout`, { method: 'POST' })
    expect(out.status).toBe(200)
    expect(out.headers.get('set-cookie')).toContain('Max-Age=0')
  })

  it('B1: an access token predating a session revocation is refused a ws-ticket (no fresh live stream)', async () => {
    // A still-unexpired access token must NOT obtain a new ws-ticket once the user's sessions are
    // revoked (logout / delete / scope change) — else it opens a live stream the gateway's
    // establishedAt sweep never closes. A DEDICATED user (unique id) so the future-dated revoke
    // marker can't bleed into the shared role-matrix users; revoke clearly AFTER issuance (iat is
    // second-granular) so the check is deterministic, not a sub-second race with the login stamp.
    const email = 'b1-revoke@orbetra.test'
    await seedUser({ databaseUrl, email, password: PW, role: 'viewer', tenantName: 'T1', accountName: 'A1' })
    const session = (await (await login(email, PW)).json()) as AuthSession
    const auth = { authorization: `Bearer ${session.accessToken}` }
    expect((await fetch(`${base()}/v1/ws-ticket`, { headers: auth })).status).toBe(200)
    await markSessionsRevoked(redis, session.user.id, Date.now() + 5000)
    expect((await fetch(`${base()}/v1/ws-ticket`, { headers: auth })).status).toBe(401)
  })
})

describe('E03-1 AC[2]: role matrix (4 roles × representative endpoints)', () => {
  // Re-login for FRESH tokens: an earlier logout test set a ws:revoke marker for these users, and
  // ws-ticket now refuses a token minted before that marker (audit B1). A re-login gives an iat
  // after it, so the matrix exercises pure role gating, not stale-token revocation.
  beforeAll(async () => {
    for (const role of ROLES) {
      const res = await login(seeded[role].email, PW)
      tokens[role] = ((await res.json()) as AuthSession).accessToken
    }
  })

  const matrix: { path: string; expected: Record<Role, number> }[] = [
    { path: '/v1/auth/me', expected: { platform_admin: 200, tsp_admin: 200, account_manager: 200, viewer: 200 } },
    { path: '/v1/ws-ticket', expected: { platform_admin: 200, tsp_admin: 200, account_manager: 200, viewer: 200 } },
    { path: '/v1/devices/last', expected: { platform_admin: 200, tsp_admin: 200, account_manager: 200, viewer: 200 } },
    { path: '/test/platform-only', expected: { platform_admin: 200, tsp_admin: 403, account_manager: 403, viewer: 403 } },
    { path: '/test/admins', expected: { platform_admin: 200, tsp_admin: 200, account_manager: 403, viewer: 403 } },
  ]

  it.each(matrix)('$path enforces the expected grid', async ({ path, expected }) => {
    for (const role of ROLES) {
      const res = await fetch(`${base()}${path}`, {
        headers: { authorization: `Bearer ${tokens[role]}` },
      })
      expect(res.status, `${role} → ${path}`).toBe(expected[role])
    }
  })

  it('a JWT signed with our secret but missing scope claims does NOT authenticate', async () => {
    // structurally valid HS256, wrong shape (no ten/role) — zod claim check must reject
    const { sign } = await import('hono/jwt')
    const bad = await sign({ sub: 'u1', iss: 'orbetra-api', iat: 0, exp: Math.floor(Date.now() / 1000) + 900 }, TEST_JWT_SECRET, 'HS256')
    const res = await fetch(`${base()}/v1/devices/last`, { headers: { authorization: `Bearer ${bad}` } })
    expect(res.status).toBe(401)
  })

  it('/v1/auth/me returns the caller identity', async () => {
    const res = await fetch(`${base()}/v1/auth/me`, {
      headers: { authorization: `Bearer ${tokens.viewer}` },
    })
    expect(((await res.json()) as { email: string }).email).toBe(seeded.viewer.email)
  })

  it('PATCH /v1/auth/me persists the self-service locale (any role) and rejects an unsupported one', async () => {
    const session = (await (await login(seeded.viewer.email, PW)).json()) as AuthSession
    const hdr = { authorization: `Bearer ${session.accessToken}`, 'content-type': 'application/json' }
    const ok = await fetch(`${base()}/v1/auth/me`, { method: 'PATCH', headers: hdr, body: JSON.stringify({ locale: 'lt' }) })
    expect(ok.status).toBe(200)
    expect(((await ok.json()) as { locale: string }).locale).toBe('lt')
    // and it stuck: a fresh /me read reflects the persisted locale
    const me = (await (await fetch(`${base()}/v1/auth/me`, { headers: hdr })).json()) as { locale: string }
    expect(me.locale).toBe('lt')
    // an unsupported locale is a 400 (enum-gated)
    expect((await fetch(`${base()}/v1/auth/me`, { method: 'PATCH', headers: hdr, body: JSON.stringify({ locale: 'zz' }) })).status).toBe(400)
  })
})

describe('E03-1 lockout (§6.1: 5 fails → window per IP+email)', () => {
  it('5 wrong → 6th blocked with 429 EVEN with the correct password; unlocks after window', async () => {
    const email = 'locked@orbetra.test'
    await seedUser({ databaseUrl, email, password: PW, role: 'tsp_admin', tenantName: 'T1' })
    for (let i = 0; i < 5; i++) expect((await login(email, 'wrong')).status).toBe(401)
    const blocked = await login(email, PW)
    expect(blocked.status).toBe(429)
    expect(Number(blocked.headers.get('retry-after'))).toBeGreaterThan(0)
    // simulate the window expiring — deleting the counter is exactly what EXPIRE does, and it does
    // not make the suite wait out a real window (nor race it, as a sleep did)
    await redis.del(`auth:fail:127.0.0.1:${createHash('sha256').update(email).digest('hex').slice(0, 16)}`)
    expect((await login(email, PW)).status).toBe(200)
  })

  it('successful login resets the counter', async () => {
    const email = 'resetme@orbetra.test'
    await seedUser({ databaseUrl, email, password: PW, role: 'tsp_admin', tenantName: 'T1' })
    for (let i = 0; i < 4; i++) await login(email, 'wrong')
    expect((await login(email, PW)).status).toBe(200) // 5th attempt, correct — allowed
    for (let i = 0; i < 4; i++) await login(email, 'wrong') // fresh counter
    expect((await login(email, PW)).status).toBe(200)
  })

  it('lockout is per identity: a different email from the same IP is unaffected', async () => {
    const email = 'victim@orbetra.test'
    await seedUser({ databaseUrl, email, password: PW, role: 'tsp_admin', tenantName: 'T1' })
    for (let i = 0; i < 5; i++) await login('someoneelse@orbetra.test', 'wrong')
    expect((await login(email, PW)).status).toBe(200)
  })
})

/**
 * The two holes the (IP, email) key shape left open (audit MED). Each gets its own app with tight
 * ceilings and its own source IP, because the ceilings are per-IP and the rest of this file shares
 * 127.0.0.1.
 */
describe('E03-1 lockout: abuse ceilings beyond the per-credential rule', () => {
  const servers: ReturnType<typeof createServer>[] = []

  const appOn = async (
    lockout: {
      maxFails: number
      windowS: number
      maxFailsPerIp?: number
      maxAttemptsPerIpHard?: number
      maxFailIpsPerEmail?: number
    },
    remoteAddr: string,
    trustProxy = false,
  ): Promise<string> => {
    const app = createApp({ ...deps, lockout, trustProxy, getRemoteAddr: () => remoteAddr })
    const srv = serve({ fetch: app.fetch, port: 0, createServer }) as ReturnType<typeof createServer>
    servers.push(srv)
    const p = await new Promise<number>((r) => srv.on('listening', () => r((srv.address() as { port: number }).port)))
    return `http://127.0.0.1:${p}`
  }

  const post = (url: string, email: string, password: string, xff?: string): Promise<Response> =>
    fetch(`${url}/v1/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...(xff !== undefined ? { 'x-forwarded-for': xff } : {}) },
      body: JSON.stringify({ email, password }),
    })

  afterAll(async () => {
    for (const s of servers) {
      s.closeAllConnections?.()
      await new Promise<void>((r) => s.close(() => r()))
    }
  })

  it('the SOFT per-IP ceiling THROTTLES a source no real user has come from — 1 in N, not a wall', async () => {
    // REGRESSION. Applied only post-verify, the soft ceiling enforced nothing: a correct password
    // never reaches the check, so it merely relabelled a wrong guess 401→429 while a full 64 MB
    // argon2 verify ran anyway — the oracle (200 means right) and the CPU cost both intact.
    // Applied pre-verify for everyone, it locks out a whole office behind one NAT with no way back.
    // So: pre-verify only for a bucket that has never produced a successful login.
    // A hard refusal was itself a renewable lockout: the failures are not per-account, so 50 wrong
    // guesses at 50 invented addresses spend the whole bucket's budget for free — and once spent,
    // the successful login that would MARK the bucket is refused by the gate it would clear, so it
    // never self-heals. One in ten still cuts an attacker's argon2 throughput tenfold.
    const email = 'unmarked@orbetra.test'
    await seedUser({ databaseUrl, email, password: PW, role: 'tsp_admin', tenantName: 'T1' })
    const spy = vi.spyOn(passwords, 'verifyPassword')
    const url = await appOn(
      { maxFails: 100, windowS: 30, maxFailsPerIp: 3, maxAttemptsPerIpHard: 100_000, maxFailIpsPerEmail: 10_000 },
      '10.9.9.10',
    )
    for (let i = 0; i < 3; i++) expect((await post(url, `stranger-${i}@orbetra.test`, 'wrong')).status).toBe(401)

    // past the ceiling most attempts are refused BEFORE argon2 — that is the CPU shed
    const before = spy.mock.calls.length
    const after: number[] = []
    for (let i = 0; i < 9; i++) after.push((await post(url, `stranger-x${i}@orbetra.test`, 'wrong')).status)
    expect(after.filter((s2) => s2 === 429).length).toBeGreaterThanOrEqual(8)
    expect(spy.mock.calls.length - before).toBeLessThanOrEqual(1)

    // …but a real user on that egress still gets through and MARKS the bucket, which restores
    // normal service for everyone behind it — the self-heal a hard refusal makes impossible
    let signedIn = false
    for (let i = 0; i < 12 && !signedIn; i++) signedIn = (await post(url, email, PW)).status === 200
    expect(signedIn).toBe(true)
    expect((await post(url, email, PW)).status).toBe(200) // marked now: no throttle at all
    spy.mockRestore()
  })

  it('…but a bucket a real user HAS signed in from is throttled, never denied', async () => {
    // A corporate NAT or a carrier CGNAT is hundreds of people behind one address, and the success
    // that repays the budget would be refused by the gate it is meant to clear. One real login
    // marks the bucket known-good; an attacker can buy that with an account of their own, and is
    // then still bounded by the hard ceiling, which no success ever refunds.
    const email = 'officeworker@orbetra.test'
    await seedUser({ databaseUrl, email, password: PW, role: 'tsp_admin', tenantName: 'T1' })
    const url = await appOn(
      { maxFails: 100, windowS: 30, maxFailsPerIp: 3, maxAttemptsPerIpHard: 100_000, maxFailIpsPerEmail: 10_000 },
      '10.9.9.11',
    )
    expect((await post(url, email, PW)).status).toBe(200) // the bucket is now known-good
    for (let i = 0; i < 4; i++) await post(url, `colleague-${i}@orbetra.test`, 'wrong')
    expect((await post(url, email, PW)).status).toBe(200) // …and the office still gets in
  })

  it('one host cannot buy unlimited argon2 verifies by varying the email — soft, then hard', async () => {
    // The per-credential key is `auth:fail:<ip>:<sha256(email)>` — DIFFERENT for every address, so
    // an attacker who never repeats an email never trips it, and each attempt still burns a full
    // argon2id verify against the process-wide 8-slot semaphore that gates every login on the
    // platform. Unlimited free CPU on the authentication path.
    const email = 'softip@orbetra.test'
    await seedUser({ databaseUrl, email, password: PW, role: 'tsp_admin', tenantName: 'T1' })
    const url = await appOn(
      { maxFails: 100, windowS: 30, maxFailsPerIp: 4, maxAttemptsPerIpHard: 20, maxFailIpsPerEmail: 10_000 },
      '10.9.9.1',
    )
    expect((await post(url, email, PW)).status).toBe(200) // a real user lives behind this address
    for (let i = 0; i < 4; i++) {
      expect((await post(url, `nobody-${i}@orbetra.test`, 'wrong')).status).toBe(401)
    }
    const blocked = await post(url, 'nobody-fresh@orbetra.test', 'wrong')
    expect(blocked.status).toBe(429) // soft ceiling: guessing from this address is closed…
    expect(Number(blocked.headers.get('retry-after'))).toBeGreaterThan(0)
    expect((await post(url, email, PW)).status).toBe(200) // …but the office behind it still works

    // keep pushing and the HARD ceiling takes over: it counts every ATTEMPT, so past it nothing is
    // verified at all and even a correct password is refused — at that volume the address is
    // indistinguishable from an attack and shedding CPU has to win
    for (let i = 0; i < 20; i++) await post(url, `flood-${i}@orbetra.test`, 'wrong')
    expect((await post(url, email, PW)).status).toBe(429)
  })

  it('the HARD ceiling cannot be refunded by logging into an account the attacker controls', async () => {
    // REGRESSION. Both per-IP tiers once shared one key, and success decayed it — so one free
    // signup bought unlimited argon2: interleave a login of your own and the counter never climbs.
    // The hard tier counts ATTEMPTS on its own key and is never repaid, so a success COSTS budget.
    const email = 'refunder@orbetra.test'
    await seedUser({ databaseUrl, email, password: PW, role: 'tsp_admin', tenantName: 'T1' })
    const url = await appOn(
      { maxFails: 100, windowS: 30, maxFailsPerIp: 10_000, maxAttemptsPerIpHard: 8, maxFailIpsPerEmail: 10_000 },
      '10.9.9.6',
    )
    for (let i = 0; i < 4; i++) {
      expect((await post(url, `mix-${i}@orbetra.test`, 'wrong')).status).toBe(401)
      expect((await post(url, email, PW)).status).toBe(200) // the interleaved "refund"
    }
    expect((await post(url, email, PW)).status).toBe(429) // 8 attempts spent, none refunded
  })

  it('distributed stuffing locks the account — one host guessing at it never can', async () => {
    // The account ceiling counts DISTINCT SOURCE IPs that failed, not failed attempts. Counting
    // attempts does not work in either placement: pre-verify, ~20 guesses from one host denied any
    // named customer their own product; post-verify, it bounds nothing at all, because a correct
    // password never reaches the check and the attacker's 200-means-right oracle is untouched.
    const email = 'stuffed@orbetra.test'
    await seedUser({ databaseUrl, email, password: PW, role: 'tsp_admin', tenantName: 'T1' })
    const url = await appOn(
      { maxFails: 1_000, windowS: 30, maxFailsPerIp: 10_000, maxAttemptsPerIpHard: 100_000, maxFailIpsPerEmail: 6 },
      '10.9.9.3',
      true,
    )
    // 40 guesses from ONE address: far past the ceiling's number, and the account stays usable —
    // this is the account-lockout weapon the distinct-IP axis exists to disarm
    for (let i = 0; i < 40; i++) await post(url, email, 'wrong', '198.51.100.7')
    expect((await post(url, email, PW, '198.51.100.7')).status).toBe(200)

    // the same 40 guesses spread over 6 addresses DO lock it: that is a botnet, and refusing
    // everyone — the owner included — is the correct answer to one
    for (let i = 0; i < 6; i++) await post(url, email, 'wrong', `203.0.113.${i}`)
    const blocked = await post(url, email, 'wrong', '203.0.113.200')
    expect(blocked.status).toBe(429)
    expect(Number(blocked.headers.get('retry-after'))).toBeGreaterThan(0)
    expect((await post(url, email, PW, '203.0.113.201')).status).toBe(429)
  })

  it('a successful login does not REFUND the per-IP failure budget — it repays one, not all', async () => {
    // Success clears the identity-scoped counter (a user who mistypes once must not be punished).
    // Clearing the per-IP one too would let an attacker wipe their whole budget; never decaying it
    // would punish a shared NAT. One-for-one.
    const email = 'ownaccount@orbetra.test'
    await seedUser({ databaseUrl, email, password: PW, role: 'tsp_admin', tenantName: 'T1' })
    const url = await appOn(
      { maxFails: 5, windowS: 30, maxFailsPerIp: 4, maxAttemptsPerIpHard: 100_000, maxFailIpsPerEmail: 10_000 },
      '10.9.9.2',
    )
    expect((await post(url, email, PW)).status).toBe(200) // known-good bucket: the soft gate throttles, never denies
    for (let i = 0; i < 4; i++) expect((await post(url, `x-${i}@orbetra.test`, 'wrong')).status).toBe(401)
    expect(await redis.get('auth:fail:ip:10.9.9.2')).toBe('4')
    expect((await post(url, 'x-4@orbetra.test', 'wrong')).status).toBe(429) // budget spent
    expect((await post(url, email, PW)).status).toBe(200) // their own, valid → repays exactly one
    // 5 failures, 1 repaid: a refund would have zeroed it and handed the attacker the budget back
    expect(await redis.get('auth:fail:ip:10.9.9.2')).toBe('4')
  })

  it('an argon2 SHED (503) refunds the budget — the server was busy, the user was not wrong', async () => {
    // REGRESSION. Moving the credential counter to increment-before-verify fixed a concurrency
    // hole but started charging requests that never compared a password: `verifyPassword` throws
    // Argon2OverloadedError (→ 503) AFTER the increment, so a CPU spike converted into a
    // 15-minute lockout for people whose password was right all along.
    const email = 'shedvictim@orbetra.test'
    await seedUser({ databaseUrl, email, password: PW, role: 'tsp_admin', tenantName: 'T1' })
    const url = await appOn(
      { maxFails: 3, windowS: 30, maxFailsPerIp: 10_000, maxAttemptsPerIpHard: 100_000, maxFailIpsPerEmail: 10_000 },
      '10.9.9.8',
    )
    const spy = vi.spyOn(passwords, 'verifyPassword').mockRejectedValue(new passwords.Argon2OverloadedError())
    for (let i = 0; i < 5; i++) expect((await post(url, email, PW)).status).toBe(503)
    spy.mockRestore()
    // five sheds against a ceiling of three: unrefunded, the next attempt would be 429
    expect((await post(url, email, PW)).status).toBe(200)
  })

  it('a lockout gate that cannot be evaluated fails OPEN, and says so (degraded is a metric, not a hole)', async () => {
    // Fail-closed would mean a Redis hiccup logs the whole platform out of its own product, which
    // for a fleet-tracking service is the worse outage. Fail-open costs brute-force protection for
    // the duration — argon2 and the process-wide semaphore are still the backstop — and the point
    // is that it is VISIBLE rather than emergent: ioredis reports per-command errors INSIDE the
    // result array instead of throwing, so an unchecked read silently scores every gate as zero.
    const gates: string[] = []
    const brokenRedis = new Proxy(redis, {
      get(t, prop, r) {
        if (prop !== 'pipeline') return Reflect.get(t, prop, r) as unknown
        return () => {
          const chain: Record<string, unknown> = {}
          for (const m of ['get', 'pfcount', 'eval']) chain[m] = () => chain
          chain['exec'] = () => Promise.resolve([[new Error('OOM command not allowed'), undefined]])
          return chain
        }
      },
    })
    const app = createApp({ ...deps, redis: brokenRedis, onLockout: (g) => gates.push(g), getRemoteAddr: () => '10.9.9.9' })
    const srv = serve({ fetch: app.fetch, port: 0, createServer }) as ReturnType<typeof createServer>
    servers.push(srv)
    const p = await new Promise<number>((r) => srv.on('listening', () => r((srv.address() as { port: number }).port)))
    // the login is still answered on its merits — not 500, not a blanket 429
    expect((await post(`http://127.0.0.1:${p}`, 'anyone@orbetra.test', 'wrong')).status).toBe(401)
    expect(gates).toContain('degraded')
  })

  it('the per-credential rule holds under a CONCURRENT burst, not just sequentially', async () => {
    // REGRESSION. The gate read the counter, spent ~120 ms in argon2, then incremented — so every
    // request in a burst read the same pre-increment value and none were refused. The real bound
    // was the argon2 admission queue (8 + 64), not five. Incrementing and gating on the same atomic
    // result is what makes the number mean anything.
    const url = await appOn(
      { maxFails: 5, windowS: 30, maxFailsPerIp: 10_000, maxAttemptsPerIpHard: 100_000, maxFailIpsPerEmail: 10_000 },
      '10.9.9.7',
    )
    const burst = await Promise.all(
      Array.from({ length: 30 }, () => post(url, 'burst@orbetra.test', 'wrong')),
    )
    const evaluated = burst.filter((r) => r.status === 401).length
    expect(evaluated).toBeLessThanOrEqual(5) // …not 30
    expect(burst.filter((r) => r.status === 429).length).toBe(30 - evaluated)
  })
})

describe('E03-1 self-service password change', () => {
  it('is rate-limited per user — two 64 MB argon2 ops behind nothing but a valid token', async () => {
    // The login route's ceilings do not cover this one, and it runs TWO hashes per request (verify
    // current + hash new), so any authenticated user of any tenant could saturate the process-wide
    // 8-slot semaphore from one session and shed 503s across every login on the platform.
    const email = 'pwchanger@orbetra.test'
    const seededUser = await seedUser({ databaseUrl, email, password: PW, role: 'tsp_admin', tenantName: 'T1' })
    const token = ((await (await login(email, PW)).json()) as AuthSession).accessToken
    const app = createApp({ ...deps, passwordChangeRateLimit: { max: 3, windowS: 60 } })
    const srv = serve({ fetch: app.fetch, port: 0, createServer }) as ReturnType<typeof createServer>
    const p = await new Promise<number>((r) => srv.on('listening', () => r((srv.address() as { port: number }).port)))
    try {
      const change = (): Promise<Response> =>
        fetch(`http://127.0.0.1:${p}/v1/auth/password`, {
          method: 'POST',
          headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
          body: JSON.stringify({ currentPassword: 'definitely-wrong', newPassword: 'newpassword123' }),
        })
      for (let i = 0; i < 3; i++) expect((await change()).status).toBe(401) // wrong current password
      const blocked = await change()
      expect(blocked.status).toBe(429)
      expect(Number(blocked.headers.get('retry-after'))).toBeGreaterThan(0)
      expect(seededUser.userId).toBeTruthy()
    } finally {
      srv.closeAllConnections?.()
      await new Promise<void>((r) => srv.close(() => r()))
    }
  })
})

describe('E03-1 ws-ticket carries the real user', () => {
  it('ticket ctx round-trips userId/tenantId/role from the JWT', async () => {
    const res = await fetch(`${base()}/v1/ws-ticket`, {
      headers: { authorization: `Bearer ${tokens.viewer}` },
    })
    const { ticket } = (await res.json()) as { ticket: string }
    const raw = await redis.get(`ticket:${ticket}`)
    const ctx = JSON.parse(raw!) as { role: string; accountId?: string }
    expect(ctx.role).toBe('viewer')
    expect(ctx.accountId).toBeDefined() // viewer is account-scoped
  })
})

describe('helpers', () => {
  it('mintTestToken produces tokens the middleware accepts (used by other specs)', async () => {
    const t = await mintTestToken({ userId: 'u1', tenantId: 't1', role: 'viewer' })
    expect(await verifyAccessToken(t, TEST_JWT_SECRET)).toMatchObject({ sub: 'u1', ten: 't1' })
  })
})
