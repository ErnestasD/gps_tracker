import type { Job } from 'bullmq'
import type { Redis } from 'ioredis'
import type { Pool } from 'pg'
import { describe, expect, it, vi } from 'vitest'

import { loadRuleChannels, resolveNotifyContext, runNotify, type NotifyWorkerDeps } from '../src/jobs/notifyWorker.js'
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
    // device→account resolution for webpush fan-out (ADR-026); no mapping ⇒ null (ctx undefined)
    hget: vi.fn((h: string) => Promise.resolve(h === 'device:tenant' ? 't1' : h === 'device:account' ? 'a1' : null)),
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

describe('resolveNotifyContext', () => {
  const rowPool = (row: Record<string, unknown> | undefined) =>
    ({ query: vi.fn(() => Promise.resolve({ rows: row === undefined ? [] : [row], rowCount: row === undefined ? 0 : 1 })) }) as unknown as Pool

  it('resolves the device name, account timezone, productName brand, and FULL branding for HTML email', async () => {
    const branding = { productName: 'Acme Fleet', primary: '#ff8800', logoUrl: 'https://cdn.acme.test/logo.png', supportEmail: 'help@acme.test' }
    const ctx = await resolveNotifyContext(rowPool({ device_name: 'Vilnius Van 1', device_plate: 'ABC-123', timezone: 'Europe/Vilnius', tenant_name: 'Acme', branding }), '42')
    // the full branding (logo/color/supportEmail) + tenant name now flow through for the branded HTML body
    expect(ctx).toEqual({ deviceLabel: 'Vilnius Van 1', timezone: 'Europe/Vilnius', brand: 'Acme Fleet', branding, tenantName: 'Acme' })
  })

  it('falls back to the plate for the label and the tenant name for the brand', async () => {
    const ctx = await resolveNotifyContext(rowPool({ device_name: null, device_plate: 'ABC-123', timezone: 'UTC', tenant_name: 'Acme', branding: {} }), '42')
    expect(ctx).toEqual({ deviceLabel: 'ABC-123', timezone: 'UTC', brand: 'Acme', branding: {}, tenantName: 'Acme' })
  })

  it('ignores a MALFORMED branding jsonb (no crash) — brand falls back to the tenant name', async () => {
    // a bad primary (not #rrggbb) fails brandingSchema → branding dropped, but the alert is never lost
    const ctx = await resolveNotifyContext(rowPool({ device_name: 'Van', device_plate: null, timezone: 'UTC', tenant_name: 'Acme', branding: { primary: 'red', productName: 42 } }), '42')
    expect(ctx).toEqual({ deviceLabel: 'Van', timezone: 'UTC', brand: 'Acme', branding: undefined, tenantName: 'Acme' })
  })

  it('returns empty context for an unknown device (→ id/UTC/Orbetra defaults downstream)', async () => {
    expect(await resolveNotifyContext(rowPool(undefined), '42')).toEqual({})
  })

  it('never queries for a non-numeric device id', async () => {
    const query = vi.fn(() => Promise.resolve({ rows: [], rowCount: 0 }))
    const pool = { query } as unknown as Pool
    expect(await resolveNotifyContext(pool, 'not-a-number')).toEqual({})
    expect(query).not.toHaveBeenCalled()
  })

  it('swallows a query error and returns empty context (an alert is never dropped)', async () => {
    const pool = { query: vi.fn(() => Promise.reject(new Error('db down'))) } as unknown as Pool
    expect(await resolveNotifyContext(pool, '42')).toEqual({})
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
