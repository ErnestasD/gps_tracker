import { describe, expect, it } from 'vitest'
import type { Redis } from 'ioredis'

import type { Db } from '@orbetra/db'

import { createApp } from '../src/app.js'
import { fakeDb, mintTestToken, TEST_JWT_SECRET } from './helpers/auth.js'

/**
 * Audit remediation, route-level (no containers — a fake Db + stub Redis exercises the guards):
 *  - HIGH user-mutation privilege escalation: the PATCH/DELETE /v1/users tier guard (crud.ts)
 *  - HIGH device-import row cap (crud.ts + deviceImport.ts)
 *  - MED global request body-size limit (app.ts) → 413
 *  - LOW auth CSRF: same-origin guard on the cookie-bearing auth POSTs (login.ts)
 */

type Urow = { id: string; tenantId: string; accountId: string | null; email: string; role: 'platform_admin' | 'tsp_admin' | 'account_manager' | 'viewer'; locale: string; createdAt: Date }

// tenant 'T' co-resident users — the whole point of the HIGH finding is that a platform_admin
// shares a tenant with the attacking tsp_admin and is reachable by the tenant-scoped repo.
function seedUsers(): Urow[] {
  const now = new Date()
  return [
    { id: 'pa', tenantId: 'T', accountId: null, email: 'pa@t.test', role: 'platform_admin', locale: 'en', createdAt: now },
    { id: 'pa2', tenantId: 'T', accountId: null, email: 'pa2@t.test', role: 'platform_admin', locale: 'en', createdAt: now },
    { id: 'ta', tenantId: 'T', accountId: null, email: 'ta@t.test', role: 'tsp_admin', locale: 'en', createdAt: now },
    { id: 'vw', tenantId: 'T', accountId: null, email: 'vw@t.test', role: 'viewer', locale: 'en', createdAt: now },
  ]
}

function buildDb(users: Urow[]): Db {
  const db = fakeDb()
  const scoped = (scope: { tenantId: string; accountId?: string }, id: string) =>
    users.find((u) => u.tenantId === scope.tenantId && u.id === id && (scope.accountId === undefined || u.accountId === scope.accountId)) ?? null
  db.users = {
    list: (scope) => Promise.resolve(users.filter((u) => u.tenantId === scope.tenantId)),
    get: (scope, id) => Promise.resolve(scoped(scope, id)),
    create: () => Promise.reject(new Error('unused')),
    update: (scope, _actor, id, data) => {
      const row = scoped(scope, id)
      if (row === null) return Promise.resolve(null)
      if (data.role !== undefined) row.role = data.role
      if (data.locale !== undefined) row.locale = data.locale
      return Promise.resolve({ ...row })
    },
    remove: (scope, _actor, id) => Promise.resolve(scoped(scope, id) !== null),
  }
  db.profiles = { ...db.profiles, map: () => Promise.resolve(new Map<string, string>()) }
  return db
}

// a minimal functional stub so login's lockout gate / best-effort markers don't throw
const stub = {
  get: () => Promise.resolve(null),
  set: () => Promise.resolve('OK'),
  del: () => Promise.resolve(0),
  eval: () => Promise.resolve(1),
  incr: () => Promise.resolve(1),
  expire: () => Promise.resolve(1),
  ttl: () => Promise.resolve(-1),
  mget: () => Promise.resolve([]),
} as unknown as Redis
const appFor = (users: Urow[]) =>
  createApp({ redis: stub, redisSub: stub, db: buildDb(users), jwtSecret: TEST_JWT_SECRET, jwtTtlS: 900, refreshTtlS: 3600, lockout: { maxFails: 5, windowS: 900 }, secureCookies: false, trustProxy: false, getRemoteAddr: () => '127.0.0.1' })

const authHdr = (t: string) => ({ authorization: `Bearer ${t}`, 'content-type': 'application/json' })

describe('audit HIGH: user-mutation privilege escalation / account takeover', () => {
  it('tsp_admin CANNOT password-reset a co-tenant platform_admin (403)', async () => {
    const app = appFor(seedUsers())
    const tok = await mintTestToken({ userId: 'ta', tenantId: 'T', role: 'tsp_admin' })
    const res = await app.request('/v1/users/pa', { method: 'PATCH', headers: authHdr(tok), body: JSON.stringify({ password: 'a-new-strong-password' }) })
    expect(res.status).toBe(403)
  })

  it('tsp_admin CANNOT demote a platform_admin (403 — canGrantRole would have allowed it)', async () => {
    const app = appFor(seedUsers())
    const tok = await mintTestToken({ userId: 'ta', tenantId: 'T', role: 'tsp_admin' })
    const res = await app.request('/v1/users/pa', { method: 'PATCH', headers: authHdr(tok), body: JSON.stringify({ role: 'viewer' }) })
    expect(res.status).toBe(403)
  })

  it('tsp_admin CANNOT delete a platform_admin (403 — DELETE had no tier check)', async () => {
    const app = appFor(seedUsers())
    const tok = await mintTestToken({ userId: 'ta', tenantId: 'T', role: 'tsp_admin' })
    const res = await app.request('/v1/users/pa', { method: 'DELETE', headers: authHdr(tok) })
    expect(res.status).toBe(403)
  })

  it('tsp_admin CAN still manage a lower-tier viewer (200, incl. password reset)', async () => {
    const app = appFor(seedUsers())
    const tok = await mintTestToken({ userId: 'ta', tenantId: 'T', role: 'tsp_admin' })
    expect((await app.request('/v1/users/vw', { method: 'PATCH', headers: authHdr(tok), body: JSON.stringify({ locale: 'lt' }) })).status).toBe(200)
    // password reset also succeeds (the WS-revoke marker is best-effort over a stub redis)
    expect((await app.request('/v1/users/vw', { method: 'PATCH', headers: authHdr(tok), body: JSON.stringify({ password: 'a-new-strong-password' }) })).status).toBe(200)
    expect((await app.request('/v1/users/vw', { method: 'DELETE', headers: authHdr(tok) })).status).toBe(200)
  })

  it('a self-edit still works (tsp_admin editing own record, 200)', async () => {
    const app = appFor(seedUsers())
    const tok = await mintTestToken({ userId: 'ta', tenantId: 'T', role: 'tsp_admin' })
    expect((await app.request('/v1/users/ta', { method: 'PATCH', headers: authHdr(tok), body: JSON.stringify({ locale: 'lt' }) })).status).toBe(200)
  })

  it('platform_admin can manage anyone, including a peer platform_admin (200)', async () => {
    const app = appFor(seedUsers())
    const tok = await mintTestToken({ userId: 'pa', tenantId: 'T', role: 'platform_admin' })
    expect((await app.request('/v1/users/pa2', { method: 'PATCH', headers: authHdr(tok), body: JSON.stringify({ locale: 'lt' }) })).status).toBe(200)
    expect((await app.request('/v1/users/ta', { method: 'DELETE', headers: authHdr(tok) })).status).toBe(200)
  })
})

