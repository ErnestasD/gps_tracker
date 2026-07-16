import { execFileSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import pg from 'pg'
import { GenericContainer, Wait, type StartedTestContainer } from 'testcontainers'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { createDb, type Db } from '../src/index.js'

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

const exec = async (sql: string, params?: unknown[]): Promise<void> => {
  const c = new pg.Client({ connectionString: url })
  await c.connect()
  try {
    await c.query(sql, params as never)
  } finally {
    await c.end()
  }
}
const count = async (): Promise<number> => {
  const c = new pg.Client({ connectionString: url })
  await c.connect()
  try {
    return Number((await c.query<{ n: string }>('SELECT count(*) AS n FROM webhook_deliveries')).rows[0]!.n)
  } finally {
    await c.end()
  }
}

describe('WebhookDeliveryRepo.pruneOlderThan (real Postgres)', () => {
  it('deletes only rows older than the cutoff, across multiple batches, leaving recent rows', async () => {
    const T = '11111111-1111-1111-1111-111111111111'
    const W = '22222222-2222-2222-2222-222222222222'
    // 5 old rows (100 days back) + 3 recent rows (1 day back)
    for (let i = 0; i < 5; i++) {
      await exec(`INSERT INTO webhook_deliveries("tenantId","webhookId","eventId",kind,success,at) VALUES ($1,$2,$3,'panic',true, now() - interval '100 days')`, [T, W, `old-${i}`])
    }
    for (let i = 0; i < 3; i++) {
      await exec(`INSERT INTO webhook_deliveries("tenantId","webhookId","eventId",kind,success,at) VALUES ($1,$2,$3,'panic',true, now() - interval '1 day')`, [T, W, `new-${i}`])
    }
    expect(await count()).toBe(8)

    const cutoff = new Date(Date.now() - 30 * 24 * 3_600_000) // 30 days back
    const deleted = await db.webhookDeliveries.pruneOlderThan(cutoff, 2) // batchSize 2 forces ≥3 batches
    expect(deleted).toBe(5) // only the 5 old rows
    expect(await count()).toBe(3) // the 3 recent rows survive

    // a second prune with nothing eligible is a no-op
    expect(await db.webhookDeliveries.pruneOlderThan(cutoff, 2)).toBe(0)
    expect(await count()).toBe(3)
  })
})
