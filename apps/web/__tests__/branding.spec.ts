import { describe, expect, it } from 'vitest'

import { SURFACE_LIGHT_REF, SURFACE_REF, clampForTheme, contrast, dnsRecordsFor, ensureContrast, expectedTxt, faviconLinks } from '../src/lib/branding.js'

/**
 * White-label theming math (E03-5). No DOM: we test the pure WCAG contrast
 * helpers that back applyBranding's auto-lighten fallback. A tenant that picks a
 * near-black accent must not vanish against the dark app surface.
 */
describe('branding contrast fallback', () => {
  it('contrast is symmetric and ≥1', () => {
    expect(contrast('#ffffff', '#000000')).toBeCloseTo(21, 0)
    expect(contrast('#000000', '#ffffff')).toBeCloseTo(21, 0)
    expect(contrast('#111a2e', '#111a2e')).toBeCloseTo(1, 5)
  })

  it('lightens a too-dark accent until it reads on the surface (≥3:1) or gives up', () => {
    const dark = '#132038' // barely brighter than the surface → fails 3:1
    expect(contrast(dark, SURFACE_REF)).toBeLessThan(3)
    const fixed = ensureContrast(dark)
    expect(fixed).not.toBe(dark) // it moved
    // either it reached AA, or it hit the iteration cap having only lightened
    expect(contrast(fixed, SURFACE_REF)).toBeGreaterThan(contrast(dark, SURFACE_REF))
  })

  it('leaves an already-legible accent untouched', () => {
    const bright = '#4da3ff' // default accent, high contrast on dark
    expect(contrast(bright, SURFACE_REF)).toBeGreaterThanOrEqual(3)
    expect(ensureContrast(bright)).toBe(bright)
  })

  it('never produces an invalid hex', () => {
    expect(ensureContrast('#010101')).toMatch(/^#[0-9a-f]{6}$/)
  })
})

describe('theme-aware clamping (white-label follow-up)', () => {
  it('light theme darkens a too-light accent until it reads on white (≥3:1)', () => {
    const amber = '#fbbf24' // passes on the dark surface, unreadable on white
    expect(contrast(amber, SURFACE_LIGHT_REF)).toBeLessThan(3)
    const fixed = clampForTheme(amber, 'light')
    expect(fixed).not.toBe(amber)
    expect(contrast(fixed, SURFACE_LIGHT_REF)).toBeGreaterThanOrEqual(3)
  })

  it('dark theme keeps the lighten behavior (clampForTheme ≡ old ensureContrast)', () => {
    const dark = '#132038'
    expect(clampForTheme(dark, 'dark')).toBe(ensureContrast(dark))
    expect(contrast(clampForTheme(dark, 'dark'), SURFACE_REF)).toBeGreaterThan(contrast(dark, SURFACE_REF))
  })

  it('ensureContrast accepts an explicit theme and defaults to dark', () => {
    const amber = '#fbbf24'
    expect(ensureContrast(amber)).toBe(amber) // already legible on dark → untouched
    expect(ensureContrast(amber, 'light')).toBe(clampForTheme(amber, 'light'))
  })

  it('leaves an already-legible light-theme accent untouched', () => {
    const navy = '#1d4ed8' // dark blue, high contrast on white
    expect(contrast(navy, SURFACE_LIGHT_REF)).toBeGreaterThanOrEqual(3)
    expect(clampForTheme(navy, 'light')).toBe(navy)
  })

  it('worst case (white on white) stays bounded and never produces invalid hex', () => {
    // ≤4 darken steps: #ffffff → ~#858585 (≈3.7:1) — moved, valid, capped
    const clamped = clampForTheme('#ffffff', 'light')
    expect(clamped).toMatch(/^#[0-9a-f]{6}$/)
    expect(contrast(clamped, SURFACE_LIGHT_REF)).toBeGreaterThan(contrast('#ffffff', SURFACE_LIGHT_REF))
  })

  it('re-clamping for the opposite theme yields a readable color both ways', () => {
    // simulates a theme switch: same tenant hex, per-theme clamp each time
    const hex = '#fbbf24'
    expect(contrast(clampForTheme(hex, 'dark'), SURFACE_REF)).toBeGreaterThanOrEqual(3)
    expect(contrast(clampForTheme(hex, 'light'), SURFACE_LIGHT_REF)).toBeGreaterThanOrEqual(3)
  })
})

describe('white-label favicon (faviconLinks)', () => {
  it('uses the tenant logo for both icon + apple-touch when a logoUrl is set', () => {
    const links = faviconLinks('https://cdn.example.com/tenant-logo.png')
    expect(links.map((l) => l.href)).toEqual(['https://cdn.example.com/tenant-logo.png', 'https://cdn.example.com/tenant-logo.png'])
    expect(links.map((l) => l.rel)).toEqual(['icon', 'apple-touch-icon'])
  })
  it('falls back to the Orbetra defaults when the logo is unset or empty', () => {
    for (const v of [undefined, '']) {
      const hrefs = faviconLinks(v).map((l) => l.href)
      expect(hrefs).toContain('/platform-icon.ico')
      expect(hrefs).toContain('/platform-icon.svg')
    }
  })
})

describe('faviconLinks on a WHITE-LABEL host', () => {
  it('no logo ⇒ NO icons — the browser default beats the platform mark in a tenant tab', () => {
    // the previous fallback restored ours whenever a tenant had not set a logo, so our purple mark
    // sat in a reseller's customers' tabs permanently (review HIGH)
    expect(faviconLinks(undefined, true)).toEqual([])
    expect(faviconLinks('', true)).toEqual([])
  })

  it('a logo is used on either kind of host', () => {
    expect(faviconLinks('https://x.test/l.png', true)).toEqual([
      { rel: 'icon', href: 'https://x.test/l.png' },
      { rel: 'apple-touch-icon', href: 'https://x.test/l.png' },
    ])
  })

  it('OUR hosts keep the platform icons', () => {
    expect(faviconLinks(undefined, false).map((l) => l.href)).toContain('/platform-icon.ico')
  })
})

/**
 * The DNS records a pending domain needs.
 *
 * The page used to print one string, `orbetra-verify=2a129…`, under "Add this TXT record to
 * dokigo.lt". Every DNS panel asks for a Type, a Name and a Value, so a single string with an `=`
 * in it reads as a name and a value — the founder read it exactly that way, and a record NAMED
 * `orbetra-verify` never verifies, with nothing to say why.
 */
describe('dnsRecordsFor — the records, in the shape a DNS panel asks for', () => {
  const TOKEN = '2a129fdfb3fcf34ae2ebcb3b1f020087'

  it('puts the ownership TXT on its own name, with the bare token as the value', () => {
    const [txt] = dnsRecordsFor('dokigo.lt', TOKEN, 'dash.orbetra.com')
    expect(txt).toEqual({
      type: 'TXT',
      name: '_orbetra-verify.dokigo.lt',
      value: TOKEN,
      purposeKey: 'branding.dnsPurposeTxt',
    })
    // the value is the token ALONE — the prefix belongs to the legacy apex form, not here
    expect(txt!.value).not.toContain('orbetra-verify=')
  })

  it('points the CNAME at the edge from the domain itself', () => {
    const cname = dnsRecordsFor('fleet.example.com', TOKEN, 'dash.orbetra.com')[1]
    expect(cname).toEqual({
      type: 'CNAME',
      name: 'fleet.example.com',
      value: 'dash.orbetra.com',
      purposeKey: 'branding.dnsPurposeCname',
    })
    // no trailing dot: provider panels reject it, and it belongs only in a raw zone file
    expect(cname!.value.endsWith('.')).toBe(false)
    expect(cname!.name.endsWith('.')).toBe(false)
  })

  it('keeps the TXT and the CNAME on DIFFERENT names, which is the point', () => {
    // RFC 1034 §3.6.2: a CNAME cannot coexist with any other record on the same owner name, and
    // Cloudflare and Route 53 enforce it. The old apex TXT made the two records mutually exclusive.
    const [txt, cname] = dnsRecordsFor('dokigo.lt', TOKEN, 'dash.orbetra.com')
    expect(txt!.name).not.toBe(cname!.name)
  })

  it('omits the CNAME rather than inventing a target when the edge host is unknown', () => {
    const rows = dnsRecordsFor('dokigo.lt', TOKEN, null)
    expect(rows.map((r) => r.type)).toEqual(['TXT'])
  })

  it('mirrors the legacy apex form the server still accepts', () => {
    expect(expectedTxt(TOKEN)).toBe(`orbetra-verify=${TOKEN}`)
  })
})
