import { describe, expect, it, vi } from 'vitest'

import { buildEmailTransport, type MailSender, type SmtpOptions } from '../src/notify/emailTransport.js'

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
    expect(f.opts[0]).toEqual({ host: FULL.SMTP_HOST, port: 587, secure: false, auth: { user: 'AKIA', pass: 'Bo+9vK/qR7xZ==' } })
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
    await t.send('driver@fleet.test', 'Panic alert', 'Device 42 pressed panic.')
    expect(f.calls[0]).toMatchObject({ from: 'alerts@orbetra.com', to: 'driver@fleet.test', subject: 'Panic alert', text: 'Device 42 pressed panic.' })
    expect(f.calls[0]!.headers).toBeUndefined() // no config set → no header
  })

  it('passes the branded html body through to sendMail alongside the text fallback (multipart)', async () => {
    const f = fakeMailer()
    const t = buildEmailTransport({ ...FULL }, f.create)!
    await t.send('driver@fleet.test', 'Panic alert', 'Device 42 pressed panic.', '<p>Device 42 pressed panic.</p>')
    expect(f.calls[0]).toMatchObject({ text: 'Device 42 pressed panic.', html: '<p>Device 42 pressed panic.</p>' })
  })

  it('omits html entirely when none is supplied (plain-text only, backwards-compatible)', async () => {
    const f = fakeMailer()
    const t = buildEmailTransport({ ...FULL }, f.create)!
    await t.send('driver@fleet.test', 's', 'b')
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
    await t.send('x@y.z', 's', 'b')
    expect(f.calls[0]!.headers).toEqual({ 'X-SES-CONFIGURATION-SET': 'orbetra-notifications' })
  })
})
