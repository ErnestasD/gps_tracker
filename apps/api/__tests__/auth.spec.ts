import { execFileSync } from 'node:child_process'
import { createServer } from 'node:http'
import { resolve } from 'node:path'
import { serve } from '@hono/node-server'
import { Hono } from 'hono'
import { Redis } from 'ioredis'
import { GenericContainer, Wait, type StartedTestContainer } from 'testcontainers'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

import { createAuthDb, type AuthDb } from '@orbetra/db'
import { ROLES, type AuthSession, type Role } from '@orbetra/shared'

import { seedUser } from '../../../packages/db/seed/users.js'
import { createApp, type ApiDeps } from '../src/app.js'
import { verifyAccessToken } from '../src/auth/jwt.js'
import { authMiddleware, requireRole, type AuthEnv } from '../src/auth/middleware.js'
import { hashPassword, verifyPassword } from '../src/auth/passwords.js'
import * as passwords from '../src/auth/passwords.js'
import { mintTestToken, TEST_JWT_SECRET } from './helpers/auth.js'

const PG_IMAGE = 'timescale/timescaledb-ha:pg16'
const DB_PKG = resolve(import.meta.dirname, '../../../packages/db')

let pg: StartedTestContainer
let redisC: StartedTestContainer
let redis: Redis
let redisSub: Redis
let db: AuthDb
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
  db = createAuthDb(databaseUrl)

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
    lockout: { maxFails: 5, windowS: 2 }, // tiny window: unlock test needs no clock mocks
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
    const u = await db.users.findByEmailAllTenants(seeded.viewer.email)
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
})

describe('E03-1 AC[2]: role matrix (4 roles × representative endpoints)', () => {
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
})

describe('E03-1 lockout (§6.1: 5 fails → window per IP+email)', () => {
  it('5 wrong → 6th blocked with 429 EVEN with the correct password; unlocks after window', async () => {
    const email = 'locked@orbetra.test'
    await seedUser({ databaseUrl, email, password: PW, role: 'tsp_admin', tenantName: 'T1' })
    for (let i = 0; i < 5; i++) expect((await login(email, 'wrong')).status).toBe(401)
    const blocked = await login(email, PW)
    expect(blocked.status).toBe(429)
    expect(Number(blocked.headers.get('retry-after'))).toBeGreaterThan(0)
    await new Promise((r) => setTimeout(r, 2_100)) // windowS=2 in test deps
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
