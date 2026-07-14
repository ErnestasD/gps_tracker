import { describe, expect, it, vi } from 'vitest'

import { buildEmailTransport, type MailSender } from '../src/notify/emailTransport.js'

/** A recording fake so we exercise the env-gating + send mapping without a live SMTP server. */
function fakeMailer() {
  const calls: Array<Parameters<MailSender['sendMail']>[0]> = []
  const mailer: MailSender = { sendMail: (opts) => { calls.push(opts); return Promise.resolve({}) } }
  return { calls, create: vi.fn(() => mailer) }
}

describe('E05-5 buildEmailTransport', () => {
  it('is undefined (channel skipped) unless BOTH SMTP_URL and MAIL_FROM are set', () => {
    const f = fakeMailer()
    expect(buildEmailTransport({}, f.create)).toBeUndefined()
    expect(buildEmailTransport({ SMTP_URL: 'smtp://x' }, f.create)).toBeUndefined()
    expect(buildEmailTransport({ MAIL_FROM: 'a@b.c' }, f.create)).toBeUndefined()
    expect(buildEmailTransport({ SMTP_URL: 'smtp://x', MAIL_FROM: 'a@b.c' }, f.create)).toBeDefined()
  })

  it('sends with MAIL_FROM as the sender and passes subject/text through', async () => {
    const f = fakeMailer()
    const t = buildEmailTransport({ SMTP_URL: 'smtp://u:p@host:587', MAIL_FROM: 'alerts@orbetra.com' }, f.create)!
    expect(f.create).toHaveBeenCalledWith('smtp://u:p@host:587')
    await t.send('driver@fleet.test', 'Panic alert', 'Device 42 pressed panic.')
    expect(f.calls).toHaveLength(1)
    expect(f.calls[0]).toMatchObject({ from: 'alerts@orbetra.com', to: 'driver@fleet.test', subject: 'Panic alert', text: 'Device 42 pressed panic.' })
    expect(f.calls[0]!.headers).toBeUndefined() // no config set → no header
  })

  it('a malformed SMTP_URL disables email (undefined) instead of crashing the worker', () => {
    const create = vi.fn(() => { throw new Error('invalid URL') }) // nodemailer rejects a bad url
    // must NOT throw — a bad email env can never take down the position pipeline
    expect(buildEmailTransport({ SMTP_URL: 'not a url', MAIL_FROM: 'a@b.c' }, create)).toBeUndefined()
    expect(create).toHaveBeenCalledOnce()
  })

  it('adds the SES config-set header for bounce/complaint routing when configured', async () => {
    const f = fakeMailer()
    const t = buildEmailTransport({ SMTP_URL: 'smtp://h', MAIL_FROM: 'a@b.c', SES_CONFIG_SET: 'orbetra-notifications' }, f.create)!
    await t.send('x@y.z', 's', 'b')
    expect(f.calls[0]!.headers).toEqual({ 'X-SES-CONFIGURATION-SET': 'orbetra-notifications' })
  })
})
