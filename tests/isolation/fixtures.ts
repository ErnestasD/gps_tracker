import { execFileSync } from 'node:child_process'
import { createServer } from 'node:http'
import { resolve } from 'node:path'
import { serve } from '@hono/node-server'
import { Redis } from 'ioredis'
import { GenericContainer, Wait, type StartedTestContainer } from 'testcontainers'

import { apiManifest, createApp, mintAccessToken } from '@orbetra/api'
import { hashPassword } from '@orbetra/api'
import { createDb, createPool, type Db } from '@orbetra/db'
import type { Role } from '@orbetra/shared'

import { seedProfiles } from '../../packages/db/seed/profiles.js'

const PG_IMAGE = 'timescale/timescaledb-ha:pg16'
const DB_PKG = resolve(import.meta.dirname, '../../packages/db')
export const JWT_SECRET = 'isolation-suite-secret-isolation-suite!' // ≥32

export interface TenantFixture {
  id: string
  accounts: [string, string] // [A1, A2]
  ruleId: string
  ruleA2Id: string // a rule owned by A2 (for account cross-account tests)
  deviceId: string
  domainId: string
  webhookId: string
  userId: string // an account-scoped (A1) user
  amUserId: string // the account_manager's OWN user id (self-escalation test)
  eventId: string
  /** platform_admin token (tenant-wide). */
  tokenPlatform: string
  /** tsp_admin token (tenant-wide, NOT platform). */
  tokenTenant: string
  /** account_manager token pinned to A1. */
  tokenAccountA1: string
  /** viewer token pinned to A1 (write-authorization tests). */
  tokenViewerA1: string
}

export interface Fixtures {
  baseUrl: string
  manifest: ReturnType<typeof apiManifest>
  t1: TenantFixture
  t2: TenantFixture
  stop(): Promise<void>
}

const token = (userId: string, tenantId: string, role: Role, accountId?: string) =>
  mintAccessToken(
    { sub: userId, ten: tenantId, role, ...(accountId !== undefined ? { acc: accountId } : {}) },
    JWT_SECRET,
    900,
  )

async function seedTenant(
  db: Db,
  poolInsertEvent: (t: string, a: string, dev: string) => Promise<string>,
  name: string,
  profileId: string,
  imei: string,
): Promise<TenantFixture> {
  const actor = { userId: '00000000-0000-0000-0000-000000000000' } // audit userId is a uuid column
  const tenant = await db.tenants.create(actor, { name })
  const scope = { tenantId: tenant.id }
  const a1 = await db.accounts.create(scope, actor, { name: `${name}-A1` })
  const a2 = await db.accounts.create(scope, actor, { name: `${name}-A2` })
  const rule = await db.rules.create(scope, actor, { accountId: a1.id, kind: 'overspeed', name: 'r' })
  // a rule under A2 too, so account-scope tests have an out-of-account target
  const ruleA2 = await db.rules.create(scope, actor, { accountId: a2.id, kind: 'overspeed', name: 'r2' })
  const device = await db.devices.create(scope, actor, { accountId: a1.id, profileId, imei, name: 'dev' })
  const domain = await db.tenantDomains.create(scope, actor, `${name.toLowerCase()}.example.test`, 'tok')
  const webhook = await db.webhooks.create(scope, actor, { accountId: a1.id, url: 'https://x.test/h', secret: 'secret-secret-16' })
  const pwHash = await hashPassword('irrelevant-not-logging-in')
  const platform = await db.users.create(scope, actor, { email: `${name}-pa@x.test`, passwordHash: pwHash, role: 'platform_admin', accountId: null })
  const tsp = await db.users.create(scope, actor, { email: `${name}-ta@x.test`, passwordHash: pwHash, role: 'tsp_admin', accountId: null })
  const am = await db.users.create(scope, actor, { email: `${name}-am@x.test`, passwordHash: pwHash, role: 'account_manager', accountId: a1.id })
  const vw = await db.users.create(scope, actor, { email: `${name}-vw@x.test`, passwordHash: pwHash, role: 'viewer', accountId: a1.id })
  const eventId = await poolInsertEvent(tenant.id, a1.id, '1')
  return {
    id: tenant.id,
    accounts: [a1.id, a2.id],
    ruleId: rule.id,
    ruleA2Id: ruleA2.id,
    deviceId: device.id.toString(),
    domainId: domain.id,
    webhookId: webhook.id,
    userId: am.id,
    amUserId: am.id,
    eventId,
    tokenPlatform: await token(platform.id, tenant.id, 'platform_admin'),
    tokenTenant: await token(tsp.id, tenant.id, 'tsp_admin'),
    tokenAccountA1: await token(am.id, tenant.id, 'account_manager', a1.id),
    tokenViewerA1: await token(vw.id, tenant.id, 'viewer', a1.id),
  }
}

