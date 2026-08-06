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
  it('emailDriver delegates to the injected transport, forwarding the branded html body', async () => {
    const send = vi.fn(() => Promise.resolve())
    const transport: EmailTransport = { send }
    await emailDriver(transport).send(email('x@y.co'), { subject: 'S', text: 'B', html: '<p>H</p>' })
    expect(send).toHaveBeenCalledWith('x@y.co', 'S', 'B', '<p>H</p>')
  })

  it('emailDriver passes html=undefined when a message has no html (plain-text only)', async () => {
    const send = vi.fn(() => Promise.resolve())
    await emailDriver({ send }).send(email('x@y.co'), { subject: 'S', text: 'B' })
    expect(send).toHaveBeenCalledWith('x@y.co', 'S', 'B', undefined)
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
  it('builds a subject + multi-line body with a kind-specific detail (defaults: id, UTC, Orbetra)', () => {
    const m = notificationMessage('overspeed', '42', { speedKmh: 95, limitKmh: 90 }, new Date('2026-07-09T00:00:00Z'))
    expect(m.subject).toBe('[Orbetra] Overspeed — 42')
    expect(m.text).toContain('Speed 95 km/h over limit 90 km/h')
    expect(m.text).toContain('Device: 42')
    expect(m.text).toContain('When: 2026-07-09 00:00 (UTC)')
  })

  it('uses the device NAME, tenant BRAND, and ACCOUNT timezone from the context', () => {
    const m = notificationMessage('overspeed', '42', { speedKmh: 95, limitKmh: 90 }, new Date('2026-07-09T00:00:00Z'), {
      deviceLabel: 'Vilnius Van 1',
      timezone: 'Europe/Vilnius',
      brand: 'Acme Fleet',
    })
    expect(m.subject).toBe('[Acme Fleet] Overspeed — Vilnius Van 1')
    expect(m.text).toContain('Device: Vilnius Van 1')
    // 00:00 UTC → 03:00 in Europe/Vilnius (UTC+3 in July)
    expect(m.text).toContain('When: 2026-07-09 03:00 (Europe/Vilnius)')
  })

  it('renders fuel_theft with a proper title + amount detail (not the raw slug)', () => {
    const m = notificationMessage('fuel_theft', '42', { unit: 'liters', baseline: 60, to: 40, drop: 20 }, new Date('2026-07-09T00:00:00Z'))
    expect(m.subject).toContain('Fuel theft')
    expect(m.subject).not.toContain('fuel_theft')
    // lowercase `l`, matching the dashboard's own volume label — an email and the screen it came
    // from must not label the same number two different ways
    expect(m.text).toContain('Fuel dropped 20.0 l')
    expect(m.text).toContain('baseline 60.0 l')
  })

  it('renders a percentage fuel_theft drop', () => {
    const m = notificationMessage('fuel_theft', '42', { unit: 'pct', baseline: 80, to: 55, drop: 25 }, new Date('2026-07-09T00:00:00Z'))
    expect(m.text).toContain('Fuel dropped 25 %')
  })

  it('humanizes an unknown kind instead of leaking the raw slug', () => {
    const m = notificationMessage('some_new_kind', '7', {}, new Date('2026-07-09T00:00:00Z'))
    expect(m.subject).toContain('Some new kind')
    expect(m.text).toContain('Device: 7')
  })
})

