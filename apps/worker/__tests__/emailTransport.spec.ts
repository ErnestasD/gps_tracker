import { describe, expect, it, vi } from 'vitest'

import { buildEmailTransport, isDeliverableAddress, type MailSender, type SmtpOptions } from '../src/notify/emailTransport.js'

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
