import { describe, expect, it } from 'vitest'

import { whiteLabelReadiness, type ReadinessInput } from '../src/readiness.js'

const base: ReadinessInput = { plan: 'tsp_grow', branding: {}, domains: [], platformDomain: 'orbetra.com' }
const full = { productName: 'Dokigo', logoUrl: 'https://d.lt/l.png', faviconUrl: 'https://d.lt/f.png', supportEmail: 'labas@d.lt', primary: '#46D993' }

describe('a Direct customer is never gated', () => {
  it('our brand is the correct brand for them, so nothing is blocked or suggested', () => {
    for (const plan of ['direct_5', 'direct_100']) {
      const r = whiteLabelReadiness({ ...base, plan })
      expect(r, plan).toEqual({ mode: 'not_white_label', ready: true, hardBlockers: [], softHints: [] })
    }
  })

  it('an UNREADABLE plan is not a licence to gate, nor to un-gate', () => {
    // undefined means "we could not read the column". Treating it as "not a reseller" would silently
    // un-gate a real one; treating it as "is a reseller" would lock a paying Direct customer out of
    // creating accounts. It falls through to the domain check — the harmless direction.
    const noHost = whiteLabelReadiness({ ...base, plan: 'gibberish' })
    expect(noHost.ready).toBe(false)
    const withHost = whiteLabelReadiness({ ...base, plan: null, domains: [{ domain: 'fleet.d.lt', verified: true }] })
    expect(withHost.ready).toBe(true)
  })
})

describe('a reseller is ready once their customers have somewhere to arrive', () => {
  it('no verified domain ⇒ NOT ready, and says exactly why', () => {
    const r = whiteLabelReadiness({ ...base, branding: full })
    expect(r.mode).toBe('unconfigured')
    expect(r.ready).toBe(false)
    expect(r.hardBlockers).toEqual(['no_verified_domain'])
  })

  it('a PENDING domain is not a domain — verification is the whole point', () => {
    const r = whiteLabelReadiness({ ...base, domains: [{ domain: 'fleet.d.lt', verified: false }] })
    expect(r.ready).toBe(false)
  })

  it('their own verified domain ⇒ ready, nothing blocking', () => {
    const r = whiteLabelReadiness({ ...base, branding: full, domains: [{ domain: 'fleet.d.lt', verified: true }] })
    expect(r).toEqual({ mode: 'own_domain', ready: true, hardBlockers: [], softHints: [] })
  })

  it('the platform subdomain ⇒ ready IMMEDIATELY — that is what it is sold as', () => {
    const r = whiteLabelReadiness({ ...base, branding: full, domains: [{ domain: 'dokigo.orbetra.com', verified: true }] })
    expect(r.mode).toBe('platform_subdomain')
    expect(r.ready).toBe(true)
    expect(r.hardBlockers).toEqual([])
    // …but still told what would finish the job, because their customers do see that hostname
    expect(r.softHints).toContain('own_domain')
  })

  it('their own domain outranks a platform subdomain they also hold', () => {
    const r = whiteLabelReadiness({
      ...base,
      branding: full,
      domains: [{ domain: 'dokigo.orbetra.com', verified: true }, { domain: 'fleet.d.lt', verified: true }],
    })
    expect(r.mode).toBe('own_domain')
    expect(r.softHints).not.toContain('own_domain')
  })

  it('without PLATFORM_DOMAIN configured, no domain can be a platform subdomain', () => {
    const r = whiteLabelReadiness({ ...base, platformDomain: undefined, domains: [{ domain: 'dokigo.orbetra.com', verified: true }] })
    expect(r.mode).toBe('own_domain')
  })

  it('does not mistake a domain that merely ENDS in the same letters', () => {
    const r = whiteLabelReadiness({ ...base, domains: [{ domain: 'notorbetra.com', verified: true }] })
    expect(r.mode).toBe('own_domain')
  })
})

describe('missing branding is a hint, never a blocker', () => {
  it('a reseller with a host but no branding at all is READY, and told what is thin', () => {
    const r = whiteLabelReadiness({ ...base, domains: [{ domain: 'fleet.d.lt', verified: true }] })
    expect(r.ready).toBe(true)
    expect(r.hardBlockers).toEqual([])
    // no logo means we render THEIR name as text — plain, but never ours. Blocking here would cost
    // real anger and buy no protection.
    expect(r.softHints).toEqual(['product_name', 'logo', 'support_email', 'colors'])
  })

  it('the favicon hint waits until there IS a logo to fall back from', () => {
    const noLogo = whiteLabelReadiness({ ...base, branding: { productName: 'D' }, domains: [{ domain: 'f.d.lt', verified: true }] })
    expect(noLogo.softHints).not.toContain('favicon')
    const withLogo = whiteLabelReadiness({ ...base, branding: { ...full, faviconUrl: undefined }, domains: [{ domain: 'f.d.lt', verified: true }] })
    expect(withLogo.softHints).toEqual(['favicon'])
  })

  it('whitespace is not a value', () => {
    const r = whiteLabelReadiness({ ...base, branding: { productName: '   ', logoUrl: '' }, domains: [{ domain: 'f.d.lt', verified: true }] })
    expect(r.softHints).toContain('product_name')
    expect(r.softHints).toContain('logo')
  })
})
