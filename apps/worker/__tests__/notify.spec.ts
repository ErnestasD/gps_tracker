import webpush from 'web-push'

import type { PushSubscriptionRepo, PushTarget } from '@orbetra/db'
import type { NotificationChannel } from '@orbetra/shared'
import { describe, expect, it, vi } from 'vitest'

import { dispatchEvent } from '../src/notify/dispatch.js'
import { driversFromEnv, emailDriver, telegramDriver, webPushDriver, type Drivers, type EmailTransport } from '../src/notify/drivers.js'
import { notificationMessage } from '../src/notify/message.js'

const email = (to: string): NotificationChannel => ({ type: 'email', to })
const tg = (chatId: string): NotificationChannel => ({ type: 'telegram', chatId })
const MSG = { subject: 's', text: 't' }

/** In-memory sent-set for the dedup callbacks. */
function sentSet(initial: string[] = []) {
  const set = new Set(initial)
  return {
    alreadySent: (k: string) => Promise.resolve(set.has(k)),
    markSent: (k: string) => {
      set.add(k)
      return Promise.resolve()
    },
    set,
  }
}

describe('E05-5 dispatchEvent', () => {
  it('sends via the matching driver and records sent', async () => {
    const ss = sentSet()
    const drivers: Drivers = { telegram: { send: vi.fn(() => Promise.resolve()) } }
    const r = await dispatchEvent([tg('123')], MSG, drivers, ss.alreadySent, ss.markSent)
    expect(r.sent).toEqual(['telegram:123'])
    expect(r.failed).toEqual([])
    expect(ss.set.has('telegram:123')).toBe(true)
  })

  it('skips a channel whose driver is unconfigured (not a failure)', async () => {
    const ss = sentSet()
    const r = await dispatchEvent([email('a@b.co')], MSG, {}, ss.alreadySent, ss.markSent)
    expect(r.skipped).toEqual(['email:a@b.co'])
    expect(r.failed).toEqual([])
    expect(ss.set.size).toBe(0) // not marked → retriable once configured
  })

  it('records a failed send and does NOT mark it sent (so a retry re-attempts)', async () => {
    const ss = sentSet()
    const drivers: Drivers = { telegram: { send: vi.fn(() => Promise.reject(new Error('boom'))) } }
    const r = await dispatchEvent([tg('123')], MSG, drivers, ss.alreadySent, ss.markSent)
    expect(r.failed).toEqual(['telegram:123'])
    expect(ss.set.has('telegram:123')).toBe(false)
  })

  it('never re-sends a channel already delivered on a prior attempt', async () => {
    const ss = sentSet(['telegram:123'])
    const send = vi.fn(() => Promise.resolve())
    const r = await dispatchEvent([tg('123')], MSG, { telegram: { send } }, ss.alreadySent, ss.markSent)
    expect(send).not.toHaveBeenCalled()
    expect(r.sent).toEqual([])
    expect(r.skipped).toEqual([])
  })

  it('handles a mix: one delivered, one skipped, one failed', async () => {
    const ss = sentSet()
    const drivers: Drivers = { telegram: { send: vi.fn(() => Promise.reject(new Error('x'))) } } // email unconfigured
    const r = await dispatchEvent([tg('1'), email('a@b.co')], MSG, drivers, ss.alreadySent, ss.markSent)
    expect(r.failed).toEqual(['telegram:1'])
    expect(r.skipped).toEqual(['email:a@b.co'])
  })
})

describe('E05-5 telegramDriver', () => {
  it('POSTs chat_id + text and resolves on 2xx', async () => {
    const fetchImpl = vi.fn(() => Promise.resolve({ ok: true, status: 200 } as Response))
    await telegramDriver('TOK', fetchImpl).send(tg('999'), MSG)
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('https://api.telegram.org/botTOK/sendMessage')
    expect(JSON.parse(init.body as string)).toEqual({ chat_id: '999', text: 't' })
  })

  it('throws on a non-2xx response (BullMQ retries)', async () => {
    const fetchImpl = vi.fn(() => Promise.resolve({ ok: false, status: 429 } as Response))
    await expect(telegramDriver('TOK', fetchImpl).send(tg('9'), MSG)).rejects.toThrow('429')
  })
})

