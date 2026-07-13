import { execFileSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import pg from 'pg'
import { GenericContainer, Wait, type StartedTestContainer } from 'testcontainers'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { createDb, type Db } from '../src/index.js'
import { hashShareToken } from '../src/repos/shareLinks.js'

/**
 * V1-nice share links — the scoped repo + the ONE unscoped public resolve. Proves: token is
 * hashed at rest (prefix ≠ plaintext), expiry + revoke are enforced in resolveByHash (not JS),
 * and management is tenant/account scoped (another account/tenant can't revoke your link).
 */
const IMAGE = 'timescale/timescaledb-ha:pg16'
const PKG_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const actor = { userId: '00000000-0000-0000-0000-000000000009' }

let container: StartedTestContainer
let url: string
let db: Db

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
}, 300_000)

afterAll(async () => {
  await db?.$disconnect()
  await container?.stop()
})

const q = async <T extends pg.QueryResultRow>(sql: string, params?: unknown[]): Promise<T[]> => {
  const c = new pg.Client({ connectionString: url })
  await c.connect()
  try {
    return (await c.query<T>(sql, params as never)).rows
  } finally {
    await c.end()
  }
}

/** Seed a tenant + account + device; returns the scope + device id. */
async function seedDevice(name: string, imei: string) {
  const tenant = await db.tenants.create(actor, { name })
  const tScope = { tenantId: tenant.id }
  const account = await db.accounts.create(tScope, actor, { name: `${name} Acct` })
  const aScope = { tenantId: tenant.id, accountId: account.id }
  const [profile] = await q<{ id: string }>(`INSERT INTO device_profiles(id,key,name) VALUES (gen_random_uuid(),'sl-${imei}','P') RETURNING id`)
  const device = await db.devices.create(aScope, actor, { accountId: account.id, profileId: profile!.id, imei, name: 'Van' })
  return { tenant, account, tScope, aScope, deviceId: device.id }
}

describe('V1-nice shareLinks repo', () => {
  it('creates a hashed link, lists it, resolves the token to the device', async () => {
    const { tScope, aScope, deviceId } = await seedDevice('Share Co', '356307042440077')
    const { token, view } = await db.shareLinks.create(aScope, actor, { deviceId, accountId: aScope.accountId, ttlHours: 24, label: 'Courier' })

    expect(token).toMatch(/^[0-9a-f]{64}$/) // 32-byte hex, unguessable
    expect(view.prefix).toBe(token.slice(0, 8))
    expect(view.label).toBe('Courier')
    // never store the plaintext — DB holds only the hash
    const raw = await q<{ tokenHash: string; tokenPrefix: string }>(`SELECT "tokenHash","tokenPrefix" FROM share_links WHERE id=$1`, [view.id])
    expect(raw[0]!.tokenHash).toBe(hashShareToken(token))
    expect(raw[0]!.tokenHash).not.toBe(token)

    const listed = await db.shareLinks.list(tScope)
    expect(listed.map((l) => l.id)).toContain(view.id)

    const resolved = await db.shareLinks.resolveByHash(hashShareToken(token))
    expect(resolved).toMatchObject({ tenantId: tScope.tenantId, deviceId })
    expect(resolved!.expiresAt).toBe(view.expiresAt)
  })

  it('resolveByHash returns null for unknown, expired, and revoked tokens', async () => {
    const { aScope, deviceId } = await seedDevice('Expiry Co', '356307042440078')
    expect(await db.shareLinks.resolveByHash(hashShareToken('nope'))).toBeNull()

    // expired: create, then push expiresAt into the past (SQL enforces expiresAt > now)
    const exp = await db.shareLinks.create(aScope, actor, { deviceId, accountId: aScope.accountId, ttlHours: 1 })
    await q(`UPDATE share_links SET "expiresAt" = now() - interval '1 hour' WHERE id=$1`, [exp.view.id])
    expect(await db.shareLinks.resolveByHash(hashShareToken(exp.token))).toBeNull()

    // revoked
    const rev = await db.shareLinks.create(aScope, actor, { deviceId, accountId: aScope.accountId, ttlHours: 24 })
    expect(await db.shareLinks.revoke(aScope, actor, rev.view.id)).toBe(true)
    expect(await db.shareLinks.resolveByHash(hashShareToken(rev.token))).toBeNull()
    // second revoke is a no-op
    expect(await db.shareLinks.revoke(aScope, actor, rev.view.id)).toBe(false)
  })

  it('scopes strictly: another tenant/account cannot see or revoke your link', async () => {
    const a = await seedDevice('Tenant A', '356307042440079')
    const b = await seedDevice('Tenant B', '356307042440080')
    const { view } = await db.shareLinks.create(a.aScope, actor, { deviceId: a.deviceId, accountId: a.aScope.accountId, ttlHours: 24 })

    // cross-TENANT: B's scope sees nothing and can't revoke A's link
    expect((await db.shareLinks.list(b.tScope)).map((l) => l.id)).not.toContain(view.id)
    expect(await db.shareLinks.revoke(b.aScope, actor, view.id)).toBe(false)

    // cross-ACCOUNT within tenant A: a different account can't revoke it
    const otherAcct = await db.accounts.create(a.tScope, actor, { name: 'Other Acct' })
    const otherScope = { tenantId: a.tenant.id, accountId: otherAcct.id }
    expect(await db.shareLinks.revoke(otherScope, actor, view.id)).toBe(false)
    // but the resolve (public, unscoped) still works — the token is the capability
    expect(await db.shareLinks.resolveByHash(hashShareToken((await db.shareLinks.create(a.aScope, actor, { deviceId: a.deviceId, accountId: a.aScope.accountId, ttlHours: 24 })).token))).not.toBeNull()
  })
})
