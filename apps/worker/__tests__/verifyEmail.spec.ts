import { describe, expect, it } from 'vitest'

import { renderVerifyEmail } from '../src/notify/verifyEmail.js'

/**
 * The mail that ACTIVATES a self-serve signup (audit MED #67). It is not a convenience: until its
 * link is clicked the account cannot authenticate at all, which is what stops signup's free branch
 * from answering "does this address exist" through a follow-up login.
 */
const base = { verifyUrl: 'https://app.orbetra.test/verify-email?token=abc123', expiresHours: 48, brand: 'Orbetra' }

describe('renderVerifyEmail', () => {
  it('carries the activation link in both the HTML button and the plain-text body', () => {
    const { html, text, subject } = renderVerifyEmail({ ...base, locale: 'en' })
    expect(subject).toMatch(/activate/i)
    for (const body of [html, text]) expect(body).toContain('https://app.orbetra.test/verify-email?token=abc123')
  })

  it('says the account is UNUSABLE until the link is clicked — the recipient must not wait for nothing', () => {
    const { text } = renderVerifyEmail({ ...base, locale: 'en' })
    expect(text).toMatch(/cannot be signed in to/i)
    expect(text).toContain('48 hours')
  })

  it('tells a recipient who did NOT sign up that ignoring it is safe and self-cleaning', () => {
    // a stranger can type anyone's address, so this mail reaches people who did nothing
    const { text } = renderVerifyEmail({ ...base, locale: 'en' })
    expect(text).toMatch(/didn't sign up/i)
    expect(text).toMatch(/removed by itself/i)
  })

  it('localizes to the four shipped languages and falls back to en', () => {
    expect(renderVerifyEmail({ ...base, locale: 'lt' }).subject).toContain('aktyvuotumėte')
    expect(renderVerifyEmail({ ...base, locale: 'de' }).subject).toContain('aktivieren')
    expect(renderVerifyEmail({ ...base, locale: 'pl' }).subject).toContain('aktywować')
    expect(renderVerifyEmail({ ...base, locale: 'xx' }).subject).toMatch(/activate/i)
  })

  it('escapes tenant-supplied branding and a hostile URL', () => {
    const { html } = renderVerifyEmail({
      ...base,
      verifyUrl: 'https://app.test/verify-email?token="><script>alert(1)</script>',
      locale: 'en',
      brand: '<script>alert(1)</script>',
      tenantName: '<img src=x onerror=alert(1)>',
    })
    expect(html).not.toContain('<script>')
    expect(html).not.toContain('<img src=x')
  })

  it('honours a valid branding accent and ignores a malformed one', () => {
    expect(renderVerifyEmail({ ...base, locale: 'en', branding: { primary: '#123ABC' } }).html).toContain('#123ABC')
    expect(renderVerifyEmail({ ...base, locale: 'en', branding: { primary: 'red; }' } }).html).toContain('#4DA3FF')
  })
})
