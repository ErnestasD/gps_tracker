import type { Job } from 'bullmq'
import type { Redis } from 'ioredis'
import type { Pool } from 'pg'
import { describe, expect, it, vi } from 'vitest'

import { runSms } from '../src/jobs/smsWorker.js'
import type { SmsJob } from '../src/jobs/smsQueue.js'
import { SmsSendError, type SmsDriver } from '../src/sms/drivers.js'

/** Fake pg pool capturing every UPDATE (sql + params) for status assertions. */
function fakePool() {
  const calls: { sql: string; params: unknown[] }[] = []
  const query = vi.fn((sql: string, params: unknown[]) => {
    calls.push({ sql, params })
    return Promise.resolve({ rows: [], rowCount: 1 })
  })
  return { pool: { query } as unknown as Pool, calls }
}

/** Fake redis modelling SET NX EX + DEL + GET over an in-memory map (the charge guard). */
function fakeRedis(preclaimed: string[] = []) {
  const store = new Map<string, string>(preclaimed.map((k) => [k, '1']))
  const set = vi.fn((key: string, val: string, _ex: string, _ttl: number, nx: string) => {
    void _ex
    void _ttl
    if (nx === 'NX' && store.has(key)) return Promise.resolve(null) // already claimed
    store.set(key, val)
    return Promise.resolve('OK')
  })
  const del = vi.fn((key: string) => {
    const had = store.delete(key)
    return Promise.resolve(had ? 1 : 0)
  })
  return { redis: { set, del } as unknown as Redis, store, set, del }
}

const job = (data: Partial<SmsJob> = {}): Job<SmsJob> =>
  ({ id: 'sms-d1', data: { smsDeliveryId: 'd1', deviceId: '42', tenantId: 't1', to: '+37060000000', body: 'cfg', provider: 'twilio', ...data } }) as unknown as Job<SmsJob>

const okDriver = (): { driver: SmsDriver; send: ReturnType<typeof vi.fn> } => {
  const send = vi.fn(() => Promise.resolve({ providerMessageId: 'SM_ok' }))
  return { driver: { send }, send }
}

const lastStatus = (calls: { params: unknown[] }[]): unknown => calls[calls.length - 1]?.params[0]

describe('runSms', () => {
  it('claims, sends, and marks the delivery sent with the provider id', async () => {
    const { pool, calls } = fakePool()
    const { redis, set } = fakeRedis()
    const { driver, send } = okDriver()
    const onSent = vi.fn()
    await runSms({ connection: {}, pool, redis, driver, onSent }, job())

    expect(set).toHaveBeenCalledWith('sms:sent:d1', '1', 'EX', 86_400, 'NX')
    expect(send).toHaveBeenCalledWith('+37060000000', 'cfg')
    const sent = calls.find((c) => c.params[0] === 'sent')!
    expect(sent.params).toEqual(['sent', 'SM_ok', 'd1'])
    expect(onSent).toHaveBeenCalledTimes(1)
  })

  it('does NOT resend when the delivery is already claimed — reconciles to sent (no double-charge)', async () => {
    const { pool, calls } = fakePool()
    const { redis } = fakeRedis(['sms:sent:d1']) // a prior attempt already claimed+sent
    const { driver, send } = okDriver()
    await runSms({ connection: {}, pool, redis, driver }, job())

    expect(send).not.toHaveBeenCalled() // idempotent — never a second send
    expect(lastStatus(calls)).toBe('sent') // row reconciled
  })

  it('on a TRANSIENT failure releases the claim, writes a failed breadcrumb, and throws (BullMQ retries)', async () => {
    const { pool, calls } = fakePool()
    const { redis, del, store } = fakeRedis()
    const send = vi.fn(() => Promise.reject(new SmsSendError(503, 'twilio 503')))
    const onFailed = vi.fn()
    await expect(runSms({ connection: {}, pool, redis, driver: { send }, onFailed }, job())).rejects.toThrow('503')

    expect(del).toHaveBeenCalledWith('sms:sent:d1') // claim released so a retry can re-claim
    expect(store.has('sms:sent:d1')).toBe(false)
    expect(lastStatus(calls)).toBe('failed') // breadcrumb
    expect(onFailed).toHaveBeenCalledTimes(1)
  })

  it('on a PERMANENT 4xx marks the delivery failed and does NOT throw (no retry)', async () => {
    const { pool, calls } = fakePool()
    const { redis, del } = fakeRedis()
    const send = vi.fn(() => Promise.reject(new SmsSendError(400, 'twilio 400')))
    const onFailed = vi.fn()
    await expect(runSms({ connection: {}, pool, redis, driver: { send }, onFailed }, job())).resolves.toBeUndefined()

    expect(del).toHaveBeenCalledWith('sms:sent:d1')
    const failed = calls.find((c) => c.params[0] === 'failed')!
    expect(failed.params).toEqual(['failed', 'twilio 400', 'd1'])
    expect(onFailed).toHaveBeenCalledTimes(1)
  })

  it('is a no-op send when the driver is absent — marks failed "sms not configured", no throw', async () => {
    const { pool, calls } = fakePool()
    const { redis, set } = fakeRedis()
    await expect(runSms({ connection: {}, pool, redis, driver: undefined }, job())).resolves.toBeUndefined()

    expect(set).not.toHaveBeenCalled() // never claims when unconfigured
    expect(calls[0]!.params).toEqual(['failed', 'sms not configured', 'd1'])
  })
})
