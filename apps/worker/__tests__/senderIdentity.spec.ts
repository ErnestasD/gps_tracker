import { describe, expect, it } from 'vitest'

import { senderWithName } from '../src/notify/emailTransport.js'

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
