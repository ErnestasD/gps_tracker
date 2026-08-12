import { describe, expect, it, vi } from 'vitest'

import { buildEmailTransport, isDeliverableAddress, suppressionLookup, type MailSender, type SmtpOptions } from '../src/notify/emailTransport.js'

/** A recording fake so we exercise env-gating + send mapping without a live SMTP server. */
function fakeMailer() {
  const calls: Array<Parameters<MailSender['sendMail']>[0]> = []
  const opts: SmtpOptions[] = []
  const mailer: MailSender = { sendMail: (o) => { calls.push(o); return Promise.resolve({}) } }
  return { calls, opts, create: vi.fn((o: SmtpOptions) => { opts.push(o); return mailer }) }
}

const FULL = { SMTP_HOST: 'email-smtp.eu-central-1.amazonaws.com', SMTP_USER: 'AKIA', SMTP_PASS: 'Bo+9vK/qR7xZ==', MAIL_FROM: 'alerts@orbetra.com' }

describe('E05-5 buildEmailTransport', () => {
  it('is undefined (channel skipped) unless host, user, pass AND from are all set', () => {
    const f = fakeMailer()
    expect(buildEmailTransport({}, f.create)).toBeUndefined()
    for (const drop of ['SMTP_HOST', 'SMTP_USER', 'SMTP_PASS', 'MAIL_FROM']) {
      const env: Record<string, string> = { ...FULL }
      delete env[drop]
      expect(buildEmailTransport(env, f.create), `missing ${drop}`).toBeUndefined()
    }
    expect(buildEmailTransport({ ...FULL }, f.create)).toBeDefined()
  })

  it('builds an OPTIONS object (no URL parsing) — a base64 SES password with / + = survives intact', () => {
    const f = fakeMailer()
    buildEmailTransport({ ...FULL }, f.create)
    // the whole point of HIGH-3: the password is passed structurally, never URL-parsed
    expect(f.opts[0]).toMatchObject({ host: FULL.SMTP_HOST, port: 587, secure: false, auth: { user: 'AKIA', pass: 'Bo+9vK/qR7xZ==' } })
  })

  it('bounds every SMTP phase — telegram and webpush did, email did not (audit high)', () => {
    // a wedged SMTP socket (half-open NAT, provider throttle) held the notify worker's concurrency
    // slot indefinitely and stalled the whole alert queue behind it. `socketTimeout` is the one that
    // matters: an ESTABLISHED but silent connection hangs forever without it.
    const f = fakeMailer()
    buildEmailTransport({ ...FULL }, f.create)
    expect(f.opts[0]).toMatchObject({ connectionTimeout: 10_000, greetingTimeout: 10_000, socketTimeout: 10_000 })
    const custom = fakeMailer()
    buildEmailTransport({ ...FULL, SMTP_TIMEOUT_MS: '2500' }, custom.create)
    expect(custom.opts[0]).toMatchObject({ socketTimeout: 2_500 })
  })

  it('uses secure:true only for port 465; rejects a non-numeric/out-of-range SMTP_PORT (skip, no crash)', () => {
    const f = fakeMailer()
    buildEmailTransport({ ...FULL, SMTP_PORT: '465' }, f.create)
    expect(f.opts[0]!.secure).toBe(true)
    expect(buildEmailTransport({ ...FULL, SMTP_PORT: 'abc' }, f.create)).toBeUndefined()
    expect(buildEmailTransport({ ...FULL, SMTP_PORT: '99999' }, f.create)).toBeUndefined()
  })

  it('sends with MAIL_FROM as the sender and passes subject/text through', async () => {
    const f = fakeMailer()
    const t = buildEmailTransport({ ...FULL }, f.create)!
    await t.send('driver@fleet.co', 'Panic alert', 'Device 42 pressed panic.')
    expect(f.calls[0]).toMatchObject({ from: 'alerts@orbetra.com', to: 'driver@fleet.co', subject: 'Panic alert', text: 'Device 42 pressed panic.' })
    expect(f.calls[0]!.headers).toBeUndefined() // no config set → no header
  })

  it('passes the branded html body through to sendMail alongside the text fallback (multipart)', async () => {
    const f = fakeMailer()
    const t = buildEmailTransport({ ...FULL }, f.create)!
    await t.send('driver@fleet.co', 'Panic alert', 'Device 42 pressed panic.', '<p>Device 42 pressed panic.</p>')
    expect(f.calls[0]).toMatchObject({ text: 'Device 42 pressed panic.', html: '<p>Device 42 pressed panic.</p>' })
  })

  it('omits html entirely when none is supplied (plain-text only, backwards-compatible)', async () => {
    const f = fakeMailer()
    const t = buildEmailTransport({ ...FULL }, f.create)!
    await t.send('driver@fleet.co', 's', 'b')
    expect(f.calls[0]!).not.toHaveProperty('html')
  })

  it('a createTransport failure disables email (undefined) instead of crashing the worker', () => {
    const create = vi.fn(() => { throw new Error('boom') })
    expect(buildEmailTransport({ ...FULL }, create)).toBeUndefined() // must not throw
    expect(create).toHaveBeenCalledOnce()
  })

  it('adds the SES config-set header for bounce/complaint routing when configured', async () => {
    const f = fakeMailer()
    const t = buildEmailTransport({ ...FULL, SES_CONFIG_SET: 'orbetra-notifications' }, f.create)!
    await t.send('driver@fleet.co', 's', 'b')
    expect(f.calls[0]!.headers).toEqual({ 'X-SES-CONFIGURATION-SET': 'orbetra-notifications' })
  })

  it('never sends to a reserved-use TLD (bounce-reputation guard) — .test/.invalid/.localhost skipped', async () => {
    const f = fakeMailer()
    const t = buildEmailTransport({ ...FULL }, f.create)!
    await t.send('demo-admin@orbetra.test', 'Trips report', 'body') // the daily-bounce culprit
    expect(f.calls).toHaveLength(0) // no SES attempt at all
  })

  it('filters a mixed recipient list to only the deliverable addresses', async () => {
    const f = fakeMailer()
    const t = buildEmailTransport({ ...FULL }, f.create)!
    await t.send('real@fleet.co, demo-admin@orbetra.test', 's', 'b')
    expect(f.calls[0]!.to).toBe('real@fleet.co') // the .test recipient dropped, the real one kept
  })
})

