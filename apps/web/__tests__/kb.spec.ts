import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { beforeEach, describe, expect, it, vi } from 'vitest'

import { isVisible, KB, KB_META, metaBySlug, metaForScreen } from '@orbetra/kb'

import { kbLang, kbPath, kbProductName, kbViewer } from '../src/lib/kb.js'
import { PLATFORM_NAME } from '../src/lib/branding.js'

vi.mock('../src/lib/auth.js', () => ({ getCurrentUser: () => currentUser }))

let currentUser: { role: string; entitlements: Record<string, boolean> } | null = null

const ALL_ENTITLEMENTS = {
  whiteLabel: true,
  customDomains: true,
  subAccounts: true,
  apiAccess: true,
  webhooks: true,
  smsGateway: true,
}

beforeEach(() => {
  currentUser = null
})

describe('kbPath', () => {
  it('keeps help inside the app — never a link out to somebody else\'s domain', () => {
    expect(kbPath(KB.geofences)).toBe('/app/learn/geofences')
    expect(kbPath(KB.customDomain)).toBe('/app/learn/custom-domain')
  })

  /**
   * The one thing the compiler cannot check here.
   *
   * TanStack's `Link` validates `to` against the route tree only for STRING LITERALS; a value of
   * type `string` — which is what `kbPath()` returns — is accepted as-is. So a help path that no
   * route serves compiles cleanly and 404s at runtime, and it would do so for EVERY help link in
   * the product at once. This pins the prefix to the routes that actually exist.
   */
  it('composes a path the router actually serves', () => {
    const router = readFileSync(resolve(import.meta.dirname, '../src/router.tsx'), 'utf8')
    expect(router).toContain("path: '/learn'")
    expect(router).toContain("path: '/learn/$slug'")
    // …both as children of the /app route, which is what makes the prefix right
    expect(router).toMatch(/appRoute\.addChildren\(\[[^\]]*learnRoute[^\]]*\]\)/s)
    expect(router).toMatch(/appRoute\.addChildren\(\[[^\]]*learnArticleRoute[^\]]*\]\)/s)
    expect(kbPath('x')).toBe('/app/learn/x')
  })
})

describe('kbLang', () => {
  it('maps the reader\'s language onto one the knowledge base is written in', () => {
    expect(kbLang('lt')).toBe('lt')
    expect(kbLang('de-DE')).toBe('de')
    expect(kbLang('pl-PL')).toBe('pl')
    expect(kbLang('en-GB')).toBe('en')
  })

  it('falls back to English for anything else, including undefined', () => {
    expect(kbLang(undefined)).toBe('en')
    expect(kbLang('fr')).toBe('en')
    expect(kbLang('')).toBe('en')
  })
})

describe('kbProductName', () => {
  /**
   * The substitution for `{product}` in the prose. The white-label branch is the one that matters:
   * an unnamed tenant must NOT fall back to ours — the sidebar shows no mark rather than ours for
   * exactly the same reason, and a help article that says our name on their domain is the same leak
   * wearing a different hat.
   */
  it('uses the tenant\'s configured name', () => {
    expect(kbProductName({ productName: 'FleetKlientas' }, true, 'the platform')).toBe('FleetKlientas')
    expect(kbProductName({ productName: 'FleetKlientas' }, false, 'the platform')).toBe('FleetKlientas')
  })

  it('uses a neutral noun on a white-label host with no name set — never ours', () => {
    expect(kbProductName(null, true, 'the platform')).toBe('the platform')
    expect(kbProductName({}, true, 'the platform')).toBe('the platform')
    expect(kbProductName({ productName: '   ' }, true, 'the platform')).toBe('the platform')
  })

  it('uses the platform name on our own host', () => {
    expect(kbProductName(null, false, 'the platform')).toBe(PLATFORM_NAME)
  })
})