export async function setup(): Promise<Fixtures> {
  const containers: StartedTestContainer[] = []
  const [pg, redisC] = await Promise.all([
    new GenericContainer(PG_IMAGE)
      .withEnvironment({ POSTGRES_PASSWORD: 'test', POSTGRES_DB: 'orbetra' })
      .withExposedPorts(5432)
      .withWaitStrategy(Wait.forLogMessage(/database system is ready to accept connections/, 2))
      .withStartupTimeout(240_000)
      .start(),
    new GenericContainer('redis:7-alpine').withExposedPorts(6379).withWaitStrategy(Wait.forLogMessage(/Ready to accept connections/)).start(),
  ])
  containers.push(pg, redisC)
  const databaseUrl = `postgresql://postgres:test@${pg.getHost()}:${pg.getMappedPort(5432)}/orbetra`
  execFileSync('pnpm', ['exec', 'prisma', 'migrate', 'deploy'], { cwd: DB_PKG, env: { ...process.env, DATABASE_URL: databaseUrl } })

  const redis = new Redis(redisC.getMappedPort(6379), redisC.getHost(), { maxRetriesPerRequest: null })
  const redisSub = redis.duplicate()
  const db = createDb(databaseUrl)
  const pool = createPool(databaseUrl)

  // events have no create API (pipeline-generated) — insert fixtures via the raw
  // SQL side (createPool), NOT @prisma/client (which the lint-proof test forbids here)
  const insertEvent = async (tenantId: string, accountId: string, deviceId: string): Promise<string> => {
    // Prisma keeps camelCase column names (quoted) — matches 0_init migration
    const r = await pool.query(
      `INSERT INTO events ("tenantId","accountId","deviceId","kind","at") VALUES ($1,$2,$3,'test',now()) RETURNING id`,
      [tenantId, accountId, deviceId],
    )
    return String((r.rows[0] as { id: string | number }).id)
  }

  const app = createApp({
    redis,
    redisSub,
    db,
    jwtSecret: JWT_SECRET,
    jwtTtlS: 900,
    refreshTtlS: 3600,
    ticketTtlS: 30,
    lockout: { maxFails: 100, windowS: 900 },
    secureCookies: false,
    trustProxy: false,
    getRemoteAddr: () => '127.0.0.1',
  })
  const server = serve({ fetch: app.fetch, port: 0, createServer }) as ReturnType<typeof createServer>
  const port = await new Promise<number>((r) => server.on('listening', () => r((server.address() as { port: number }).port)))

  const profileIds = await seedProfiles(databaseUrl)
  const profileId = profileIds['fmb1xx']!
  const t1 = await seedTenant(db, insertEvent, 'T1', profileId, '356307042440000')
  const t2 = await seedTenant(db, insertEvent, 'T2', profileId, '356307042440001')

  return {
    baseUrl: `http://127.0.0.1:${port}`,
    manifest: apiManifest(),
    t1,
    t2,
    stop: async () => {
      server.closeAllConnections?.()
      await new Promise<void>((r) => server.close(() => r()))
      await pool.end()
      await db.$disconnect()
      await redis.quit()
      await redisSub.quit()
      await Promise.all(containers.map((c) => c.stop()))
    },
  }
}
