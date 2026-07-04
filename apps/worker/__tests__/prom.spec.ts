import { Redis } from 'ioredis'
import { GenericContainer, Wait, type StartedTestContainer } from 'testcontainers'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { startWorkerProm } from '../src/prom.js'

let container: StartedTestContainer
let redis: Redis

beforeAll(async () => {
  container = await new GenericContainer('redis:7-alpine')
    .withExposedPorts(6379)
    .withWaitStrategy(Wait.forLogMessage(/Ready to accept connections/))
    .start()
  redis = new Redis(container.getMappedPort(6379), container.getHost(), {
    maxRetriesPerRequest: null,
  })
}, 120_000)

afterAll(async () => {
  await redis.quit()
  await container.stop()
})

describe('E02-5 worker metrics exposition (frozen names)', () => {
  it('stream_depth{shard} reflects XLEN; lag + batch histograms present', async () => {
    await redis.xadd('raw:3', '*', 'p', 'x')
    await redis.xadd('raw:3', '*', 'p', 'y')
    const prom = startWorkerProm(redis, 0)
    prom.batchRows.observe(200)
    prom.setLagMs(1234)
    const port = (prom.server.address() as { port: number }).port
    const body = await (await fetch(`http://127.0.0.1:${port}/metrics`)).text()
    prom.server.close()

    expect(body).toMatch(/stream_depth\{shard="3"\} 2/)
    expect(body).toContain('pipeline_lag_ms 1234')
    expect(body).toContain('pipeline_batch_rows_bucket')
  })
})