describe('audit HIGH: device-import row cap (DoS via tens of thousands of sequential inserts)', () => {
  it('rejects an import over 1,000 rows with 400 (before any DB work)', async () => {
    const app = appFor(seedUsers())
    const tok = await mintTestToken({ userId: 'ta', tenantId: 'T', role: 'tsp_admin' })
    const csv = 'imei,name,profileKey\n' + Array.from({ length: 1001 }, (_, i) => `86000000000${String(1000 + i)},Dev${i},teltonika`).join('\n')
    const res = await app.request('/v1/devices/import', { method: 'POST', headers: authHdr(tok), body: JSON.stringify({ csv }) })
    expect(res.status).toBe(400)
    expect((await res.json() as { detail?: string }).detail).toContain('too many rows')
  })

  it('the same cap applies to the preview route', async () => {
    const app = appFor(seedUsers())
    const tok = await mintTestToken({ userId: 'ta', tenantId: 'T', role: 'tsp_admin' })
    const csv = 'imei,name,profileKey\n' + Array.from({ length: 1001 }, (_, i) => `86000000000${String(1000 + i)},Dev${i},teltonika`).join('\n')
    const res = await app.request('/v1/devices/import/preview', { method: 'POST', headers: authHdr(tok), body: JSON.stringify({ csv }) })
    expect(res.status).toBe(400)
  })
})

describe('audit MED: global request body-size limit', () => {
  it('a >1 MB body to a normal /v1 route is rejected 413', async () => {
    const app = appFor(seedUsers())
    const tok = await mintTestToken({ userId: 'ta', tenantId: 'T', role: 'tsp_admin' })
    const big = 'a'.repeat(2 * 1024 * 1024) // 2 MB
    const res = await app.request('/v1/users/vw', { method: 'PATCH', headers: authHdr(tok), body: JSON.stringify({ locale: big }) })
    expect(res.status).toBe(413)
  })

  it('the import route gets a HIGHER ceiling — a 1.5 MB CSV is NOT 413 (row cap 400 instead)', async () => {
    const app = appFor(seedUsers())
    const tok = await mintTestToken({ userId: 'ta', tenantId: 'T', role: 'tsp_admin' })
    const csv = 'imei,name,profileKey\n' + 'x,y,z\n'.repeat(260_000) // ~1.5 MB, >1000 rows
    const res = await app.request('/v1/devices/import', { method: 'POST', headers: authHdr(tok), body: JSON.stringify({ csv }) })
    expect(res.status).not.toBe(413)
    expect(res.status).toBe(400) // passed the 3 MB limit, tripped the row cap
  })
})

describe('audit LOW: auth CSRF same-origin guard', () => {
  it('rejects a cross-origin login (403) — session-fixation vector', async () => {
    const app = appFor(seedUsers())
    const res = await app.request('/v1/auth/login', {
      method: 'POST',
      headers: { 'content-type': 'text/plain', origin: 'https://evil.example', host: 'app.orbetra.test' },
      body: JSON.stringify({ email: 'ta@t.test', password: 'whatever12' }),
    })
    expect(res.status).toBe(403)
  })

  it('rejects a cross-origin refresh (403)', async () => {
    const app = appFor(seedUsers())
    const res = await app.request('/v1/auth/refresh', { method: 'POST', headers: { origin: 'https://evil.example', host: 'app.orbetra.test', cookie: 'orb_refresh=x' } })
    expect(res.status).toBe(403)
  })

  it('a same-origin request passes the guard (not 403)', async () => {
    const app = appFor(seedUsers())
    const res = await app.request('/v1/auth/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: 'https://app.orbetra.test', host: 'app.orbetra.test' },
      body: JSON.stringify({ email: 'nobody@t.test', password: 'whatever12' }),
    })
    expect(res.status).not.toBe(403) // 401 (bad creds) — but the CSRF guard let it through
  })

  it('a request with NO Origin/Referer (non-browser client) passes the guard', async () => {
    const app = appFor(seedUsers())
    const res = await app.request('/v1/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: 'nobody@t.test', password: 'whatever12' }) })
    expect(res.status).not.toBe(403)
  })
})
