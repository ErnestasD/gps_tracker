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

  /**
   * The new counter must be REGISTERED and must emit — its wiring has no other coverage.
   *
   * The lesson from ingest, carried across the app boundary: two counters there were incremented on
   * real loss paths and had no exposition line for four months. Here the risk is the mirror image —
   * the counter exists and the alert exists, so a board looks healthy while `pipeline_pending_
   * evicted_total` is never emitted and `PipelinePendingEvicted` can never fire. promtool proves
   * the RULE; only this proves the SERIES.
   *
   * Asserted narrowly and on purpose. A loop over "every counter" is tempting and was written
   * first, but property names do not map to metric names, so it degenerated into an assertion that
   * could not fail — the exact shape of vacuous test this repo has already been bitten by.
   */
  it('registers and emits pipeline_pending_evicted_total, labelled by shard', async () => {
    const prom = startWorkerProm(redis, 0)
    prom.pendingEvicted.inc({ shard: '7' }, 5)
    const port = (prom.server.address() as { port: number }).port
    const body = await (await fetch(`http://127.0.0.1:${port}/metrics`)).text()
    prom.server.close()

    expect(body).toContain('# HELP pipeline_pending_evicted_total')
    // the shard label is what makes the alert name a shard instead of a rate
    expect(body).toMatch(/pipeline_pending_evicted_total\{shard="7"\} 5/)
  })
})