describe('isDeliverableAddress', () => {
  it('rejects RFC 6761/2606 reserved TLDs, accepts real domains', () => {
    for (const bad of ['a@orbetra.test', 'x@fleet.invalid', 'y@example', 'z@localhost', 'q@x.localhost', 'nope']) {
      expect(isDeliverableAddress(bad), bad).toBe(false)
    }
    for (const ok of ['a@orbetra.com', 'b@fleet.co', 'c@sub.company.lt', 'd@x.io']) {
      expect(isDeliverableAddress(ok), ok).toBe(true)
    }
  })
})

describe('suppressed recipients (SES bounce/complaint feedback)', () => {
  it('drops a suppressed address, keeps the rest of a comma list, and skips the send when none remain', async () => {
    // Alert and scheduled-report mail went out through this transport and consulted nothing, while
    // only the AUTH worker checked. The customer gets nothing either way — what this protects is the
    // sending identity: bounces are scored account-wide on the one identity that also carries every
    // password reset, so a rule firing at event rate against a dead address is a slow way to have
    // SES pause the platform.
    const f = fakeMailer()
    const dead = new Set(['dead@example.lt'])
    const t = buildEmailTransport({ ...FULL }, f.create, (addrs) => Promise.resolve(new Set(addrs.filter((a) => dead.has(a)))))!

    await t.send('live@example.lt, dead@example.lt', 'Panic', 'text')
    expect(f.calls[0]!.to).toBe('live@example.lt')

    await t.send('dead@example.lt', 'Panic', 'text')
    expect(f.calls).toHaveLength(1) // no second send at all
  })

  it('FAILS OPEN: a database fault must not silence a live customer', async () => {
    // The fail-open lives in `suppressionLookup`, not in the transport, so test it there — a
    // transport-level assertion would only prove that whatever the caller injected was honoured.
    // The worst case of sending one extra message to a dead address is one bounce; the worst case
    // of the opposite is an owner who never learns their vehicle was stolen.
    const brokenRepo = { suppressedAmong: () => Promise.reject(new Error('pg down')) }
    await expect(suppressionLookup(brokenRepo)(['live@example.lt'])).resolves.toEqual(new Set())

    const f = fakeMailer()
    const t = buildEmailTransport({ ...FULL }, f.create, suppressionLookup(brokenRepo))!
    await t.send('live@example.lt', 'Panic', 'text')
    expect(f.calls.at(-1)!.to).toBe('live@example.lt')
  })

  it('asks the repo ONCE for the whole recipient list', async () => {
    // a scheduled-report row can carry a dozen recipients; one round trip per address would put a
    // fan-out on the same pool the hot path uses. The repo owns the lower-casing and the SQL.
    const seen: (readonly string[])[] = []
    const repo = { suppressedAmong: (a: readonly string[]) => { seen.push(a); return Promise.resolve(new Set<string>()) } }
    await suppressionLookup(repo)(['A@Example.LT', ' b@example.lt '])
    expect(seen).toHaveLength(1)
    expect(seen[0]).toEqual(['A@Example.LT', ' b@example.lt '])
  })

  it('with no lookup injected, behaviour is exactly as before', async () => {
    const f = fakeMailer()
    const t = buildEmailTransport({ ...FULL }, f.create)!
    await t.send('anyone@example.lt', 'Panic', 'text')
    expect(f.calls[0]!.to).toBe('anyone@example.lt')
  })
})
