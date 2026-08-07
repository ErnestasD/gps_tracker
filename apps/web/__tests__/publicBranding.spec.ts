import { describe, expect, it } from 'vitest'

import { brandFromResponse } from '../src/lib/publicBranding'

/**
 * Whose brand a pre-auth page wears. The permissive direction ships OUR logo to a reseller's
 * customers — the exact promise apps/site sells — and the strict direction blanks our own login
 * page, so both are worth pinning.
 */
describe('brandFromResponse', () => {
  it('an unknown host (`{}`) is the PLATFORM, not a tenant with empty branding', () => {
    expect(brandFromResponse({ branding: {} })).toEqual({ whiteLabel: false, branding: {} })
    expect(brandFromResponse({})).toEqual({ whiteLabel: false, branding: {} })
  })

  it('a network failure falls back to the platform rather than a blank card', () => {
    expect(brandFromResponse(null).whiteLabel).toBe(false)
  })

  it('ANY configured field makes it the tenant’s page — colours alone are enough', () => {
    // the same trap the email header fell into: keying on logo/productName classified a reseller
    // who had set only their colours as "not white-label"
    expect(brandFromResponse({ branding: { primary: '#ff8800' } }).whiteLabel).toBe(true)
    expect(brandFromResponse({ branding: {}, productName: 'VrummTrack' }).whiteLabel).toBe(true)
    expect(brandFromResponse({ branding: { logoUrl: 'https://x.test/l.png' } }).whiteLabel).toBe(true)
  })

  it('carries the tenant’s product name and branding through unchanged', () => {
    const branding = { primary: '#ff8800', logoUrl: 'https://x.test/l.png' }
    expect(brandFromResponse({ branding, productName: 'VrummTrack' })).toEqual({ whiteLabel: true, productName: 'VrummTrack', branding })
  })

  it('a malformed body is the platform, never a throw — this runs before login', () => {
    for (const bad of [{ branding: null }, { branding: 'nope' }, { branding: 42 }]) {
      expect(brandFromResponse(bad as never).whiteLabel).toBe(false)
    }
  })
})
