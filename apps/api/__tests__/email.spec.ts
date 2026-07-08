import { describe, expect, it } from 'vitest'

import { renderBrandedEmail } from '../src/email/layout.js'

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

  it('falls back to tenant name + default accent when branding is empty', () => {
    const html = renderBrandedEmail({}, 'Bare Tenant', { subject: 'x', bodyHtml: '<p>hi</p>' })
    expect(html).toContain('Bare Tenant')
    expect(html).toContain('#4DA3FF')
    expect(html).not.toContain('<img')
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
