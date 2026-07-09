import type { Job } from 'bullmq'
import type { Redis } from 'ioredis'
import type { Pool } from 'pg'
import { describe, expect, it, vi } from 'vitest'

import { loadRuleChannels, runNotify, type NotifyWorkerDeps } from '../src/jobs/notifyWorker.js'
import type { NotifyJob } from '../src/jobs/notifyQueue.js'

function fakePool(channels: unknown, enabled = true) {
  const query = vi.fn(() => Promise.resolve({ rows: enabled ? [{ channels }] : [], rowCount: enabled ? 1 : 0 }))
  return { query } as unknown as Pool
}

/** Fake redis modelling the per-job sent-set (sismember/sadd/expire). */
function fakeRedis(sent: string[] = []) {
  const set = new Set(sent)
  const pipe = {
    sadd: (k: string, m: string) => {
      void k
      set.add(m)
      return pipe
    },
    expire: () => pipe,
    exec: () => Promise.resolve([]),
  }
  return {
    sismember: vi.fn((k: string, m: string) => {
      void k
      return Promise.resolve(set.has(m) ? 1 : 0)
    }),
    pipeline: vi.fn(() => pipe),
  } as unknown as Redis
}

const job = (data: Partial<NotifyJob> = {}): Job<NotifyJob> =>
  ({ id: 'job-1', data: { ruleId: 'r1', deviceId: '42', kind: 'overspeed', at: '2026-07-09T00:00:00.000Z', payload: { speedKmh: 95, limitKmh: 90 }, ...data } }) as unknown as Job<NotifyJob>

const deps = (over: Partial<NotifyWorkerDeps>): NotifyWorkerDeps => ({
  connection: {},
  pool: fakePool([{ type: 'telegram', chatId: '999' }]),
  redis: fakeRedis(),
  drivers: {},
  ...over,
})

describe('E05-5 loadRuleChannels', () => {
  it('returns validated channels for an enabled rule, dropping invalid entries', async () => {
    const pool = fakePool([{ type: 'telegram', chatId: '999' }, { type: 'email', to: 'not-an-email' }, { bogus: true }])
    const ch = await loadRuleChannels(pool, 'r1')
    expect(ch).toEqual([{ type: 'telegram', chatId: '999' }]) // bad email + bogus dropped
  })

  it('returns [] for a disabled/absent rule', async () => {
    expect(await loadRuleChannels(fakePool(null, false), 'r1')).toEqual([])
  })
})

describe('E05-5 runNotify', () => {
  it('delivers to a configured channel and records the metric', async () => {
    const send = vi.fn(() => Promise.resolve())
    const onSent = vi.fn()
    await runNotify(deps({ drivers: { telegram: { send } }, onSent }), job())
    expect(send).toHaveBeenCalledTimes(1)
    expect(onSent).toHaveBeenCalledWith('telegram')
  })

  it('throws when a configured channel fails (so BullMQ retries), recording the failure', async () => {
    const send = vi.fn(() => Promise.reject(new Error('net')))
    const onFailed = vi.fn()
    await expect(runNotify(deps({ drivers: { telegram: { send } }, onFailed }), job())).rejects.toThrow('failed')
    expect(onFailed).toHaveBeenCalledWith('telegram')
  })

  it('does NOT throw when the only channel is unconfigured (skipped, not failed)', async () => {
    const onSkipped = vi.fn()
    await expect(runNotify(deps({ drivers: {}, onSkipped }), job())).resolves.toBeUndefined()
    expect(onSkipped).toHaveBeenCalledWith('unconfigured')
  })

  it('is a no-op when the rule has no channels', async () => {
    const send = vi.fn(() => Promise.resolve())
    await runNotify(deps({ pool: fakePool([]), drivers: { telegram: { send } } }), job())
    expect(send).not.toHaveBeenCalled()
  })
})
