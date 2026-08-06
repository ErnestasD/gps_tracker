import { describe, expect, it } from 'vitest'

import { renderSignupExistsEmail } from '../src/notify/signupExistsEmail.js'

/**
 * The out-of-band half of the non-enumerating signup (audit MED #67). Public signup answers a
 * duplicate address with the same 201 as a real one; this mail is how the address's OWNER — the only
 * party entitled to know — finds out, and it is the reason the change is not simply a UX regression.
 */
const base = { loginUrl: 'https://app.orbetra.test/login', resetUrl: 'https://app.orbetra.test/forgot-password', brand: 'Orbetra' }

describe('renderSignupExistsEmail', () => {
  it('carries BOTH ways back in — sign in, or reset — in HTML and plain text', () => {
    const { html, text, subject } = renderSignupExistsEmail({ ...base, locale: 'en' })
    expect(subject).toBe('You already have an Orbetra account')
    for (const body of [html, text]) {
      expect(body).toContain('https://app.orbetra.test/login')
      expect(body).toContain('https://app.orbetra.test/forgot-password')
    }
  })

  it('carries NO token and nothing the signup attempt supplied', () => {
    // the recipient cannot tell whether the attempt was a stranger or their own forgotten signup, so
    // quoting the attempt back would turn this into a free text channel into their inbox
    const { html, text } = renderSignupExistsEmail({ ...base, locale: 'en' })
    for (const body of [html, text]) {
      expect(body).not.toMatch(/token/i)
      expect(body).not.toMatch(/password=|\?t=/)
    }
  })

  it('says plainly that nothing happened — the recipient must not think they were breached', () => {
    const { text } = renderSignupExistsEmail({ ...base, locale: 'en' })
    expect(text).toContain('Nobody got into your account')
  })

  it('localizes to the four shipped languages and falls back to en', () => {
    expect(renderSignupExistsEmail({ ...base, locale: 'lt' }).subject).toBe('Su šiuo adresu Orbetra paskyra jau yra')
    expect(renderSignupExistsEmail({ ...base, locale: 'de' }).subject).toBe('Für diese Adresse besteht bereits ein Orbetra-Konto')
    expect(renderSignupExistsEmail({ ...base, locale: 'pl' }).subject).toBe('Dla tego adresu istnieje już konto Orbetra')
    expect(renderSignupExistsEmail({ ...base, locale: 'xx' }).subject).toBe('You already have an Orbetra account')
  })

  it('escapes a tenant-supplied brand and a hostile URL — this mail is rendered from tenant branding', () => {
    const { html } = renderSignupExistsEmail({
      ...base,
      loginUrl: 'https://app.test/login?x="><script>alert(1)</script>',
      locale: 'en',
      brand: '<script>alert(1)</script>',
      tenantName: '<img src=x onerror=alert(1)>',
    })
    // the check is that they are ESCAPED, not that the characters vanish: `onerror=` survives as
    // inert text inside `&lt;img …&gt;`, which is exactly right — asserting its absence would be
    // asserting the wrong property and would pass on a template that dropped the field entirely
    expect(html).not.toContain('<script>')
    expect(html).not.toContain('<img src=x')
    expect(html).toContain('&lt;')
  })

  it('honours a valid branding accent and ignores a malformed one', () => {
    expect(renderSignupExistsEmail({ ...base, locale: 'en', branding: { primary: '#123ABC' } }).html).toContain('#123ABC')
    expect(renderSignupExistsEmail({ ...base, locale: 'en', branding: { primary: 'red; }' } }).html).toContain('#5253DA') // the product accent, same as --accent in the app
  })
})
