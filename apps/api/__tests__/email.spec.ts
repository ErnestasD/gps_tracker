import { describe, expect, it } from 'vitest'

import { configureEmailPlatform, renderBrandedEmail, resetEmailPlatform } from '../src/email/layout.js'

describe('E03-5 AC[3]: branded email layout', () => {
  it('renders tenant name, logo and accent color', () => {
    const html = renderBrandedEmail(
      { productName: 'Acme Track', primary: '#ff8800', logoUrl: 'https://cdn.acme.test/logo.png', supportEmail: 'help@acme.test' },
      'Acme Inc',
      { subject: 'Alert', bodyHtml: '<p>Your device moved.</p>' },
    )
    expect(html).toContain('Acme Track')
    expect(html).toContain('https://cdn.acme.test/logo.png')
    expect(html).toContain('#ff8800')
    expect(html).toContain('help@acme.test')
    expect(html).toContain('<p>Your device moved.</p>')
    expect(html).toMatchSnapshot()
  })

  it('EMPTY branding is not a white-label tenant — the header is the PLATFORM, not the customer', () => {
    // A tenant that configured nothing is not a reseller: they are a customer of ours, and the mail
    // is from the product they signed up to. Heading it with their own company name read as if they
    // had sent it to themselves, and left the platform's own mail with no platform identity at all.
    const html = renderBrandedEmail({}, 'Bare Tenant', { subject: 'x', bodyHtml: '<p>hi</p>' })
    expect(html).toContain('Orbetra')
    expect(html).not.toContain('Bare Tenant')
    expect(html).toContain('#5253DA') // the product accent, same token the app uses
    expect(html).not.toContain('<img') // no logo configured ⇒ text, never a broken image
  })

  it('ANY branding field means the tenant owns the header — colours alone are enough', () => {
    // Keying white-label off logoUrl/productName alone classified a reseller who had set only their
    // colours as "not white-label" and shipped OUR logo to THEIR customers (review HIGH).
    const html = renderBrandedEmail({ primary: '#ff8800', supportEmail: 'help@reseller.lt' }, 'UAB Reseller', { subject: 'x', bodyHtml: '<p>hi</p>' })
    expect(html).toContain('UAB Reseller')
    expect(html).not.toContain('Orbetra')
  })

  it('the configured platform logo is used, and only for mail that is NOT white-labelled', () => {
    configureEmailPlatform({ name: 'Orbetra', logoUrl: 'https://orbetra.com/email-logo.png' })
    try {
      const platform = renderBrandedEmail({}, 'Bare Tenant', { subject: 'x', bodyHtml: '<p>hi</p>' })
      expect(platform).toContain('https://orbetra.com/email-logo.png')
      expect(platform).toContain('alt="Orbetra"') // a blocked image degrades to the name, not a box
      const tenant = renderBrandedEmail({ productName: 'VrummTrack' }, 'Vrumm', { subject: 'x', bodyHtml: '<p>hi</p>' })
      expect(tenant).not.toContain('orbetra.com/email-logo.png')
      // an http platform logo is refused the same way a tenant's is
      configureEmailPlatform({ name: 'Orbetra', logoUrl: 'http://orbetra.com/email-logo.png' })
      expect(renderBrandedEmail({}, 'Bare Tenant', { subject: 'x', bodyHtml: '<p>hi</p>' })).not.toContain('<img')
    } finally {
      resetEmailPlatform() // module state — leaving it set poisons every later spec in this worker
    }
  })

  it('escapes HTML in tenant-controlled strings (no injection)', () => {
    const html = renderBrandedEmail(
      { productName: '<script>alert(1)</script>', supportEmail: 'a@b.c' },
      'T',
      { subject: 'x', bodyHtml: '<p>ok</p>' },
    )
    expect(html).not.toContain('<script>alert(1)</script>')
    expect(html).toContain('&lt;script&gt;')
  })
})
