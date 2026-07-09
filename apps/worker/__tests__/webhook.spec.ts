import { createHmac } from 'node:crypto'
import type { Job } from 'bullmq'
import type { Redis } from 'ioredis'
import type { Pool } from 'pg'
import { describe, expect, it, vi } from 'vitest'

import { runWebhook, type WebhookWorkerDeps } from '../src/jobs/webhookWorker.js'
import type { WebhookJob } from '../src/jobs/webhookQueue.js'
import { signBody } from '../src/webhook/sign.js'

describe('E06-4 signBody', () => {
  it('produces a verifiable sha256= HMAC of the body', () => {
    const body = '{"kind":"panic"}'
    const sig = signBody(body, 's3cr3t')
    expect(sig).toBe(`sha256=${createHmac('sha256', 's3cr3t').update(body).digest('hex')}`)
    expect(sig.startsWith('sha256=')).toBe(true)
  })

  it('changes with the secret and the body (integrity)', () => {
    expect(signBody('a', 'k1')).not.toBe(signBody('a', 'k2'))
    expect(signBody('a', 'k')).not.toBe(signBody('b', 'k'))
  })
})

interface Hook {
  id: string
  url: string
  secret: string
  events: string[]
}
function fakePool(hooks: Hook[]) {
  const inserts: { sql: string; params: unknown[] }[] = []
  const query = vi.fn((sql: string, params: unknown[]) => {
    if (sql.startsWith('INSERT INTO webhook_deliveries')) {
      inserts.push({ sql, params })
      return Promise.resolve({ rows: [], rowCount: (sql.match(/\(\$/g) ?? []).length })
    }
    const kind = params[2] as string
    const rows = hooks.filter((h) => h.events.length === 0 || h.events.includes(kind))
    return Promise.resolve({ rows, rowCount: rows.length })
  })
  return { pool: { query } as unknown as Pool, query, inserts }
}
function fakeRedis(tenant: string | null, account: string | null, sent: string[] = []) {
  const set = new Set(sent)
  const pipe = { sadd: (_k: string, m: string) => { set.add(m); return pipe }, expire: () => pipe, exec: () => Promise.resolve([]) }
  return {
    hget: vi.fn((key: string) => Promise.resolve(key === 'device:tenant' ? tenant : account)),
    sismember: vi.fn((_k: string, m: string) => Promise.resolve(set.has(m) ? 1 : 0)),
    pipeline: vi.fn(() => pipe),
  } as unknown as Redis
}
const job = (kind = 'panic'): Job<WebhookJob> =>
  ({ id: 'wh-1', data: { eventId: `42:${kind}:0:r1`, deviceId: '42', kind, at: '2026-07-09T00:00:00.000Z', payload: { x: 1 } } }) as unknown as Job<WebhookJob>
const okFetch = () => vi.fn(() => Promise.resolve({ ok: true, status: 200 } as Response))
// SSRF-guard resolver injected so tests don't do real DNS: public by default
const publicResolver = () => Promise.resolve([{ address: '93.184.216.34', family: 4 }]) as never
const privateResolver = () => Promise.resolve([{ address: '169.254.169.254', family: 4 }]) as never
const baseDeps = (pool: Pool, redis: Redis, fetchImpl: ReturnType<typeof okFetch>, extra: Partial<WebhookWorkerDeps> = {}): WebhookWorkerDeps =>
  ({ connection: {}, pool, redis, fetchImpl, resolveHost: publicResolver, ...extra })

describe('E06-4 runWebhook', () => {
  it('POSTs the signed body + X-Webhook-Id to a subscribed webhook', async () => {
    const fetchImpl = okFetch()
    const { pool } = fakePool([{ id: 'h1', url: 'https://x.test/hook', secret: 'sec', events: ['panic'] }])
    const onDelivered = vi.fn()
    await runWebhook(baseDeps(pool, fakeRedis('t', 'a'), fetchImpl, { onDelivered }), job())
    expect(fetchImpl).toHaveBeenCalledTimes(1)
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('https://x.test/hook')
    const headers = init.headers as Record<string, string>
    expect(headers['X-Signature']).toBe(signBody(init.body as string, 'sec'))
    expect(headers['X-Webhook-Id']).toBe('42:panic:0:r1')
    expect(init.redirect).toBe('error') // no 302 into a private URL
    expect(onDelivered).toHaveBeenCalledTimes(1)
  })

  it('a webhook with empty events[] receives ALL kinds', async () => {
    const fetchImpl = okFetch()
    const { pool } = fakePool([{ id: 'h1', url: 'https://x.test/all', secret: 's', events: [] }])
    await runWebhook(baseDeps(pool, fakeRedis('t', 'a'), fetchImpl), job('geofence'))
    expect(fetchImpl).toHaveBeenCalledTimes(1)
  })

  it('does nothing for an unregistered device (no scope)', async () => {
    const fetchImpl = okFetch()
    const { pool, query } = fakePool([{ id: 'h1', url: 'https://x.test/u', secret: 's', events: [] }])
    await runWebhook(baseDeps(pool, fakeRedis(null, null), fetchImpl), job())
    expect(query).not.toHaveBeenCalled()
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('throws (→ BullMQ retry) when an endpoint returns non-2xx, and records the failure', async () => {
    const fetchImpl = vi.fn(() => Promise.resolve({ ok: false, status: 500 } as Response)) as ReturnType<typeof okFetch>
    const { pool } = fakePool([{ id: 'h1', url: 'https://x.test/u', secret: 's', events: ['panic'] }])
    const onFailed = vi.fn()
    await expect(runWebhook(baseDeps(pool, fakeRedis('t', 'a'), fetchImpl, { onFailed }), job())).rejects.toThrow('failed')
    expect(onFailed).toHaveBeenCalledTimes(1)
  })

  it('does not re-POST a webhook already delivered on a prior attempt (idempotent retry)', async () => {
    const fetchImpl = okFetch()
    const { pool } = fakePool([{ id: 'h1', url: 'https://x.test/u', secret: 's', events: ['panic'] }])
    await runWebhook(baseDeps(pool, fakeRedis('t', 'a', ['h1']), fetchImpl), job())
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('records a delivery-log row per attempt (E06-4b): status + success/failure', async () => {
    const okImpl = okFetch()
    const okPool = fakePool([{ id: 'h1', url: 'https://x.test/ok', secret: 's', events: ['panic'] }])
    await runWebhook(baseDeps(okPool.pool, fakeRedis('t', 'a'), okImpl), job())
    expect(okPool.inserts).toHaveLength(1)
    // params: tenantId, accountId, webhookId, eventId, kind, statusCode, success, error
    expect(okPool.inserts[0]!.params.slice(2, 8)).toEqual(['h1', '42:panic:0:r1', 'panic', 200, true, null])

    const failImpl = vi.fn(() => Promise.resolve({ ok: false, status: 502 } as Response)) as ReturnType<typeof okFetch>
    const failPool = fakePool([{ id: 'h1', url: 'https://x.test/bad', secret: 's', events: ['panic'] }])
    await expect(runWebhook(baseDeps(failPool.pool, fakeRedis('t', 'a'), failImpl), job())).rejects.toThrow()
    expect(failPool.inserts[0]!.params[5]).toBe(502) // statusCode parsed from the error
    expect(failPool.inserts[0]!.params[6]).toBe(false) // success
  })

  it('SSRF: a URL resolving to a private/metadata IP is never fetched (counts as a failure)', async () => {
    const fetchImpl = okFetch()
    const { pool } = fakePool([{ id: 'h1', url: 'https://evil.test/x', secret: 's', events: ['panic'] }])
    const onFailed = vi.fn()
    await expect(runWebhook(baseDeps(pool, fakeRedis('t', 'a'), fetchImpl, { onFailed, resolveHost: privateResolver }), job())).rejects.toThrow('failed')
    expect(fetchImpl).not.toHaveBeenCalled() // guard rejected before the request
    expect(onFailed).toHaveBeenCalledTimes(1)
  })

  it('partial failure: a delivered endpoint is not re-sent, only the failed one retries', async () => {
    // h1 ok, h2 500 → throws; the sent-set records h1 so a retry skips it
    const set = new Set<string>()
    const pipe = { sadd: (_k: string, m: string) => { set.add(m); return pipe }, expire: () => pipe, exec: () => Promise.resolve([]) }
    const redis = {
      hget: vi.fn((key: string) => Promise.resolve(key === 'device:tenant' ? 't' : 'a')),
      sismember: vi.fn((_k: string, m: string) => Promise.resolve(set.has(m) ? 1 : 0)),
      pipeline: vi.fn(() => pipe),
    } as unknown as Redis
    const fetchImpl = vi.fn((url: string) => Promise.resolve({ ok: url.includes('good'), status: url.includes('good') ? 200 : 500 } as Response)) as ReturnType<typeof okFetch>
    const { pool } = fakePool([
      { id: 'h1', url: 'https://good.test/x', secret: 's', events: ['panic'] },
      { id: 'h2', url: 'https://bad.test/x', secret: 's', events: ['panic'] },
    ])
    await expect(runWebhook(baseDeps(pool, redis, fetchImpl), job())).rejects.toThrow('1 endpoint')
    expect(set.has('h1')).toBe(true) // h1 delivered + recorded
    // retry: h1 skipped, only h2 re-attempted
    fetchImpl.mockClear()
    await expect(runWebhook(baseDeps(pool, redis, fetchImpl), job())).rejects.toThrow('1 endpoint')
    const retried = (fetchImpl.mock.calls as unknown as [string][]).map((c) => c[0])
    expect(retried).toEqual(['https://bad.test/x'])
  })
})
