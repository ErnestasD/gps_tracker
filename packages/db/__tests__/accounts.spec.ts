import { execFileSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { GenericContainer, Wait, type StartedTestContainer } from 'testcontainers'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { AccountHasUsersError, createDb, type Db } from '../src/index.js'

/**
 * Accounts repo — deleting an account must NOT silently orphan its users into tenant-wide scope
 * (audit E1: the FK SetNull's their accountId, promoting an account-scoped viewer/manager to the
 * whole tenant). remove() refuses with AccountHasUsersError while the account still has users; an
 * empty account deletes cleanly.
 */
const IMAGE = 'timescale/timescaledb-ha:pg16'
const PKG_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const actor = { userId: '00000000-0000-0000-0000-00000000000e' }

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

describe('accounts repo — delete guards against orphaning users (E1)', () => {
  it('removes an EMPTY account cleanly', async () => {
    const tenant = await db.tenants.create(actor, { name: 'Empty Co' })
    const scope = { tenantId: tenant.id }
    const acct = await db.accounts.create(scope, actor, { name: 'Fleet' })
    expect(await db.accounts.remove(scope, actor, acct.id)).toBe(true)
    expect(await db.accounts.get(scope, acct.id)).toBeNull()
  })

  it('REFUSES to delete an account that still has a user (would SetNull → tenant-wide privesc)', async () => {
    const tenant = await db.tenants.create(actor, { name: 'Staffed Co' })
    const scope = { tenantId: tenant.id }
    const acct = await db.accounts.create(scope, actor, { name: 'Fleet' })
    await db.users.create(scope, actor, { email: 'am@staffed.test', passwordHash: 'argon2-hash', role: 'account_manager', accountId: acct.id })

    await expect(db.accounts.remove(scope, actor, acct.id)).rejects.toBeInstanceOf(AccountHasUsersError)
    // the account is still there — nothing was deleted
    expect(await db.accounts.get(scope, acct.id)).not.toBeNull()
  })

  it('after the user is reassigned away, the account deletes', async () => {
    const tenant = await db.tenants.create(actor, { name: 'Reassign Co' })
    const scope = { tenantId: tenant.id }
    const acctA = await db.accounts.create(scope, actor, { name: 'A' })
    const acctB = await db.accounts.create(scope, actor, { name: 'B' })
    const user = await db.users.create(scope, actor, { email: 'v@reassign.test', passwordHash: 'h', role: 'viewer', accountId: acctA.id })

    await expect(db.accounts.remove(scope, actor, acctA.id)).rejects.toBeInstanceOf(AccountHasUsersError)
    await db.users.update(scope, actor, user.id, { accountId: acctB.id }) // explicit, intentional move
    expect(await db.accounts.remove(scope, actor, acctA.id)).toBe(true)
  })
})
