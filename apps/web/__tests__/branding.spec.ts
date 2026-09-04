import { describe, expect, it } from 'vitest'

import { SURFACE_LIGHT_REF, SURFACE_REF, clampForTheme, contrast, dnsRecordsFor, ensureContrast, expectedTxt, faviconLinks, fqdn, hasPrefix, relativeName } from '../src/lib/branding.js'

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
      name: '_orbetra-verify.dokigo.lt.',
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
      name: 'fleet.example.com.',
      value: 'dash.orbetra.com.',
      purposeKey: 'branding.dnsPurposeCname',
      // a word in front of the domain, so this is the row to use
      choice: 'use',
    })
  })

  it('keeps the TXT and the CNAME on DIFFERENT names, which is the point', () => {
    // RFC 1034 §3.6.2: a CNAME cannot coexist with any other record on the same owner name, and
    // Cloudflare and Route 53 enforce it. The old apex TXT made the two records mutually exclusive.
    const [txt, cname] = dnsRecordsFor('dokigo.lt', TOKEN, 'dash.orbetra.com')
    expect(txt!.name).not.toBe(cname!.name)
  })

  /**
   * The APEX alternative — the case the product previously refused to serve.
   *
   * A zone root can never hold a CNAME: the apex always carries SOA and NS, and RFC 1034 §3.6.2
   * forbids a CNAME beside any other data. So a white-label customer who wants THEIR OWN domain to
   * be the dashboard — the whole thing they are paying for — could not follow the only instruction
   * we gave.
   */
  it('offers an A record beside the CNAME, as the alternative for a domain root', () => {
    const rows = dnsRecordsFor('dokigo.lt', TOKEN, 'dash.orbetra.com', ['185.80.129.33'])
    expect(rows.map((r) => r.type)).toEqual(['TXT', 'CNAME', 'A'])
    const a = rows[2]!
    expect(a.name).toBe('dokigo.lt.')
    expect(a.value).toBe('185.80.129.33')
    // on a bare domain the A row is the answer and the CNAME is the one to skip
    expect(a.choice).toBe('use')
    expect(rows[1]!.choice).toBe('other')
  })

  it('lists every edge address, so a multi-homed edge does not silently hand over one of them', () => {
    const rows = dnsRecordsFor('dokigo.lt', TOKEN, 'dash.orbetra.com', ['185.80.129.33', '185.80.129.34'])
    expect(rows.filter((r) => r.type === 'A').map((r) => r.value)).toEqual(['185.80.129.33', '185.80.129.34'])
  })

  it('shows no A row when the deployment has no address to give', () => {
    expect(dnsRecordsFor('dokigo.lt', TOKEN, 'dash.orbetra.com', []).map((r) => r.type)).toEqual(['TXT', 'CNAME'])
  })

  it('omits the CNAME rather than inventing a target when the edge host is unknown', () => {
    const rows = dnsRecordsFor('dokigo.lt', TOKEN, null)
    expect(rows.map((r) => r.type)).toEqual(['TXT'])
  })

  it('mirrors the legacy apex form the server still accepts', () => {
    expect(expectedTxt(TOKEN)).toBe(`orbetra-verify=${TOKEN}`)
  })
})


/**
 * Which routing record this address can actually use.
 *
 * Showing both and leaving the reader to work out which applies is what the founder pushed back
 * on — a programmer could not tell, so a fleet operator certainly cannot.
 */
describe('hasPrefix — has this address a word in front of the domain?', () => {
  it('is true for an address with something in front', () => {
    expect(hasPrefix('fleet.dokigo.lt')).toBe(true)
    expect(hasPrefix('track.acme.example.com')).toBe(true)
  })

  it('is false for the bare domain, which cannot take a CNAME', () => {
    expect(hasPrefix('dokigo.lt')).toBe(false)
    expect(hasPrefix('acme.com')).toBe(false)
  })

  it('marks the CNAME on a prefixed address and the A on a bare one', () => {
    const sub = dnsRecordsFor('fleet.dokigo.lt', '2a129fdfb3fcf34ae2ebcb3b1f020087', 'dash.orbetra.com', ['185.80.129.33'])
    expect(sub.find((r) => r.type === 'CNAME')!.choice).toBe('use')
    expect(sub.find((r) => r.type === 'A')!.choice).toBe('other')

    const bare = dnsRecordsFor('dokigo.lt', '2a129fdfb3fcf34ae2ebcb3b1f020087', 'dash.orbetra.com', ['185.80.129.33'])
    expect(bare.find((r) => r.type === 'CNAME')!.choice).toBe('other')
    expect(bare.find((r) => r.type === 'A')!.choice).toBe('use')
  })

  it('leaves the TXT row unmarked — it is not one of the two choices', () => {
    const rows = dnsRecordsFor('dokigo.lt', '2a129fdfb3fcf34ae2ebcb3b1f020087', 'dash.orbetra.com', ['185.80.129.33'])
    expect(rows.find((r) => r.type === 'TXT')!.choice).toBeUndefined()
  })
})


/**
 * The trailing dot, which decides whether the record lands where the customer thinks it does.
 *
 * The panel used to say "never add a trailing dot". A control panel that follows zone-file rules —
 * the founder's Lithuanian registrar is one — then treats the pasted full name as RELATIVE and
 * appends the zone: `fleet.dokigo.lt` was filed at `fleet.dokigo.lt.dokigo.lt`, the record list
 * looked perfect, and the browser said the site does not exist. The proof was in the same zone:
 * the TXT entered WITH a dot resolved, the CNAME entered without one did not.
 */
describe('trailing dot — absolute names', () => {
  const TOKEN2 = '4b967040e5a9670cf204733bfad9a8d2'

  it('ends every NAME with a dot, so no panel can append the zone twice', () => {
    for (const rec of dnsRecordsFor('fleet.dokigo.lt', TOKEN2, 'dash.orbetra.com', ['185.80.129.33'])) {
      expect(rec.name.endsWith('.'), `${rec.type} name`).toBe(true)
    }
  })

  it('ends a hostname VALUE with a dot too — a bare target gets the zone appended just the same', () => {
    const cname = dnsRecordsFor('fleet.dokigo.lt', TOKEN2, 'dash.orbetra.com', [])[1]!
    expect(cname.value).toBe('dash.orbetra.com.')
  })

  it('leaves values that are NOT names alone — a token and an address take no dot', () => {
    const rows = dnsRecordsFor('fleet.dokigo.lt', TOKEN2, 'dash.orbetra.com', ['185.80.129.33'])
    expect(rows.find((r) => r.type === 'TXT')!.value).toBe(TOKEN2)
    expect(rows.find((r) => r.type === 'A')!.value).toBe('185.80.129.33')
  })

  it('does not double the dot when one is already there', () => {
    expect(fqdn('dash.orbetra.com.')).toBe('dash.orbetra.com.')
    expect(fqdn('dash.orbetra.com')).toBe('dash.orbetra.com.')
  })

  it('offers the relative form for a panel that wants only the part before the domain', () => {
    expect(relativeName('_orbetra-verify.fleet.dokigo.lt.', 'dokigo.lt')).toBe('_orbetra-verify.fleet')
    expect(relativeName('fleet.dokigo.lt.', 'dokigo.lt')).toBe('fleet')
    // the zone itself is written `@` in every zone-file panel
    expect(relativeName('dokigo.lt.', 'dokigo.lt')).toBe('@')
    // a name outside the zone is left whole rather than mangled
    expect(relativeName('other.example.com.', 'dokigo.lt')).toBe('other.example.com')
  })
})