describe('E05-5 emailDriver + driversFromEnv', () => {
  it('emailDriver delegates to the injected transport', async () => {
    const send = vi.fn(() => Promise.resolve())
    const transport: EmailTransport = { send }
    await emailDriver(transport).send(email('x@y.co'), { subject: 'S', text: 'B' })
    expect(send).toHaveBeenCalledWith('x@y.co', 'S', 'B')
  })

  it('driversFromEnv exposes telegram only when the token is set', () => {
    expect(driversFromEnv({}).telegram).toBeUndefined()
    expect(driversFromEnv({ TELEGRAM_BOT_TOKEN: 'T' }).telegram).toBeDefined()
    expect(driversFromEnv({ TELEGRAM_BOT_TOKEN: 'T' }).email).toBeUndefined() // no transport injected
    expect(driversFromEnv({}, { emailTransport: { send: () => Promise.resolve() } }).email).toBeDefined()
  })

  it('webpush driver is present only with VAPID keys + a subscriptions repo (ADR-026)', async () => {
    // generate a throwaway keypair at runtime — never commit a VAPID private key (rule 12)
    const { default: webpush } = await import('web-push')
    const vapid = webpush.generateVAPIDKeys()
    const env = { VAPID_PUBLIC_KEY: vapid.publicKey, VAPID_PRIVATE_KEY: vapid.privateKey }
    const subs = { subscribe: () => Promise.resolve(), unsubscribe: () => Promise.resolve(false), listByAccount: () => Promise.resolve([]), deleteByEndpoint: () => Promise.resolve() }
    expect(driversFromEnv({}, { subscriptions: subs }).webpush).toBeUndefined() // no VAPID
    expect(driversFromEnv(env, {}).webpush).toBeUndefined() // no repo
    expect(driversFromEnv(env, { subscriptions: subs }).webpush).toBeDefined()
    expect(driversFromEnv({ VAPID_PUBLIC_KEY: 'bad', VAPID_PRIVATE_KEY: 'bad' }, { subscriptions: subs }).webpush).toBeUndefined() // invalid keys → skipped, no crash
  })
})

