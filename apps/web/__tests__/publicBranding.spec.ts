import { describe, expect, it } from 'vitest'

import { brandFromResponse } from '../src/lib/publicBranding'

/**
 * Whose brand a pre-auth page wears. The permissive direction ships OUR logo to a reseller's
 * customers — the exact promise apps/site sells — and the strict direction blanks our own login
 * page, so both are worth pinning.
 */
describe('brandFromResponse', () => {
  it('an unknown host (whiteLabel:false) is the PLATFORM', () => {
    expect(brandFromResponse({ whiteLabel: false })).toEqual({ whiteLabel: false, branding: {} })
    expect(brandFromResponse({ whiteLabel: false, branding: {} })).toEqual({ whiteLabel: false, branding: {} })
  })

  it('a network failure is UNKNOWN, not the platform — it must never draw our wordmark', () => {
    // it used to resolve to PLATFORM, so a blocked request or a 502 mid-deploy rendered the Orbetra
    // mark and a link to our marketing site on a reseller's own login page
    expect(brandFromResponse(null)).toBeNull()
  })

  it('the SERVER decides white-label, not the shape of the payload', () => {
    // a reseller who verified their domain before filling in the branding form has NO branding
    // fields and is still a white-label host — inferring it client-side got that exactly backwards
    expect(brandFromResponse({ whiteLabel: true })).toEqual({ whiteLabel: true, productName: undefined, branding: {} })
    expect(brandFromResponse({ whiteLabel: true, branding: { primary: '#ff8800' } })?.whiteLabel).toBe(true)
    // …and branding fields WITHOUT the flag are not enough to claim the page
    expect(brandFromResponse({ branding: { primary: '#ff8800' } })?.whiteLabel).toBe(false)
  })

  it('carries the tenant’s product name and branding through unchanged', () => {
    const branding = { primary: '#ff8800', logoUrl: 'https://x.test/l.png' }
    expect(brandFromResponse({ whiteLabel: true, branding, productName: 'VrummTrack' })).toEqual({ whiteLabel: true, productName: 'VrummTrack', branding })
  })

  it('a malformed body never throws — this runs before login', () => {
    for (const bad of [{ whiteLabel: true, branding: null }, { whiteLabel: true, branding: 'nope' }, { whiteLabel: true, branding: 42 }]) {
      expect(brandFromResponse(bad as never)?.branding).toEqual({})
    }
  })
})
