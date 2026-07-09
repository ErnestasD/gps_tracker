import type { NotificationChannel } from '@orbetra/shared'
import { describe, expect, it, vi } from 'vitest'

import { dispatchEvent } from '../src/notify/dispatch.js'
import { driversFromEnv, emailDriver, telegramDriver, type Drivers, type EmailTransport } from '../src/notify/drivers.js'
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
    expect(driversFromEnv({}, { send: () => Promise.resolve() }).email).toBeDefined()
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