describe('ADR-026 webPushDriver.send (fan-out + prune)', () => {
  const chan: NotificationChannel = { type: 'webpush' }
  const ctx = { tenantId: 't1', accountId: 'a1' }
  const target = (endpoint: string): PushTarget => ({ endpoint, p256dh: 'p', auth: 'a' })
  // stub DNS resolver for the SSRF guard: every non-IP host resolves to a public IP (tests use
  // https://a etc. which don't resolve). Private-IP literals are still caught without DNS.
  const pubResolve = (() => Promise.resolve([{ address: '93.184.216.34', family: 4 }])) as unknown as Parameters<typeof webPushDriver>[1]
  // a push-service error the way web-push surfaces it: an Error carrying the HTTP statusCode
  const pushErr = (statusCode: number) => Object.assign(new Error('push service error'), { statusCode })

  // capture the mocks as locals (not method refs) so assertions don't trip no-unbound-method
  function repo(targets: PushTarget[]) {
    const listByAccount = vi.fn(() => Promise.resolve(targets))
    const deleteByEndpoint = vi.fn(() => Promise.resolve())
    const r: PushSubscriptionRepo = { subscribe: () => Promise.resolve(), unsubscribe: () => Promise.resolve(false), listByAccount, deleteByEndpoint }
    return { r, listByAccount, deleteByEndpoint }
  }

  it('fans out one push per subscription of the account, with the {title,body} payload', async () => {
    const send = vi.spyOn(webpush, 'sendNotification').mockResolvedValue({} as never)
    const { r, listByAccount } = repo([target('https://a'), target('https://b')])
    await webPushDriver(r, pubResolve).send(chan, MSG, ctx)
    expect(listByAccount).toHaveBeenCalledWith('t1', 'a1')
    expect(send).toHaveBeenCalledTimes(2)
    expect(JSON.parse(send.mock.calls[0]![1] as string)).toEqual({ title: 's', body: 't' })
    send.mockRestore()
  })

  it('prunes a 410 Gone subscription and still delivers to the healthy ones (no throw)', async () => {
    const send = vi.spyOn(webpush, 'sendNotification').mockImplementation((s: { endpoint: string }) =>
      s.endpoint === 'https://dead' ? Promise.reject(pushErr(410)) : Promise.resolve({} as never),
    )
    const { r, deleteByEndpoint } = repo([target('https://dead'), target('https://live')])
    await webPushDriver(r, pubResolve).send(chan, MSG, ctx) // resolves — a dead sub is not a failure
    expect(deleteByEndpoint).toHaveBeenCalledWith('https://dead')
    expect(deleteByEndpoint).toHaveBeenCalledTimes(1)
    expect(send).toHaveBeenCalledTimes(2) // the dead one did not abort the loop
    send.mockRestore()
  })

  it('throws on a transient failure (→ BullMQ retry) but attempts every target and prunes nothing', async () => {
    const send = vi.spyOn(webpush, 'sendNotification').mockImplementation((s: { endpoint: string }) =>
      s.endpoint === 'https://flaky' ? Promise.reject(pushErr(503)) : Promise.resolve({} as never),
    )
    const { r, deleteByEndpoint } = repo([target('https://flaky'), target('https://ok')])
    await expect(webPushDriver(r, pubResolve).send(chan, MSG, ctx)).rejects.toBeDefined()
    expect(send).toHaveBeenCalledTimes(2) // transient on the first did not short-circuit the second
    expect(deleteByEndpoint).not.toHaveBeenCalled() // 503 ≠ Gone → never prune a live sub
    send.mockRestore()
  })

  it('prunes an endpoint pointing at a private/metadata host and never POSTs to it (blind-SSRF guard)', async () => {
    const send = vi.spyOn(webpush, 'sendNotification').mockResolvedValue({} as never)
    const { r, deleteByEndpoint } = repo([target('http://169.254.169.254/push'), target('https://ok')])
    await webPushDriver(r, pubResolve).send(chan, MSG, ctx) // resolves — an unsafe endpoint is not a retryable failure
    expect(deleteByEndpoint).toHaveBeenCalledWith('http://169.254.169.254/push')
    expect(send).toHaveBeenCalledTimes(1) // only the public endpoint was pushed
    expect((send.mock.calls[0]![0] as { endpoint: string }).endpoint).toBe('https://ok')
    send.mockRestore()
  })

  it('does nothing without ctx — no account means no fan-out target', async () => {
    const send = vi.spyOn(webpush, 'sendNotification')
    const { r, listByAccount } = repo([target('https://a')])
    await webPushDriver(r, pubResolve).send(chan, MSG, undefined)
    expect(listByAccount).not.toHaveBeenCalled()
    expect(send).not.toHaveBeenCalled()
    send.mockRestore()
  })
})

describe('E05-5 notificationMessage', () => {
  it('builds a subject + multi-line body with a kind-specific detail', () => {
    const m = notificationMessage('overspeed', '42', { speedKmh: 95, limitKmh: 90 }, new Date('2026-07-09T00:00:00Z'))
    expect(m.subject).toBe('[Orbetra] Overspeed — device 42')
    expect(m.text).toContain('Speed 95 km/h over limit 90 km/h')
    expect(m.text).toContain('Device: 42')
  })

  it('falls back gracefully for a kind without a detail line', () => {
    const m = notificationMessage('panic', '7', {}, new Date('2026-07-09T00:00:00Z'))
    expect(m.subject).toContain('Panic')
    expect(m.text).toContain('Device: 7')
  })
})
