import { execFileSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import pg from 'pg'
import { GenericContainer, Wait, type StartedTestContainer } from 'testcontainers'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { createDb, type Db } from '../src/index.js'

/**
 * SMS gateway delivery repo (SMS gateway feature). Proves scoped create/read, the worker
 * queued→sent|failed transitions, provider default, and cross-tenant isolation (a sibling tenant
 * can never read another tenant's SMS delivery rows). Mirrors the command/maintenance repo tests.
 */
const IMAGE = 'timescale/timescaledb-ha:pg16'
const PKG_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const actor = { userId: '00000000-0000-0000-0000-00000000000f' }

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
  execFileSync('pnpm', ['exec', 'tsx', 'sql/migrate.ts'], { cwd: PKG_DIR, env: { ...process.env, DATABASE_URL: url }, encoding: 'utf8' })
  db = createDb(url)
}, 300_000)

afterAll(async () => {
  await db?.$disconnect()
  await container?.stop()
})

const q = async <T extends pg.QueryResultRow>(sql: string, params?: unknown[]): Promise<T[]> => {
  const c = new pg.Client({ connectionString: url })
  await c.connect()
  try { return (await c.query<T>(sql, params as never)).rows } finally { await c.end() }
}

async function seed(name: string, imei: string) {
  const tenant = await db.tenants.create(actor, { name })
  const account = await db.accounts.create({ tenantId: tenant.id }, actor, { name: `${name} A` })
  const aScope = { tenantId: tenant.id, accountId: account.id }
  const [prof] = await q<{ id: string }>(`INSERT INTO device_profiles(id,key,name) VALUES (gen_random_uuid(),'sms-${imei}','P') RETURNING id`)
  const device = await db.devices.create(aScope, actor, { accountId: account.id, profileId: prof!.id, imei, name: 'Van', simMsisdn: '+37060000000' })
  return { tenant, account, aScope, deviceId: device.id }
}

describe('SMS delivery repo (SMS gateway)', () => {
  it('creates a queued row (provider defaults twilio), reads it scoped, drives it to sent', async () => {
    const s = await seed('SMS Co', '356307042461001')
    const row = await db.smsDeliveries.create(s.aScope, { deviceId: s.deviceId, accountId: s.account.id, to: '+37060000000', body: '  setparam 2004:orbetra.com;2005:5027;2006:0' })
    expect(row.status).toBe('queued')
    expect(row.provider).toBe('twilio')
    expect(row.providerMessageId).toBeNull()
    expect(row.sentAt).toBeNull()

    expect(await db.smsDeliveries.get(s.aScope, row.id)).not.toBeNull()
    expect((await db.smsDeliveries.listForDevice(s.aScope, s.deviceId)).map((r) => r.id)).toContain(row.id)

    const sent = await db.smsDeliveries.markSent(row.id, 'SM123')
    expect(sent?.status).toBe('sent')
    expect(sent?.providerMessageId).toBe('SM123')
    expect(sent?.sentAt).not.toBeNull()
  })

  it('markFailed records a terminal failure with the error', async () => {
    const s = await seed('SMS Fail Co', '356307042461002')
    const row = await db.smsDeliveries.create(s.aScope, { deviceId: s.deviceId, accountId: s.account.id, to: '+37060000000', body: 'x', provider: 'twilio' })
    const failed = await db.smsDeliveries.markFailed(row.id, 'twilio 21211 invalid To')
    expect(failed?.status).toBe('failed')
    expect(failed?.error).toBe('twilio 21211 invalid To')
  })

  it('mark* on an unknown id returns null (worker owns a real id; a bad one never throws)', async () => {
    expect(await db.smsDeliveries.markSent('11111111-1111-4111-8111-111111111111', 'SM')).toBeNull()
    expect(await db.smsDeliveries.markFailed('not-a-uuid', 'e')).toBeNull()
  })

  it('scopes strictly: another tenant cannot see the delivery', async () => {
    const a = await seed('Tenant A', '356307042461003')
    const b = await seed('Tenant B', '356307042461004')
    const row = await db.smsDeliveries.create(a.aScope, { deviceId: a.deviceId, accountId: a.account.id, to: '+37060000000', body: 'x' })
    expect(await db.smsDeliveries.get(b.aScope, row.id)).toBeNull()
    expect((await db.smsDeliveries.listForDevice(b.aScope, a.deviceId)).map((r) => r.id)).not.toContain(row.id)
  })
})
