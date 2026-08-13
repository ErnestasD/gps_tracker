import { execFileSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import pg from 'pg'
import { GenericContainer, Wait, type StartedTestContainer } from 'testcontainers'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { createDb, type Db } from '../src/index.js'

/**
 * `api_keys.tenantId` had no foreign key (audit C16). Deleting a tenant therefore left its keys
 * behind, still `revokedAt: null`, and the auth path resolved one as ACTIVE and then threw in the
 * entitlement lookup — a 500 on every call rather than a clean 401, from a credential no live
 * tenant owns and no cleanup path could see.
 *
 * The claim was previously asserted only in a migration comment. It is asserted here because both
 * halves are the kind that revert silently: the `onDelete: Cascade` is one word in schema.prisma
 * that a later edit can drop while the database keeps the FK, and the orphan `DELETE` runs once,
 * on a database nobody re-reads.
 */
const IMAGE = 'timescale/timescaledb-ha:pg16'
const PKG_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const actor = { userId: '00000000-0000-0000-0000-00000000000e' }

let container: StartedTestContainer
let db: Db
let url: string

const keys = async (): Promise<{ id: string; tenantId: string }[]> => {
  const c = new pg.Client({ connectionString: url })
  await c.connect()
  try {
    return (await c.query<{ id: string; tenantId: string }>('SELECT id, "tenantId" FROM api_keys ORDER BY id')).rows
  } finally {
    await c.end()
  }
}

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

describe('api_keys → tenants foreign key', () => {
  it('deleting a tenant takes its keys with it, and leaves every other tenant\'s alone', async () => {
    const doomed = await db.tenants.create(actor, { name: 'Doomed Ltd' })
    const survivor = await db.tenants.create(actor, { name: 'Survivor Ltd' })
    await db.apiKeys.create({ tenantId: doomed.id }, actor, { name: 'doomed key', scopes: ['read'] })
    const kept = await db.apiKeys.create({ tenantId: survivor.id }, actor, { name: 'kept key', scopes: ['read'] })

    expect((await keys()).length).toBe(2)
    await db.tenants.remove(actor, doomed.id)

    // the cascade, not a repository sweep: nothing in the delete path enumerates keys
    const after = await keys()
    expect(after.map((k) => k.id)).toEqual([kept.view.id])
    expect(after[0]!.tenantId).toBe(survivor.id)
  })

  it('refuses a key pointing at a tenant that never existed — the state the 500s came from', async () => {
    const c = new pg.Client({ connectionString: url })
    await c.connect()
    try {
      await expect(
        c.query(
          `INSERT INTO api_keys(id,"tenantId",name,prefix,"hash",scopes,"createdAt") VALUES (gen_random_uuid(),$1,'orphan','orb_xx','h','{read}',now())`,
          ['00000000-0000-0000-0000-0000000000ff'],
        ),
      ).rejects.toThrow(/foreign key|api_keys_tenantId_fkey/i)
    } finally {
      await c.end()
    }
  })
})