describe('E05-4 notificationMessage branded HTML', () => {
  const branding = { productName: 'Acme Fleet', primary: '#ff8800', logoUrl: 'https://cdn.acme.test/logo.png', supportEmail: 'help@acme.test' }

  it('emits a white-label branded HTML body carrying the productName, logo, accent — plus the plain-text fallback', () => {
    const m = notificationMessage('overspeed', '42', { speedKmh: 95, limitKmh: 90 }, new Date('2026-07-09T00:00:00Z'), {
      deviceLabel: 'Vilnius Van 1', timezone: 'Europe/Vilnius', brand: 'Acme Fleet', branding, tenantName: 'Acme',
    })
    // plain-text fallback is always present (multipart/alternative text part)
    expect(m.text).toContain('Device: Vilnius Van 1')
    // branded shell: product name, logo, accent color, support email
    expect(m.html).toBeDefined()
    expect(m.html!).toContain('Acme Fleet')
    expect(m.html!).toContain('https://cdn.acme.test/logo.png')
    expect(m.html!).toContain('#ff8800')
    expect(m.html!).toContain('help@acme.test')
    // the alert content is present as escaped HTML paragraphs
    expect(m.html!).toContain('Vilnius Van 1')
    expect(m.html!).toContain('Speed 95 km/h over limit 90 km/h')
    expect(m.html!).toContain('<!doctype html>')
  })

  it('a tenant with NO branding gets OUR name in the header, not its own company name', () => {
    // Not white-label ⇒ not a reseller ⇒ this mail is from the product they signed up to. Heading a
    // password-reset or an alert with the customer's own company name reads as if they sent it to
    // themselves; it also left the platform's mail with no platform identity anywhere on it.
    const m = notificationMessage('panic', '42', {}, new Date('2026-07-09T00:00:00Z'), { tenantName: 'Bare Tenant' })
    expect(m.html).toBeDefined()
    expect(m.html!).toContain('Orbetra')
    expect(m.html!).not.toContain('Bare Tenant')
    expect(m.html!).toContain('#5253DA') // the product accent (--accent in the app), shared by every mail
    expect(m.html!).not.toContain('<img')
  })

  it('escapes tenant + device strings in the HTML (no injection via device label)', () => {
    const m = notificationMessage('panic', '42', {}, new Date('2026-07-09T00:00:00Z'), {
      deviceLabel: '<script>alert(1)</script>', tenantName: 'T',
    })
    expect(m.html!).not.toContain('<script>alert(1)</script>')
    expect(m.html!).toContain('&lt;script&gt;')
  })
})

