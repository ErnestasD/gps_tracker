import { GenericContainer, Wait } from 'testcontainers'

import {
  API_PORT,
  BASE_IMEI,
  DEVICES,
  INGEST_PORT,
  REPO_ROOT,
  STUB_TOKEN,
  TSX_BIN,
  WEB_PORT,
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
  spawnChild(TSX_BIN, ['apps/api/src/main.ts'], { ...env, API_PORT: String(API_PORT), STUB_AUTH_TOKEN: STUB_TOKEN }, 'api')
  await Promise.all([waitTcp(INGEST_PORT), waitHttp(`http://127.0.0.1:${API_PORT}/healthz`)])

  // 4. seed device registry (deviceId = numeric imei; tenant matches api stub default)
  if ((await runToExit(TSX_BIN, ['tools/simulator/src/seed.ts', '--devices', String(DEVICES), '--imei', BASE_IMEI, '--redis-url', state.redisUrl], env)) !== 0)
    throw new Error('seed failed')

  // 5. build against the offline style (AC[4] env-swap proof) + preview
  // vite is apps/web's OWN devDep — its .bin lives there, not at the root
  // (root hoisting differs between local installs and CI frozen-lockfile)
  const viteBin = `${REPO_ROOT}/apps/web/node_modules/.bin/vite`
  if ((await runToExit(viteBin, ['build', 'apps/web'], { VITE_TILES_STYLE_URL: '/dev-style.json' })) !== 0)
    throw new Error('vite build failed')
  spawnChild(
    viteBin,
    ['preview', 'apps/web', '--host', '127.0.0.1', '--port', String(WEB_PORT), '--strictPort'],
    { API_PROXY_TARGET: `http://127.0.0.1:${API_PORT}` },
    'preview',
  )
  await waitHttp(`http://127.0.0.1:${WEB_PORT}/`)
}
