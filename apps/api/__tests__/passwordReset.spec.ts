import { createHash } from 'node:crypto'
import type { Redis } from 'ioredis'
import { beforeAll, describe, expect, it, vi } from 'vitest'

import type { AuthUserRow } from '@orbetra/db'

import { createAuthRoutes, type AuthRouteDeps } from '../src/auth/login.js'
import { hashPassword, verifyPassword } from '../src/auth/passwords.js'
import { TEST_JWT_SECRET } from './helpers/auth.js'

/**
 * Forgot-password flow (ADR-031): request a link (no enumeration, rate-limited) → redeem the token
 * (single-use, short-lived, revokes every session). Fake db + redis so the security properties are
 * asserted without a container.
 */
const sha256 = (s: string): string => createHash('sha256').update(s).digest('hex')
const OLD_PW = 'correct horse battery staple'
let oldHash = ''

interface ResetRow { userId: string; tokenHash: string; expiresAt: Date; usedAt: Date | null }
type ResetJob = { kind: 'password-reset'; email: string; tenantId: string; locale: string; resetUrl: string; expiresMinutes: number }

function makeUser(over: Partial<AuthUserRow> = {}): AuthUserRow {
  return { id: 'u1', tenantId: 't1', accountId: null, email: 'u@orbetra.test', passwordHash: oldHash, role: 'tsp_admin', locale: 'en', plan: 'tsp_grow', ...over }
}

/** Minimal fake redis: `eval` = fixed-window INCR counter per key; `set` records revoke markers. */
function fakeRedis(): { redis: Redis; counters: Map<string, number>; revoked: Set<string> } {
  const counters = new Map<string, number>()
  const revoked = new Set<string>()
  const redis = {
    eval: (_script: string, _numKeys: number, key: string) => {
      const n = (counters.get(key) ?? 0) + 1
      counters.set(key, n)
      return Promise.resolve(n)
    },
    set: (key: string) => {
      if (key.startsWith('ws:revoke:')) revoked.add(key.slice('ws:revoke:'.length))
      return Promise.resolve('OK')
    },
  } as unknown as Redis
  return { redis, counters, revoked }
}

function makeDeps(users: AuthUserRow[]): {
  deps: AuthRouteDeps
  resets: Map<string, ResetRow>
  jobs: ResetJob[]
  revokeAllSpy: ReturnType<typeof vi.fn>
  revoked: Set<string>
} {
  const resets = new Map<string, ResetRow>()
  const jobs: ResetJob[] = []
  const revokeAllSpy = vi.fn()
  const { redis, revoked } = fakeRedis()
  const db = {
    users: {
      findByEmailAllTenants: (email: string) => Promise.resolve(users.filter((u) => u.email === email)),
      findByIdForAuth: (id: string) => Promise.resolve(users.find((u) => u.id === id) ?? null),
      setPassword: (id: string, hash: string) => {
        const u = users.find((x) => x.id === id)
        if (u) u.passwordHash = hash
        return Promise.resolve()
      },
    },
    refreshTokens: {
      create: () => Promise.resolve(),
      claimForRotation: () => Promise.resolve(null),
      findByTokenHash: () => Promise.resolve(null),
      revokeFamily: () => Promise.resolve(),
      revokeAllForUser: (userId: string) => { revokeAllSpy(userId); return Promise.resolve() },
    },
    passwordResetTokens: {
      create: (row: { id: string; userId: string; tokenHash: string; expiresAt: Date }) => {
        resets.set(row.tokenHash, { userId: row.userId, tokenHash: row.tokenHash, expiresAt: row.expiresAt, usedAt: null })
        return Promise.resolve()
      },
      consume: (tokenHash: string, now: Date) => {
        const r = resets.get(tokenHash)
        if (r === undefined || r.usedAt !== null || r.expiresAt <= now) return Promise.resolve(null)
        r.usedAt = now
        return Promise.resolve({ userId: r.userId })
      },
      invalidateAllForUser: (userId: string, now: Date) => {
        for (const r of resets.values()) if (r.userId === userId && r.usedAt === null) r.usedAt = now
        return Promise.resolve()
      },
    },
  }
  const deps = {
    db: db as unknown as AuthRouteDeps['db'],
    redis,
    jwtSecret: TEST_JWT_SECRET,
    jwtTtlS: 900,
    refreshTtlS: 1_209_600,
    lockout: { maxFails: 5, windowS: 900 },
    secureCookies: false,
    trustProxy: false,
    appBaseUrl: 'https://app.orbetra.test',
    resetTokenTtlS: 3_600,
    mail: { enqueueResetEmail: (job: ResetJob) => { jobs.push(job); return Promise.resolve() } },
  } as unknown as AuthRouteDeps
  return { deps, resets, jobs, revokeAllSpy, revoked }
}

const post = (app: ReturnType<typeof createAuthRoutes>, path: string, body: unknown): Response | Promise<Response> =>
  app.request(path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })

beforeAll(async () => {
  oldHash = await hashPassword(OLD_PW)
})

