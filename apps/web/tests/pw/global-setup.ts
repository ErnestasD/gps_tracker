import { GenericContainer, Wait } from 'testcontainers'

import {
  API_PORT,
  BASE_IMEI,
  E2E_EMAIL,
  E2E_JWT_SECRET,
  E2E_PASSWORD,
  INGEST_PORT,
  PLATFORM_EMAIL,
  PLATFORM_PASSWORD,
  SEEDED_DEVICES,
  REPO_ROOT,
  TSX_BIN,
  WEB_PORT,
  runCapture,
  runToExit,
  spawnChild,
  state,
  waitHttp,
  waitTcp,
} from './stack'

const PG_IMAGE = 'timescale/timescaledb-ha:pg16' // same pin as packages/db tests

export default async function globalSetup(): Promise<void> {
  try {
    await setup()
  } catch (err) {
    // Playwright does NOT run globalTeardown when globalSetup throws (review MED):
    // reap spawned processes ourselves; Ryuk reaps the containers
    for (const child of state.children) child.kill('SIGKILL')
    throw err
  }
}

async function setup(): Promise<void> {
  // 1. infra containers
  const [redis, pg] = await Promise.all([
    new GenericContainer('redis:7-alpine')
      .withExposedPorts(6379)
      .withWaitStrategy(Wait.forLogMessage(/Ready to accept connections/))
      .start(),
    new GenericContainer(PG_IMAGE)
      .withEnvironment({ POSTGRES_PASSWORD: 'e2e', POSTGRES_DB: 'orbetra' })
      .withExposedPorts(5432)
      .withWaitStrategy(Wait.forLogMessage(/database system is ready to accept connections/, 2))
      .start(),
  ])
  state.containers.push(redis, pg)
  state.redisUrl = `redis://${redis.getHost()}:${redis.getMappedPort(6379)}`
  state.databaseUrl = `postgresql://postgres:e2e@${pg.getHost()}:${pg.getMappedPort(5432)}/orbetra`

  // 2. migrations (same two steps as the Makefile)
  const env = { DATABASE_URL: state.databaseUrl, REDIS_URL: state.redisUrl }
  // prisma is hoisted into packages/db (workspace dep), not the root .bin
  if ((await runToExit(`${REPO_ROOT}/packages/db/node_modules/.bin/prisma`, ['migrate', 'deploy', '--schema', 'packages/db/prisma/schema.prisma'], env)) !== 0)
    throw new Error('prisma migrate deploy failed')
  if ((await runToExit(TSX_BIN, ['packages/db/sql/migrate.ts'], env)) !== 0)
    throw new Error('sql migrate failed')

  // 3. pipeline processes (prom ports offset — a founder dev stack may be running)
  spawnChild(TSX_BIN, ['apps/ingest/src/main.ts'], { ...env, INGEST_TCP_PORT: String(INGEST_PORT), PROMETHEUS_PORT: '9151' }, 'ingest')
  spawnChild(TSX_BIN, ['apps/worker/src/main.ts'], { ...env, PROMETHEUS_PORT: '9152' }, 'worker')
  spawnChild(
    TSX_BIN,
    ['apps/api/src/main.ts'],
    // the SPA is served on WEB_PORT and its /v1 calls are proxied to the API on API_PORT, so the
    // browser Origin (WEB_PORT) differs from the API Host (API_PORT) — trust it for the CSRF guard
    { ...env, API_PORT: String(API_PORT), JWT_SECRET: E2E_JWT_SECRET, COOKIE_SECURE: '0', AUTH_TRUSTED_ORIGINS: `127.0.0.1:${WEB_PORT},localhost:${WEB_PORT}` },
    'api',
  )
  await Promise.all([waitTcp(INGEST_PORT), waitHttp(`http://127.0.0.1:${API_PORT}/healthz`)])

  // 4a. seed the e2e login user (E03-1) — its tenantId must reach device:tenant.
  // --account-name gives the tenant an account so the Devices create form (E03-3) has
  // one to target, and device profiles are seeded so the profile picker is populated.
  const seedUser = await runCapture(
    TSX_BIN,
    ['packages/db/seed/users.ts', '--email', E2E_EMAIL, '--password', E2E_PASSWORD, '--role', 'tsp_admin', '--tenant-name', 'E2E', '--account-name', 'E2E Fleet'],
    env,
  )
  if (seedUser.code !== 0) throw new Error('user seed failed')
  const { tenantId } = JSON.parse(seedUser.stdout) as { tenantId: string }
  if ((await runToExit(TSX_BIN, ['packages/db/seed/profiles.ts'], env)) !== 0)
    throw new Error('profiles seed failed')
  // a platform_admin (same tenant) for the E03-4 quarantine flow
  if ((await runToExit(TSX_BIN, ['packages/db/seed/users.ts', '--email', PLATFORM_EMAIL, '--password', PLATFORM_PASSWORD, '--role', 'platform_admin', '--tenant-name', 'E2E'], env)) !== 0)
    throw new Error('platform user seed failed')

  // 4b. seed device registry (deviceId = numeric imei) into the login user's tenant
  if ((await runToExit(TSX_BIN, ['tools/simulator/src/seed.ts', '--devices', String(SEEDED_DEVICES), '--imei', BASE_IMEI, '--tenant', tenantId, '--redis-url', state.redisUrl], env)) !== 0)
    throw new Error('device seed failed')

  // 5. build against the offline style (AC[4] env-swap proof) + preview
  // vite is apps/web's OWN devDep — its .bin lives there, not at the root
  // (root hoisting differs between local installs and CI frozen-lockfile)
  // Both theme styles point at the offline dev style — no Mapbox tile network in e2e;
  // hermetic e2e: dummy token (offline dev-style.json — no Mapbox endpoint is ever hit)
  const viteBin = `${REPO_ROOT}/apps/web/node_modules/.bin/vite`
  if ((await runToExit(viteBin, ['build', 'apps/web'], { VITE_MAPBOX_STYLE_DARK: '/dev-style.json', VITE_MAPBOX_STYLE_LIGHT: '/dev-style.json', VITE_MAPBOX_TOKEN: 'pk.e2e-dummy-offline' })) !== 0)
    throw new Error('vite build failed')
  spawnChild(
    viteBin,
    ['preview', 'apps/web', '--host', '127.0.0.1', '--port', String(WEB_PORT), '--strictPort'],
    { API_PROXY_TARGET: `http://127.0.0.1:${API_PORT}` },
    'preview',
  )
  await waitHttp(`http://127.0.0.1:${WEB_PORT}/`)
}
