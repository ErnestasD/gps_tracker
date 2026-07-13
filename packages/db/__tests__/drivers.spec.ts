import { execFileSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { GenericContainer, Wait, type StartedTestContainer } from 'testcontainers'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { createDb, DriverIbuttonConflictError, type Db } from '../src/index.js'

/**
 * V2 driver registry repo. Proves scoped CRUD + tenant-LOCAL iButton uniqueness: a duplicate key
 * within a tenant throws DriverIbuttonConflictError (→ API 409), but the SAME key in a DIFFERENT
 * tenant is fine (no false global clash), and multiple keyless drivers coexist.
 */
const IMAGE = 'timescale/timescaledb-ha:pg16'
const PKG_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const actor = { userId: '00000000-0000-0000-0000-00000000000d' }

let container: StartedTestContainer
let db: Db

beforeAll(async () => {
  container = await new GenericContainer(IMAGE)
    .withEnvironment({ POSTGRES_PASSWORD: 'test', POSTGRES_DB: 'orbetra' })
    .withExposedPorts(5432)
    .withWaitStrategy(Wait.forLogMessage(/database system is ready to accept connections/, 2))
    .withStartupTimeout(240_000)
    .start()
  const url = `postgresql://postgres:test@${container.getHost()}:${container.getMappedPort(5432)}/orbetra`
  execFileSync('pnpm', ['exec', 'prisma', 'migrate', 'deploy'], { cwd: PKG_DIR, env: { ...process.env, DATABASE_URL: url }, encoding: 'utf8' })
  db = createDb(url)
}, 300_000)

afterAll(async () => {
  await db?.$disconnect()
  await container?.stop()
})

async function seedTenant(name: string) {
  const tenant = await db.tenants.create(actor, { name })
  const account = await db.accounts.create({ tenantId: tenant.id }, actor, { name: `${name} Acct` })
  return { tScope: { tenantId: tenant.id }, aScope: { tenantId: tenant.id, accountId: account.id }, accountId: account.id }
}

describe('V2 drivers repo', () => {
  it('creates, lists, gets, updates and removes a driver (scoped)', async () => {
    const { tScope, aScope, accountId } = await seedTenant('Drv Co')
    const d = await db.drivers.create(aScope, actor, { accountId, name: 'Jonas', licenseNo: 'LT123', phone: '+37060000000' })
    expect(d.name).toBe('Jonas')
    expect(d.active).toBe(true)
    expect((await db.drivers.list(tScope)).map((x) => x.id)).toContain(d.id)
    expect((await db.drivers.get(aScope, d.id))?.licenseNo).toBe('LT123')
    const upd = await db.drivers.update(aScope, actor, d.id, { name: 'Jonas P.', active: false })
    expect(upd?.name).toBe('Jonas P.')
    expect(upd?.active).toBe(false)
    expect(await db.drivers.remove(aScope, actor, d.id)).toBe(true)
    expect(await db.drivers.get(aScope, d.id)).toBeNull()
    expect(await db.drivers.remove(aScope, actor, d.id)).toBe(false) // already gone
  })

  it('iButton is unique WITHIN a tenant (409-class), but the same key in another tenant is fine', async () => {
    const a = await seedTenant('Tenant A')
    const b = await seedTenant('Tenant B')
    const key = 'A1B2C3D4'
    await db.drivers.create(a.aScope, actor, { accountId: a.accountId, name: 'A1', ibutton: key })
    // same key, same tenant → conflict
    await expect(db.drivers.create(a.aScope, actor, { accountId: a.accountId, name: 'A2', ibutton: key })).rejects.toBeInstanceOf(DriverIbuttonConflictError)
    // an UPDATE that collides also throws
    const other = await db.drivers.create(a.aScope, actor, { accountId: a.accountId, name: 'A3', ibutton: 'DEADBEEF' })
    await expect(db.drivers.update(a.aScope, actor, other.id, { ibutton: key })).rejects.toBeInstanceOf(DriverIbuttonConflictError)
    // SAME key in a DIFFERENT tenant → allowed (no false global clash)
    const bDriver = await db.drivers.create(b.aScope, actor, { accountId: b.accountId, name: 'B1', ibutton: key })
    expect(bDriver.ibutton).toBe(key)
    expect((await db.drivers.findByIbutton(a.aScope, key))?.name).toBe('A1') // resolves within tenant only
  })

  it('allows multiple keyless drivers (NULL iButtons are distinct)', async () => {
    const { aScope, accountId } = await seedTenant('Keyless Co')
    await db.drivers.create(aScope, actor, { accountId, name: 'K1' })
    await db.drivers.create(aScope, actor, { accountId, name: 'K2' }) // no throw
    expect((await db.drivers.list(aScope)).length).toBe(2)
  })
})