describe('POST /forgot-password', () => {
  it('mints a token + enqueues a branded reset link for a known email', async () => {
    const { deps, resets, jobs } = makeDeps([makeUser()])
    const app = createAuthRoutes(deps, () => '1.2.3.4')
    const res = await post(app, '/forgot-password', { email: 'U@Orbetra.test' }) // case-insensitive
    expect(res.status).toBe(200)
    expect(resets.size).toBe(1)
    expect(jobs).toHaveLength(1)
    expect(jobs[0]!.email).toBe('u@orbetra.test')
    // the raw token rides the link, and its sha256 is what we stored (never the raw)
    const url = new URL(jobs[0]!.resetUrl)
    expect(url.origin + url.pathname).toBe('https://app.orbetra.test/reset-password')
    const rawToken = url.searchParams.get('token')!
    expect(resets.has(sha256(rawToken))).toBe(true)
    expect(resets.has(rawToken)).toBe(false) // raw never stored
  })

  it('answers an identical 200 for an unknown email and enqueues nothing (no enumeration)', async () => {
    const { deps, resets, jobs } = makeDeps([makeUser()])
    const app = createAuthRoutes(deps, () => '1.2.3.4')
    const res = await post(app, '/forgot-password', { email: 'nobody@orbetra.test' })
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true })
    expect(resets.size).toBe(0)
    expect(jobs).toHaveLength(0)
  })

  it('rate-limits per IP+email: over the cap it still 200s but sends nothing', async () => {
    const { deps, jobs } = makeDeps([makeUser()])
    const app = createAuthRoutes(deps, () => '9.9.9.9')
    for (let i = 0; i < 5; i++) expect((await post(app, '/forgot-password', { email: 'u@orbetra.test' })).status).toBe(200)
    expect(jobs).toHaveLength(5)
    const over = await post(app, '/forgot-password', { email: 'u@orbetra.test' })
    expect(over.status).toBe(200) // no signal
    expect(jobs).toHaveLength(5) // …but nothing new sent
  })

  it('rejects a malformed body', async () => {
    const { deps } = makeDeps([makeUser()])
    const app = createAuthRoutes(deps, () => '1.2.3.4')
    expect((await post(app, '/forgot-password', { email: 'not-an-email' })).status).toBe(400)
  })
})

describe('POST /reset-password', () => {
  async function issueToken(deps: AuthRouteDeps, app: ReturnType<typeof createAuthRoutes>, jobs: ResetJob[]): Promise<string> {
    await post(app, '/forgot-password', { email: 'u@orbetra.test' })
    return new URL(jobs.at(-1)!.resetUrl).searchParams.get('token')!
  }

  it('redeems a valid token: sets the new password + revokes every session', async () => {
    const users = [makeUser()]
    const { deps, jobs, revokeAllSpy, revoked } = makeDeps(users)
    const app = createAuthRoutes(deps, () => '1.2.3.4')
    const token = await issueToken(deps, app, jobs)
    const res = await post(app, '/reset-password', { token, newPassword: 'a-brand-new-password' })
    expect(res.status).toBe(200)
    expect(await verifyPassword(users[0]!.passwordHash, 'a-brand-new-password')).toBe(true)
    expect(revokeAllSpy).toHaveBeenCalledWith('u1') // all refresh families revoked
    expect(revoked.has('u1')).toBe(true) // live WS torn down
  })

  it('is single-use: the same token cannot be redeemed twice', async () => {
    const { deps, jobs } = makeDeps([makeUser()])
    const app = createAuthRoutes(deps, () => '1.2.3.4')
    const token = await issueToken(deps, app, jobs)
    expect((await post(app, '/reset-password', { token, newPassword: 'a-brand-new-password' })).status).toBe(200)
    expect((await post(app, '/reset-password', { token, newPassword: 'another-new-password' })).status).toBe(400)
  })

  it('rejects an unknown token', async () => {
    const { deps } = makeDeps([makeUser()])
    const app = createAuthRoutes(deps, () => '1.2.3.4')
    expect((await post(app, '/reset-password', { token: 'deadbeef', newPassword: 'a-brand-new-password' })).status).toBe(400)
  })

  it('rejects an expired token', async () => {
    const { deps, resets, jobs } = makeDeps([makeUser()])
    const app = createAuthRoutes(deps, () => '1.2.3.4')
    const token = await issueToken(deps, app, jobs)
    resets.get(sha256(token))!.expiresAt = new Date(Date.now() - 1) // force expiry
    expect((await post(app, '/reset-password', { token, newPassword: 'a-brand-new-password' })).status).toBe(400)
  })

  it('rejects a too-short password (schema)', async () => {
    const { deps, jobs } = makeDeps([makeUser()])
    const app = createAuthRoutes(deps, () => '1.2.3.4')
    const token = await issueToken(deps, app, jobs)
    expect((await post(app, '/reset-password', { token, newPassword: 'short' })).status).toBe(400)
  })
})
