import { execFileSync } from 'node:child_process'
import { resolve } from 'node:path'
import type { Pool } from 'pg'
import { GenericContainer, Wait, type StartedTestContainer } from 'testcontainers'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { createPool } from '@orbetra/db'

import { loadWebhooks } from '../src/jobs/webhookWorker.js'

/**
 * Webhook delivery must respect the tenant's PLAN, not just the `enabled` flag.
 *
 * The API refuses to create a webhook without the entitlement, but nothing stopped the ones that
 * already existed from firing — the loader selected on tenant/account/enabled and never consulted
 * the plan. So a tenant who lapsed, or downgraded to a Direct plan where `webhooks` is false, kept
 * receiving deliveries indefinitely while paying for nothing. FLOOR_ENTITLEMENTS claims to stop a
 * non-paying tenant keeping billable features; for webhooks it was decorative. Audit MED.
 */
const IMAGE = 'timescale/timescaledb-ha:pg16'
const DB_PKG = resolve(import.meta.dirname, '../../../packages/db')
let container: StartedTestContainer
let pool: Pool
const ACC = '22222222-2222-2222-2222-222222222222'

/** A tenant on `plan`/`status` with one enabled, all-kinds webhook. Returns its tenant id. */
async function seedTenantWithHook(plan: string, status: string | null): Promise<string> {
  const t = await pool.query<{ id: string }>(
    `INSERT INTO tenants (id, name, plan, "subscriptionStatus") VALUES (gen_random_uuid(), $1, $2::"TenantPlan", $3) RETURNING id`,
    [`T-${plan}-${status ?? 'null'}`, plan, status],
  )
  const tenantId = t.rows[0]!.id
  await pool.query(`INSERT INTO accounts (id, "tenantId", name, timezone) VALUES ($1, $2, 'A', 'UTC') ON CONFLICT (id) DO NOTHING`, [ACC, tenantId])
  await pool.query(
    `INSERT INTO webhooks (id,"tenantId","accountId",url,secret,events,enabled) VALUES (gen_random_uuid(),$1,$2,'https://x.test/h','s3cr3t-16-chars','{}',true)`,
    [tenantId, ACC],
  )
  return tenantId
}

beforeAll(async () => {
  container = await new GenericContainer(IMAGE)
    .withEnvironment({ POSTGRES_PASSWORD: 'test', POSTGRES_DB: 'orbetra' })
    .withExposedPorts(5432)
    .withWaitStrategy(Wait.forLogMessage(/database system is ready to accept connections/, 2))
    .withStartupTimeout(240_000)
    .start()
  const url = `postgresql://postgres:test@${container.getHost()}:${container.getMappedPort(5432)}/orbetra`
  execFileSync('pnpm', ['exec', 'prisma', 'migrate', 'deploy'], { cwd: DB_PKG, env: { ...process.env, DATABASE_URL: url }, encoding: 'utf8' })
  pool = createPool(url)
}, 300_000)

afterAll(async () => {
  await pool?.end()
  await container?.stop()
})

describe('loadWebhooks honours the tenant plan', () => {
  it('delivers for an entitled TSP tenant', async () => {
    for (const status of ['active', 'trialing', 'past_due', null]) {
      const id = await seedTenantWithHook('tsp_start', status)
      expect(await loadWebhooks(pool, id, ACC, 'panic'), `tsp_start/${status ?? 'null'}`).toHaveLength(1)
    }
  })

  it('does NOT deliver for a Direct plan — webhooks are a TSP feature', async () => {
    const id = await seedTenantWithHook('direct_10', 'active')
    expect(await loadWebhooks(pool, id, ACC, 'panic')).toHaveLength(0)
  })

  it('does NOT deliver for a LAPSED subscription, whatever the plan says', async () => {
    for (const status of ['canceled', 'unpaid', 'incomplete_expired', 'paused']) {
      const id = await seedTenantWithHook('tsp_grow', status)
      expect(await loadWebhooks(pool, id, ACC, 'panic'), status).toHaveLength(0)
    }
  })

  it('still filters on kind and enabled — the plan predicate did not replace them', async () => {
    const id = await seedTenantWithHook('tsp_start', 'active')
    await pool.query(`UPDATE webhooks SET events = '{overspeed}' WHERE "tenantId" = $1`, [id])
    expect(await loadWebhooks(pool, id, ACC, 'panic')).toHaveLength(0)
    expect(await loadWebhooks(pool, id, ACC, 'overspeed')).toHaveLength(1)
    await pool.query(`UPDATE webhooks SET enabled = false WHERE "tenantId" = $1`, [id])
    expect(await loadWebhooks(pool, id, ACC, 'overspeed')).toHaveLength(0)
  })
})
