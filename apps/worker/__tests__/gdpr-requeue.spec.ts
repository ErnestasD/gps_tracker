import { Queue, Worker } from 'bullmq'
import { GenericContainer, Wait, type StartedTestContainer } from 'testcontainers'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { enqueueNotify, createNotifyQueue } from '../src/jobs/notifyQueue.js'
import { enqueueWebhook, createWebhookQueue } from '../src/jobs/webhookQueue.js'

/**
 * E08-4 review HIGH-2 regression: with removeOnFail:TRUE (the api producer's setting), a
 * gdpr job that exhausts its attempts must NOT park in the failed set and block its jobId —
 * a later POST re-enqueues and the job actually runs. With the old removeOnFail:100 the
 * second add() was a silent no-op and the API 202'd forever over a dead erase.
 */
let redisC: StartedTestContainer
let queue: Queue
let worker: Worker

const QUEUE = 'gdpr-requeue-test'

beforeAll(async () => {
  redisC = await new GenericContainer('redis:7-alpine').withExposedPorts(6379).withWaitStrategy(Wait.forLogMessage(/Ready to accept connections/)).start()
}, 120_000)

afterAll(async () => {
  await worker?.close()
  await queue?.close()
  await redisC?.stop()
})

describe('E08-4 gdpr enqueue semantics', () => {
  it('a job that failed its final attempt frees its jobId — the next enqueue RUNS', async () => {
    const connection = { host: redisC.getHost(), port: redisC.getMappedPort(6379) }
    queue = new Queue(QUEUE, { connection })
    let runs = 0
    let failFirst = true
    const ran: Promise<void>[] = []
    let resolveSecond: () => void = () => undefined
    const second = new Promise<void>((r) => (resolveSecond = r))
    worker = new Worker(
      QUEUE,
      () => {
        runs++
        if (failFirst) {
          failFirst = false
          return Promise.reject(new Error('boom'))
        }
        resolveSecond()
        return Promise.resolve()
      },
      { connection, concurrency: 1 },
    )
    void ran

    // mirror the api producer's options (DASH ids — BullMQ rejects ':' in custom ids,
    // which is ALSO why this spec exists); attempts exhausted on ONE try to keep it fast
    const opts = { jobId: 'erase-42', attempts: 1, removeOnComplete: true, removeOnFail: true }
    await queue.add('erase', { deviceId: '42' }, opts)
    // wait for the failure to be fully processed (job removed on fail)
    await new Promise<void>((resolve) => worker.on('failed', () => resolve()))
    // small settle: removal happens in the same transaction as the fail event
    await new Promise((r) => setTimeout(r, 200))

    // the SAME jobId must be accepted again and actually run
    await queue.add('erase', { deviceId: '42' }, opts)
    await second
    expect(runs).toBe(2)
  }, 30_000)

  it('notify + webhook enqueue formats are ACCEPTED by BullMQ (latent `:`-jobId bug regression)', async () => {
    // BullMQ rejects custom jobIds containing ':' (a legacy exactly-3-segment carve-out
    // aside). The original notify (4 segments) and webhook (5+) ids THREW on every enqueue,
    // and main.ts's best-effort catch swallowed it — notifications and webhook deliveries
    // were silently never queued. These calls go against a REAL queue: a bad format throws.
    const connection = { host: redisC.getHost(), port: redisC.getMappedPort(6379) }
    const notifyQ = createNotifyQueue(connection)
    const webhookQ = createWebhookQueue(connection)
    try {
      await enqueueNotify(notifyQ, { ruleId: '00000000-0000-0000-0000-0000000000ab', deviceId: 42n, kind: 'panic', at: new Date(1_800_000_000_000), payload: {} })
      await enqueueWebhook(webhookQ, { deviceId: 42n, kind: 'geofence', at: new Date(1_800_000_000_000), payload: {}, dedupe: '00000000-0000-0000-0000-0000000000cd:enter' })
      const [n, w] = await Promise.all([notifyQ.getWaiting(), webhookQ.getWaiting()])
      expect(n.length + w.length).toBe(2) // both actually landed in their queues
    } finally {
      await notifyQ.close()
      await webhookQ.close()
    }
  }, 30_000)
})