describe('kbViewer', () => {
  it('treats an unknown role as not an admin', () => {
    currentUser = null
    expect(kbViewer(false).isAdmin).toBe(false)
  })

  it('counts tenant and platform admins as admins, and nobody else', () => {
    for (const role of ['tsp_admin', 'platform_admin']) {
      currentUser = { role, entitlements: {} }
      expect(kbViewer(false).isAdmin, role).toBe(true)
    }
    for (const role of ['account_manager', 'viewer']) {
      currentUser = { role, entitlements: {} }
      expect(kbViewer(false).isAdmin, role).toBe(false)
    }
  })

  it('carries the tenant\'s entitlements through, so a gated article follows the plan', () => {
    currentUser = { role: 'tsp_admin', entitlements: ALL_ENTITLEMENTS }
    const v = kbViewer(false)
    expect(v.entitlements).toEqual(ALL_ENTITLEMENTS)
    expect(isVisible(metaBySlug(KB.branding)!, v)).toBe(true)

    currentUser = { role: 'tsp_admin', entitlements: { ...ALL_ENTITLEMENTS, whiteLabel: false } }
    expect(isVisible(metaBySlug(KB.branding)!, kbViewer(false))).toBe(false)
  })
})

describe('what a reseller\'s customer may be shown', () => {
  /**
   * The load-bearing case. On a white-label host the reader may be a reseller's customer: articles
   * about OUR plans, OUR invoices and what happens when OUR invoice goes unpaid name a commercial
   * relationship they are not in, with a company they have never heard of.
   */
  it('withholds every platform-business article from a customer on a reseller\'s host', () => {
    currentUser = { role: 'account_manager', entitlements: ALL_ENTITLEMENTS }
    const shown = KB_META.filter((m) => isVisible(m, kbViewer(true))).map((m) => m.slug)
    for (const slug of [KB.plansAndLimits, KB.unpaidWhatHappens]) {
      expect(shown, slug).not.toContain(slug)
    }
    // …and the operational half is still there. A customer on a reseller's domain gets the manual.
    for (const slug of [KB.howTrackingWorks, KB.geofences, KB.deviceNotReporting, KB.glossary]) {
      expect(shown, slug).toContain(slug)
    }
  })

  it('still shows them to the RESELLER on their own host — they pay those invoices', () => {
    currentUser = { role: 'tsp_admin', entitlements: ALL_ENTITLEMENTS }
    const shown = KB_META.filter((m) => isVisible(m, kbViewer(true))).map((m) => m.slug)
    expect(shown).toContain(KB.billingAndInvoices)
    expect(shown).toContain(KB.unpaidWhatHappens)
  })

  it('shows them on our own host', () => {
    currentUser = { role: 'tsp_admin', entitlements: ALL_ENTITLEMENTS }
    const shown = KB_META.filter((m) => isVisible(m, kbViewer(false))).map((m) => m.slug)
    expect(shown).toContain(KB.billingAndInvoices)
  })

  it('withholds admin-only articles from an operator, whichever host they are on', () => {
    currentUser = { role: 'account_manager', entitlements: ALL_ENTITLEMENTS }
    for (const whiteLabel of [true, false]) {
      const shown = KB_META.filter((m) => isVisible(m, kbViewer(whiteLabel))).map((m) => m.slug)
      expect(shown, String(whiteLabel)).not.toContain(KB.customerAccounts)
      expect(shown, String(whiteLabel)).toContain(KB.mapBasics)
    }
  })
})

describe('the screens the help claims to explain', () => {
  it('names routes this app actually serves', () => {
    // mirrors router.tsx's /app children; a renamed route must not leave an article pointing at a
    // path that no longer exists — the "related help" would simply stop appearing, silently
    const ROUTES = new Set([
      '/app', '/app/dashboard', '/app/devices', '/app/accounts', '/app/drivers', '/app/maintenance',
      '/app/trips', '/app/routing', '/app/playback', '/app/geofences', '/app/rules', '/app/events',
      '/app/reports', '/app/api-keys', '/app/webhooks', '/app/branding', '/app/audit', '/app/settings',
    ])
    for (const m of KB_META) {
      if (m.screen !== undefined) expect(ROUTES.has(m.screen), `${m.slug} -> ${m.screen}`).toBe(true)
    }
  })

  it('has help for the screens a newcomer meets first', () => {
    for (const screen of ['/app', '/app/devices', '/app/geofences', '/app/rules', '/app/reports']) {
      expect(metaForScreen(screen).length, screen).toBeGreaterThan(0)
    }
  })
})