describe('notificationMessage in the account language + units (account-settings debt, closed)', () => {
  const at = new Date('2026-07-09T00:00:00Z')
  const IMPERIAL = { speed: 'mph', distance: 'mi', volume: 'gal' } as const

  it('writes the whole alert in the account language', () => {
    const m = notificationMessage('overspeed', '42', { speedKmh: 95, limitKmh: 90 }, at, { locale: 'lt', deviceLabel: 'Van 1' })
    expect(m.subject).toBe('[Orbetra] Greičio viršijimas — Van 1')
    expect(m.text).toContain('Pranešimas: Greičio viršijimas')
    expect(m.text).toContain('Įrenginys: Van 1')
    expect(m.text).toContain('Kada: 2026-07-09 00:00 (UTC)')
    expect(m.text).toContain('Greitis 95 km/val, leistina 90 km/val')
    expect(m.text).not.toContain('Device')
  })

  it('converts the numbers AND labels them in the account unit', () => {
    const m = notificationMessage('overspeed', '42', { speedKmh: 96.56064, limitKmh: 80.4672 }, at, { units: IMPERIAL })
    expect(m.text).toContain('Speed 60 mph over limit 50 mph')
    expect(m.text).not.toContain('km/h')
  })

  it('does NOT convert a percentage fuel drop to gallons — a ratio is not a volume', () => {
    const pct = notificationMessage('fuel_theft', '42', { unit: 'pct', baseline: 80, to: 55, drop: 25 }, at, { units: IMPERIAL })
    expect(pct.text).toContain('Fuel dropped 25 %')
    const litres = notificationMessage('fuel_theft', '42', { unit: 'liters', baseline: 37.854, to: 18.927, drop: 18.927 }, at, { units: IMPERIAL })
    expect(litres.text).toContain('Fuel dropped 5.0 gal')
  })

  it('localizes every kind, including the geofence transition and the offline hours label', () => {
    expect(notificationMessage('geofence', '1', { name: 'Depas', transition: 'enter' }, at, { locale: 'lt' }).text).toContain('įvažiavo į zoną: Depas')
    expect(notificationMessage('geofence', '1', { name: 'Depot', transition: 'exit' }, at, { locale: 'de' }).text).toContain('Ausfahrt: Depot')
    expect(notificationMessage('device_offline', '1', { offlineH: 5, thresholdH: 3 }, at, { locale: 'pl' }).text).toContain('od 5 godz.')
    expect(notificationMessage('ignition', '1', { ignition: 1 }, at, { locale: 'lt' }).text).toContain('Degimas įjungtas')
    expect(notificationMessage('power_cut', '1', {}, at, { locale: 'de' }).text).toContain('Externe Stromversorgung unterbrochen')
  })

  it('a geofence event with no name gets a GRAMMATICAL nameless sentence, not a word in a slot', () => {
    // `iš` governs the genitive, so dropping a fallback noun into the slot produced "išvažiavo iš
    // geozona" — wrong Lithuanian, and the same trap in Polish (`z` + genitive). The fallback is a
    // word we own, so each language writes the nameless sentence out instead of assembling it.
    expect(notificationMessage('geofence', '1', { transition: 'exit' }, at, { locale: 'lt' }).text).toContain('išvažiavo iš zonos')
    expect(notificationMessage('geofence', '1', { transition: 'enter' }, at, { locale: 'lt' }).text).toContain('įvažiavo į zoną')
    expect(notificationMessage('geofence', '1', { transition: 'exit' }, at, { locale: 'pl' }).text).toContain('wyjazd z geostrefy')
    expect(notificationMessage('geofence', '1', { transition: 'enter' }, at, { locale: 'de' }).text).toContain('Einfahrt in einen Geofence')
    expect(notificationMessage('geofence', '1', { transition: 'exit' }, at).text).toContain('exited a geofence')
    // a NAMED fence keeps the name verbatim — a customer's label is not ours to decline
    expect(notificationMessage('geofence', '1', { name: 'Depas', transition: 'exit' }, at, { locale: 'lt' }).text).toContain('išvažiavo iš zonos: Depas')
  })

  it('an overspeed alert can never say "over limit" with the same number on both sides', () => {
    // A device reports integer km/h, so the smallest real event is limit+1 — 0.62 mph, which
    // collapses to ONE integer for 68 of the 181 integer limits between 20 and 200. Rounded
    // independently, the 3am alert asserted "Speed 50 mph over limit 50 mph".
    const imp = { units: IMPERIAL } as const
    expect(notificationMessage('overspeed', '1', { speedKmh: 81, limitKmh: 80 }, at, imp).text).toContain('Speed 50.3 mph over limit 49.7 mph')
    // a comfortable gap still prints whole numbers — no false precision where none is needed
    expect(notificationMessage('overspeed', '1', { speedKmh: 120, limitKmh: 80 }, at, imp).text).toContain('Speed 75 mph over limit 50 mph')
    // and metric is not immune: a fractional rule limit collided too
    expect(notificationMessage('overspeed', '1', { speedKmh: 91, limitKmh: 90.5 }, at).text).toContain('Speed 91.0 km/h over limit 90.5 km/h')
    // exhaustive: no integer limit 20–200 with a +1 km/h fix may print two equal numbers
    for (const limit of Array.from({ length: 181 }, (_, i) => i + 20)) {
      for (const units of [undefined, IMPERIAL]) {
        const m = notificationMessage('overspeed', '1', { speedKmh: limit + 1, limitKmh: limit }, at, units ? { units } : {})
        const nums = /([\d.]+) \S+ over limit ([\d.]+)/.exec(m.text)
        expect(nums, m.text).not.toBeNull()
        expect(nums![1], `limit ${limit} ${units ? 'mph' : 'kmh'}`).not.toBe(nums![2])
      }
    }
  })

  it('a non-numeric overspeed payload degrades to dashes rather than throwing', () => {
    expect(notificationMessage('overspeed', '1', { speedKmh: 'fast', limitKmh: null }, at).text).toContain('Speed — km/h over limit —')
  })

  it('the branded HTML footer follows the same language as the body', () => {
    const m = notificationMessage('panic', '42', {}, at, { locale: 'lt', tenantName: 'T' })
    expect(m.html!).toContain('Šį laišką gavote')
    expect(m.html!).toContain('Paspaustas pavojaus (SOS) mygtukas')
  })

  it('an unknown locale renders English rather than throwing (the column has no CHECK)', () => {
    const m = notificationMessage('panic', '42', {}, at, { locale: 'xx' })
    expect(m.subject).toContain('Panic / SOS')
    expect(m.text).toContain('SOS / panic button triggered')
  })

  it('an unknown KIND still has no translation and must not leak the raw slug', () => {
    const m = notificationMessage('some_new_kind', '7', {}, at, { locale: 'lt' })
    expect(m.subject).toContain('Some new kind')
    expect(m.text).toContain('Įrenginys: 7')
  })
})
