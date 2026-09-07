import { describe, expect, it } from 'vitest'

import { safeSender, senderWithName } from '../src/notify/emailTransport.js'

/**
 * The `From:` display name (audit W-3).
 *
 * This is the line an inbox shows BEFORE the message is opened, so for a reseller it is the most
 * visible identity in the whole message — and it read as ours on every mail they sent.
 * PROJECT_PLAN §6.2 lists "email display-name per tenant on shared sending domain" as a V1
 * requirement; only the ADDRESS needs ADR-036, because a display name over a shared sending domain
 * asks nothing of the tenant's DNS and breaks no DMARC alignment.
 */
describe('senderWithName', () => {
  it('puts the tenant name over the address we own', () => {
    expect(senderWithName('hello@orbetra.com', 'Dokigo')).toBe('"Dokigo" <hello@orbetra.com>')
  })

  it('replaces a display name the deployment already configured', () => {
    // MAIL_FROM may be `Name <addr>`; the address is what we keep, the name is the tenant's
    expect(senderWithName('Orbetra <hello@orbetra.com>', 'Dokigo')).toBe('"Dokigo" <hello@orbetra.com>')
  })

  it('leaves the configured sender alone when there is no tenant name', () => {
    // partner/affiliate notices are ours by design and must keep the platform identity
    for (const v of [undefined, '', '   ']) {
      expect(senderWithName('Orbetra <hello@orbetra.com>', v)).toBe('Orbetra <hello@orbetra.com>')
    }
  })

  it('STRIPS CR/LF — a product name must not be able to append headers', () => {
    // the classic header-injection hole: a newline here would let a tenant-controlled string add
    // Bcc: or Content-Type: of its own. nodemailer would probably catch it; a sanitiser that relies
    // on a library's internals is not a sanitiser.
    const evil = 'Dokigo\r\nBcc: attacker@evil.test'
    const out = senderWithName('hello@orbetra.com', evil)
    expect(out).not.toContain('\r')
    expect(out).not.toContain('\n')
    expect(out).toBe('"Dokigo Bcc: attacker@evil.test" <hello@orbetra.com>')
  })

  it('escapes the two characters that would break out of the quoted string', () => {
    expect(senderWithName('hello@orbetra.com', 'Say "hi"')).toBe('"Say \\"hi\\"" <hello@orbetra.com>')
    expect(senderWithName('hello@orbetra.com', 'back\\slash')).toBe('"back\\\\slash" <hello@orbetra.com>')
    // a name that tries to close the quotes and open a new address cannot
    expect(senderWithName('hello@orbetra.com', '" <evil@attacker.test> x')).toBe('"\\" <evil@attacker.test> x" <hello@orbetra.com>')
  })

  it('bounds the length on its own, without trusting the schema upstream', () => {
    const out = senderWithName('hello@orbetra.com', 'D'.repeat(500))
    expect(out.length).toBeLessThan(120)
    expect(out.endsWith('<hello@orbetra.com>')).toBe(true)
  })

  it('keeps non-ASCII intact for nodemailer to RFC 2047-encode', () => {
    expect(senderWithName('hello@orbetra.com', 'Vežėjai')).toBe('"Vežėjai" <hello@orbetra.com>')
  })
})

/**
 * The `From:` ADDRESS — the other half, and the half that needed DNS (ADR-036, audit W-3).
 *
 * `safeSender` is the send path's own check on a value that began as text a reseller typed into a
 * settings form and ends up in a mail header. The zod schema constrains what may be STORED; this
 * constrains what may be SENT, and they are different guarantees: a row written before the schema
 * tightened, a hand-run SQL fix, or a future caller passing something else bypasses the first and
 * none of them bypass this.
 */
describe('safeSender', () => {
  it('accepts an ordinary tenant sending address', () => {
    for (const a of ['alertai@klientas.lt', 'no-reply@fleet.klientas.co.uk', 'a.b+c@x.io', ' ALERTAI@Klientas.lt ']) {
      expect(safeSender(a), a).toBe(a.trim())
    }
  })

  it('★ refuses anything that could add a header line', () => {
    // The classic injection: a newline in a From: value appends headers of the sender's choosing.
    // Refused rather than stripped — an address we had to repair is an address we do not understand,
    // and unlike a display name there is no "cleaned" version that is still the right mailbox.
    for (const a of [
      'a@x.lt\nBcc: victim@x.lt',
      'a@x.lt\r\nContent-Type: text/html',
      'Orbetra <hello@orbetra.com>',
      'a b@x.lt',
      '"weird name"@x.lt',
      'a@x.lt, b@y.lt',
    ]) {
      expect(safeSender(a), JSON.stringify(a)).toBeUndefined()
    }
  })

  it('refuses shapes that are not one address', () => {
    for (const a of ['', '   ', 'no-at-sign', 'a@@x.lt', 'a@x', 'a@.lt', 'a@x..lt', '@x.lt', 'a@-x.lt', 'a@x-.lt', `${'a'.repeat(400)}@x.lt`]) {
      expect(safeSender(a), a).toBeUndefined()
    }
  })

  it('undefined in, undefined out — the common case is a tenant with no sending domain', () => {
    expect(safeSender(undefined)).toBeUndefined()
  })

  it('★ composes with the display name, and a bad address never reaches the header', () => {
    // the two halves meeting: the tenant's name over the tenant's own address…
    expect(senderWithName(safeSender('alertai@klientas.lt') ?? 'hello@orbetra.com', 'Dokigo'))
      .toBe('"Dokigo" <alertai@klientas.lt>')
    // …and a malformed one falls back to the platform identity rather than failing the send. A
    // message from the wrong name is a leak; a message that never arrives is an outage.
    expect(senderWithName(safeSender('a@x.lt\nBcc: v@x.lt') ?? 'hello@orbetra.com', 'Dokigo'))
      .toBe('"Dokigo" <hello@orbetra.com>')
  })
})
