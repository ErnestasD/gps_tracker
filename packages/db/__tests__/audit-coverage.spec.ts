import { execFileSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import pg from 'pg'
import { GenericContainer, Wait, type StartedTestContainer } from 'testcontainers'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { createDb, type Db } from '../src/index.js'

/**
 * E03-6 AC — "audit_log on all mutations". This is the regression guard: it drives
 * EVERY mutating repo through create/update/delete and asserts an audit_log row
 * appears with the right entity+action. A new repo (or a mutation that forgets to
 * call audit.record) leaves a gap this test turns red on. Also proves secret
 * redaction (webhook secret never lands in a before/after snapshot).
 */
const IMAGE = 'timescale/timescaledb-ha:pg16'
const PKG_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

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

describe('E03-6 audit coverage — every mutation writes an audit row', () => {
  it('drives all mutating repos and finds the matching audit_log rows', async () => {
    const actor = { userId: '00000000-0000-0000-0000-000000000001' } // audit.userId has no FK

    // ── tenant (also the FK root for everything below) ──
    const tenant = await db.tenants.create(actor, { name: 'Audit Co' })
    const tScope = { tenantId: tenant.id }

    // ── account (generic-ish, tenant-scoped) ──
    const account = await db.accounts.create(tScope, actor, { name: 'Acct A' })
    await db.accounts.update(tScope, actor, account.id, { name: 'Acct A2' })
    const aScope = { tenantId: tenant.id, accountId: account.id }

    // ── user (custom repo; passwordHash must never reach the audit snapshot) ──
    const user = await db.users.create(tScope, actor, { email: 'u@audit.test', passwordHash: 'argon2-hash', role: 'viewer', accountId: account.id })
    await db.users.update(tScope, actor, user.id, { locale: 'lt' })
    await db.users.remove(tScope, actor, user.id)

    // ── device (custom repo, account-scoped; needs a profile FK) ──
    const [profile] = await q<{ id: string }>(`INSERT INTO device_profiles(id,key,name) VALUES (gen_random_uuid(),'audit-k','P') RETURNING id`)
    const device = await db.devices.create(aScope, actor, { accountId: account.id, profileId: profile!.id, imei: '356307042440077', name: 'Truck' })
    await db.devices.update(aScope, actor, String(device.id), { name: 'Truck 2' })
    await db.devices.retire(aScope, actor, String(device.id))

    // ── rule (generic, account-scoped) ──
    const rule = await db.rules.create(aScope, actor, { accountId: account.id, kind: 'overspeed', name: 'R1' })
    await db.rules.update(aScope, actor, rule.id, { name: 'R2' })
    await db.rules.remove(aScope, actor, rule.id)

    // ── webhook (generic, tenant-scoped, secret redacted) ──
    const webhook = await db.webhooks.create(tScope, actor, { accountId: null, url: 'https://x.test/w', secret: 'super-secret-signing-key' })
    await db.webhooks.update(tScope, actor, webhook.id, { url: 'https://x.test/w2' })
    await db.webhooks.remove(tScope, actor, webhook.id)

    // ── custom domain (custom repo; setVerified = update) ──
    const domain = await db.tenantDomains.create(tScope, actor, 'audit.example.test', 'tok')
    await db.tenantDomains.setVerified(tScope, actor, domain.id)
    await db.tenantDomains.remove(tScope, actor, domain.id)

    // ── branding (tenant self-update) ──
    await db.tenants.updateBranding(actor, tenant.id, { productName: 'Audited' })

    // ── tenant update/delete (platform routes) — drive a throwaway tenant so the
    // coverage set proves these audit too (real routes: PATCH/DELETE /v1/tenants/:id) ──
    const throwaway = await db.tenants.create(actor, { name: 'Throwaway' })
    await db.tenants.update(actor, throwaway.id, { name: 'Throwaway 2' })
    await db.tenants.remove(actor, throwaway.id)

    // collect every (entity, action) pair recorded above (this fresh container has no
    // other writers; tenant:update/delete land under the throwaway tenant's id)
    const rows = await q<{ entity: string; action: string }>(`SELECT entity, action FROM audit_log`)
    const seen = new Set(rows.map((r) => `${r.entity}:${r.action}`))

    const expected = [
      'tenant:create', 'tenant:update', 'tenant:delete',
      'account:create', 'account:update',
      'user:create', 'user:update', 'user:delete',
      'device:create', 'device:update', // retire is a soft-delete → update
      'rule:create', 'rule:update', 'rule:delete',
      'webhook:create', 'webhook:update', 'webhook:delete',
      'domain:create', 'domain:update', 'domain:delete',
      'branding:update',
    ]
    for (const pair of expected) expect(seen.has(pair), `missing audit row: ${pair}`).toBe(true)
  })

  it('secrets are redacted in audit snapshots (webhook signing secret never stored raw)', async () => {
    const rows = await q<{ after: { secret?: string } | null; before: { secret?: string } | null }>(
      `SELECT before, after FROM audit_log WHERE entity = 'webhook'`,
    )
    expect(rows.length).toBeGreaterThan(0)
    for (const r of rows) {
      if (r.after?.secret !== undefined) expect(r.after.secret).toBe('***')
      if (r.before?.secret !== undefined) expect(r.before.secret).toBe('***')
    }
  })

  it('webhook list/get REDACT the secret in API responses, but delivery (raw SQL) still sees it', async () => {
    const actor = { userId: '00000000-0000-0000-0000-000000000001' }
    const t = await db.tenants.create(actor, { name: 'WH-tenant' })
    const scope = { tenantId: t.id }
    const wh = await db.webhooks.create(scope, actor, { accountId: null, url: 'https://x.test/hook', secret: 'signing-secret-abcdef123' })
    // read paths must never return the raw secret (rule 12)
    const listed = (await db.webhooks.list(scope)).find((w) => w.id === wh.id)!
    expect((listed as { secret: string }).secret).toBe('***')
    const got = await db.webhooks.get(scope, wh.id)
    expect((got as { secret: string }).secret).toBe('***')
    // but the delivery worker reads it via raw SQL and gets the real value
    const raw = await q<{ secret: string }>(`SELECT secret FROM webhooks WHERE id = $1`, [wh.id])
    expect(raw[0]!.secret).toBe('signing-secret-abcdef123')
  })

  it('user audit snapshots never contain a password hash', async () => {
    const rows = await q<{ after: Record<string, unknown> | null; before: Record<string, unknown> | null }>(
      `SELECT before, after FROM audit_log WHERE entity = 'user'`,
    )
    for (const r of rows) {
      expect(r.after ?? {}).not.toHaveProperty('passwordHash')
      expect(r.before ?? {}).not.toHaveProperty('passwordHash')
    }
  })
})
