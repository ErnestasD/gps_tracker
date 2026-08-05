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

  it('RETIRING the device revokes its live links — the public endpoint stops publishing', async () => {
    // REGRESSION (audit MED). Retiring is how an operator says "this vehicle is no longer ours",
    // and it left the UNAUTHENTICATED share endpoint serving that vehicle's last known position to
    // anyone holding the URL for up to 30 more days — while the UI no longer listed the device, so
    // nobody could find the link to revoke it by hand.
    const a = await seedDevice('RetireShare', '356307042449001')
    const live = await db.shareLinks.create(a.aScope, actor, { deviceId: a.deviceId, accountId: a.aScope.accountId, ttlHours: 24 * 30 })
    expect(await db.shareLinks.resolveByHash(hashShareToken(live.token))).not.toBeNull()

    await db.devices.retire(a.aScope, actor, a.deviceId.toString())
    expect(await db.shareLinks.resolveByHash(hashShareToken(live.token))).toBeNull()
    // …and the revocation is in the audit trail per link, not as one opaque bulk row
    const rows = await q<{ n: string }>(
      `SELECT count(*) n FROM audit_log WHERE entity='shareLink' AND "entityId"=$1 AND action='update'`,
      [live.view.id],
    )
    expect(Number(rows[0]!.n)).toBe(1)
  })

  it('retiring a device with NO links is a no-op, and an already-revoked link is not re-revoked', async () => {
    const a = await seedDevice('RetireNoShare', '356307042449002')
    const link = await db.shareLinks.create(a.aScope, actor, { deviceId: a.deviceId, accountId: a.aScope.accountId, ttlHours: 24 })
    expect(await db.shareLinks.revoke(a.aScope, actor, link.view.id)).toBe(true)
    const before = await q<{ revokedAt: Date }>(`SELECT "revokedAt" FROM share_links WHERE id=$1`, [link.view.id])
    await db.devices.retire(a.aScope, actor, a.deviceId.toString())
    const after = await q<{ revokedAt: Date }>(`SELECT "revokedAt" FROM share_links WHERE id=$1`, [link.view.id])
    expect(after[0]!.revokedAt.getTime()).toBe(before[0]!.revokedAt.getTime()) // timestamp untouched
  })

  it('retiring FREES the IMEI so returned hardware can be re-registered', async () => {
    // REGRESSION (audit MED). `imei` was globally unique with no exception for retired rows, and
    // retire is a soft delete — so a tracker that came back from a customer could never be
    // registered again, by that tenant or any other, and a mis-clicked retire was unrecoverable.
    const imei = '356307042449003'
    const a = await seedDevice('ImeiReuse', imei)
    await expect(
      db.devices.create(a.aScope, actor, { accountId: a.account.id, profileId: (await q<{ id: string }>(`SELECT id FROM device_profiles LIMIT 1`))[0]!.id, imei, name: 'Dup' }),
    ).rejects.toThrow(/already registered/i) // two ACTIVE devices still cannot share one

    await db.devices.retire(a.aScope, actor, a.deviceId.toString())
    const reclaimed = await db.devices.create(a.aScope, actor, {
      accountId: a.account.id,
      profileId: (await q<{ id: string }>(`SELECT id FROM device_profiles LIMIT 1`))[0]!.id,
      imei,
      name: 'Same tracker, new install',
    })
    expect(reclaimed.imei).toBe(imei)
    // getByImei resolves the ACTIVE row, not the retired one
    expect((await db.devices.getByImei(a.aScope, imei))?.id).toBe(reclaimed.id)
  })
})