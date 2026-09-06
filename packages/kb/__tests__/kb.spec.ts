import { describe, expect, it } from 'vitest'

import {
  articleBySlug,
  articlesByCategory,
  bodyText,
  isVisible,
  KB,
  KB_CATEGORIES,
  KB_CATEGORY_IDS,
  KB_LANGS,
  KB_META,
  KB_PRODUCT_TOKEN,
  metaBySlug,
  metaForScreen,
  resolveLink,
  searchArticles,
  visibleArticles,
  withProduct,
  type KbArticle,
  type KbLang,
} from '../src/index.js'
import { KB_ARTICLES } from '../src/content.js'

/** Every `[text](href)` in a document's prose. */
function linksOf(a: KbArticle, lang: KbLang): string[] {
  const out: string[] = []
  const re = /\[(?:[^\]]+)\]\(([^)]+)\)/g
  let m: RegExpExecArray | null
  const hay = `${a.doc[lang].title} ${a.doc[lang].summary} ${bodyText(a.doc[lang])}`
  while ((m = re.exec(hay)) !== null) out.push(m[1]!)
  return out
}

describe('structure', () => {
  it('has articles', () => {
    expect(KB_ARTICLES.length).toBeGreaterThan(30)
  })

  it('has unique slugs, and every slug is exported as a typed constant', () => {
    const slugs = KB_ARTICLES.map((a) => a.slug)
    expect(new Set(slugs).size).toBe(slugs.length)
    expect(new Set(Object.values(KB))).toEqual(new Set(slugs))
  })

  it('slugs are lower-kebab and language-independent', () => {
    for (const a of KB_ARTICLES) expect(a.slug, a.slug).toMatch(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)
  })

  it('every category has a label in every language, and no category is empty', () => {
    expect(KB_CATEGORIES.map((c) => c.id)).toEqual([...KB_CATEGORY_IDS])
    for (const c of KB_CATEGORIES) {
      for (const lang of KB_LANGS) {
        expect(c.label[lang].title.length, `${c.id}/${lang}`).toBeGreaterThan(0)
        expect(c.label[lang].blurb.length, `${c.id}/${lang}`).toBeGreaterThan(0)
      }
      expect(KB_ARTICLES.some((a) => a.category === c.id), c.id).toBe(true)
    }
  })

  it('is listed in category reading order', () => {
    const order = KB_ARTICLES.map((a) => KB_CATEGORY_IDS.indexOf(a.category))
    expect(order).toEqual([...order].sort((a, b) => a - b))
    expect(articlesByCategory(KB_ARTICLES).flatMap((g) => g.articles)).toEqual([...KB_ARTICLES])
  })
})

describe('translations', () => {
  it('every article exists in every language, with real prose', () => {
    for (const a of KB_ARTICLES) {
      for (const lang of KB_LANGS) {
        const doc = a.doc[lang]
        expect(doc, `${a.slug}/${lang}`).toBeDefined()
        expect(doc.title.trim().length, `${a.slug}/${lang} title`).toBeGreaterThan(0)
        expect(doc.summary.trim().length, `${a.slug}/${lang} summary`).toBeGreaterThan(20)
        expect(doc.keywords.length, `${a.slug}/${lang} keywords`).toBeGreaterThan(0)
        expect(doc.blocks.length, `${a.slug}/${lang} blocks`).toBeGreaterThan(2)
      }
    }
  })

  it('a translation is not a copy of the English title', () => {
    for (const a of KB_ARTICLES) {
      for (const lang of KB_LANGS.filter((l) => l !== 'en')) {
        expect(a.doc[lang].title, `${a.slug}/${lang}`).not.toBe(a.doc.en.title)
      }
    }
  })

  it('heading anchors are language-independent — the same ids in the same order', () => {
    for (const a of KB_ARTICLES) {
      const ids = (lang: KbLang) => a.doc[lang].blocks.flatMap((b) => (b.id === undefined ? [] : [b.id]))
      const en = ids('en')
      for (const lang of KB_LANGS) expect(ids(lang), `${a.slug}/${lang}`).toEqual(en)
    }
  })

  it('anchors are unique within an article', () => {
    for (const a of KB_ARTICLES) {
      const ids = a.doc.en.blocks.flatMap((b) => (b.id === undefined ? [] : [b.id]))
      expect(new Set(ids).size, a.slug).toBe(ids.length)
    }
  })

  it('an id only ever sits on a heading — an anchor with nothing to scroll to is a broken link', () => {
    for (const a of KB_ARTICLES) {
      for (const lang of KB_LANGS) {
        for (const b of a.doc[lang].blocks) {
          if (b.id !== undefined) expect(b.h2, `${a.slug}/${lang}/${b.id}`).toBeDefined()
        }
      }
    }
  })

  it('code blocks are byte-identical across languages — a command is not prose', () => {
    for (const a of KB_ARTICLES) {
      const code = (lang: KbLang) => a.doc[lang].blocks.flatMap((b) => (b.code === undefined ? [] : [b.code]))
      const en = code('en')
      for (const lang of KB_LANGS) expect(code(lang), `${a.slug}/${lang}`).toEqual(en)
    }
  })

  it('tables have a consistent width in every language', () => {
    for (const a of KB_ARTICLES) {
      for (const lang of KB_LANGS) {
        for (const b of a.doc[lang].blocks) {
          if (b.table === undefined) continue
          for (const row of b.table.rows) expect(row.length, `${a.slug}/${lang}`).toBe(b.table.head.length)
        }
      }
    }
  })
})

describe('links', () => {
  it('every kb: link points at an article that exists', () => {
    for (const a of KB_ARTICLES) {
      for (const lang of KB_LANGS) {
        for (const href of linksOf(a, lang)) {
          if (!href.startsWith('kb:')) continue
          expect(articleBySlug(KB_ARTICLES, href.slice(3)), `${a.slug}/${lang} -> ${href}`).toBeDefined()
        }
      }
    }
  })

  it('every link uses a known scheme', () => {
    for (const a of KB_ARTICLES) {
      for (const lang of KB_LANGS) {
        for (const href of linksOf(a, lang)) {
          expect(resolveLink(href, 'site').kind, `${a.slug}/${lang} -> ${href}`).not.toBe('text')
        }
      }
    }
  })

  it('resolves each scheme per surface', () => {
    expect(resolveLink('kb:geofences', 'app')).toEqual({ kind: 'article', slug: 'geofences' })
    expect(resolveLink('app:/app/devices', 'app')).toEqual({ kind: 'screen', path: '/app/devices' })
    expect(resolveLink('app:/app/devices', 'site')).toEqual({ kind: 'text' })
    expect(resolveLink('site:/pricing', 'site')).toEqual({ kind: 'site', path: '/pricing' })
    expect(resolveLink('site:/pricing', 'app')).toEqual({ kind: 'text' })
    expect(resolveLink('/pricing', 'site')).toEqual({ kind: 'text' })
    expect(resolveLink('https://example.com', 'app')).toEqual({ kind: 'external', href: 'https://example.com' })
  })
})

describe('white-label safety', () => {
  /**
   * The rule this whole package is shaped around: an article rendered INSIDE the dashboard may be
   * read by a reseller's customer, on the reseller's domain, under the reseller's brand. Naming the
   * platform there is the same leak class as showing our logo — so it is a test, not a convention.
   */
  const BRAND = /orbetra/i

  it('no app-visible article names the platform', () => {
    for (const a of KB_ARTICLES.filter((x) => x.surfaces.app)) {
      for (const lang of KB_LANGS) {
        const doc = a.doc[lang]
        const hay = `${doc.title} ${doc.summary} ${doc.keywords.join(' ')} ${bodyText(doc)}`
        expect(BRAND.test(hay), `${a.slug}/${lang} names the platform`).toBe(false)
      }
    }
  })

  it('no category label names the platform either — the shelves are rendered in-app too', () => {
    for (const c of KB_CATEGORIES) {
      for (const lang of KB_LANGS) {
        expect(BRAND.test(`${c.label[lang].title} ${c.label[lang].blurb}`), `${c.id}/${lang}`).toBe(false)
      }
    }
  })

  it('no app-visible article links to an absolute URL of ours', () => {
    for (const a of KB_ARTICLES.filter((x) => x.surfaces.app)) {
      for (const lang of KB_LANGS) {
        for (const href of linksOf(a, lang)) {
          expect(BRAND.test(href), `${a.slug}/${lang} -> ${href}`).toBe(false)
        }
      }
    }
  })

  it('the product token is used rather than a hardcoded name', () => {
    // Most articles simply never name the product, which is the safest form of all. The ones that
    // do must go through the token — a hardcoded name is caught by the brand test above, so this
    // only guards against the token itself falling out of use and the substitution rotting unused.
    const uses = KB_ARTICLES.filter((a) => bodyText(a.doc.en).includes(KB_PRODUCT_TOKEN))
    expect(uses.length).toBeGreaterThanOrEqual(5)
    expect(withProduct('a {product} b', 'Fleetly')).toBe('a Fleetly b')
  })

  it('an article using the token uses it in every language', () => {
    for (const a of KB_ARTICLES) {
      const uses = (lang: KbLang) => bodyText(a.doc[lang]).includes(KB_PRODUCT_TOKEN)
      for (const lang of KB_LANGS) expect(uses(lang), `${a.slug}/${lang}`).toBe(uses('en'))
    }
  })
})

describe('audience gating', () => {
  it('the public site shows every site article and nothing else', () => {
    const shown = visibleArticles(KB_ARTICLES, { surface: 'site' })
    expect(shown).toEqual(KB_ARTICLES.filter((a) => a.surfaces.site))
  })

  it('withholds platform-business articles on a white-label host', () => {
    const viewer = { surface: 'app' as const, whiteLabel: true, isAdmin: true, entitlements: { whiteLabel: true, customDomains: true, subAccounts: true, apiAccess: true, webhooks: true, smsGateway: true } }
    const shown = visibleArticles(KB_ARTICLES, viewer)
    expect(shown.some((a) => a.audience?.platformOnly === true)).toBe(false)
    // …and shows them on our own host
    expect(visibleArticles(KB_ARTICLES, { ...viewer, whiteLabel: false }).some((a) => a.audience?.platformOnly === true)).toBe(true)
  })

  it('withholds admin-only and entitlement-gated articles from an ordinary operator', () => {
    const shown = visibleArticles(KB_ARTICLES, { surface: 'app', isAdmin: false })
    expect(shown.some((a) => a.audience?.adminOnly === true)).toBe(false)
    expect(shown.some((a) => a.audience?.entitlement !== undefined)).toBe(false)
    // the basics are still there — an operator without admin rights is not left with nothing
    expect(shown.length).toBeGreaterThan(20)
    expect(shown.some((a) => a.slug === KB.howTrackingWorks)).toBe(true)
  })

  it('every entitlement named by an article is a real one', () => {
    const known = new Set(['whiteLabel', 'customDomains', 'subAccounts', 'apiAccess', 'webhooks', 'smsGateway'])
    for (const a of KB_ARTICLES) {
      if (a.audience?.entitlement !== undefined) expect(known.has(a.audience.entitlement), a.slug).toBe(true)
    }
  })

  it('an article about a reseller screen is gated on the entitlement that screen needs', () => {
    expect(articleBySlug(KB_ARTICLES, KB.branding)?.audience?.entitlement).toBe('whiteLabel')
    expect(articleBySlug(KB_ARTICLES, KB.customerAccounts)?.audience?.entitlement).toBe('subAccounts')
    expect(articleBySlug(KB_ARTICLES, KB.apiQuickstart)?.audience?.entitlement).toBe('apiAccess')
    expect(articleBySlug(KB_ARTICLES, KB.webhooks)?.audience?.entitlement).toBe('webhooks')
  })

  it('isVisible is permissive on the site regardless of plan', () => {
    const gated = KB_ARTICLES.find((a) => a.audience?.entitlement !== undefined && a.surfaces.site)!
    expect(isVisible(gated, { surface: 'site' })).toBe(true)
  })
})

describe('search', () => {
  it('finds an article by its title in every language', () => {
    for (const lang of KB_LANGS) {
      const target = articleBySlug(KB_ARTICLES, KB.geofences)!
      const hits = searchArticles(KB_ARTICLES, lang, target.doc[lang].title)
      expect(hits[0]?.slug, lang).toBe(KB.geofences)
    }
  })

  it('finds an article by a keyword that does not appear in its prose', () => {
    const hits = searchArticles(KB_ARTICLES, 'en', 'apn')
    expect(hits.map((a) => a.slug)).toContain(KB.simAndApn)
  })

  it('ignores diacritics, in both directions', () => {
    const withMarks = searchArticles(KB_ARTICLES, 'lt', 'kelionė')
    const without = searchArticles(KB_ARTICLES, 'lt', 'kelione')
    expect(without.map((a) => a.slug)).toEqual(withMarks.map((a) => a.slug))
    expect(without.length).toBeGreaterThan(0)
  })

  it('returns nothing for an empty query rather than everything', () => {
    expect(searchArticles(KB_ARTICLES, 'en', '   ')).toEqual([])
  })
})

describe('metadata mirror', () => {
  /**
   * `KB_META` is what a contextual help link in the dashboard consults, and it lives in the root
   * entry point so linking to an article costs no article bodies. It is generated from the articles
   * — and a generated file that nobody checks is a file that goes stale. This is the check.
   */
  it('mirrors the articles exactly, in the same order', () => {
    expect(KB_META.map((m) => m.slug)).toEqual(KB_ARTICLES.map((a) => a.slug))
    for (const a of KB_ARTICLES) {
      const m = metaBySlug(a.slug)
      expect(m, a.slug).toBeDefined()
      expect(m!.category, a.slug).toBe(a.category)
      expect(m!.surfaces, a.slug).toEqual(a.surfaces)
      expect(m!.audience, a.slug).toEqual(a.audience)
      expect(m!.screen, a.slug).toBe(a.screen)
      for (const lang of KB_LANGS) expect(m!.title[lang], `${a.slug}/${lang}`).toBe(a.doc[lang].title)
    }
  })

  it('gates identically to the full article — a link is shown exactly when the page is reachable', () => {
    const viewers = [
      { surface: 'app' as const, whiteLabel: true, isAdmin: true, entitlements: { whiteLabel: true, customDomains: true, subAccounts: true, apiAccess: true, webhooks: true, smsGateway: true } },
      { surface: 'app' as const, whiteLabel: false, isAdmin: false },
      { surface: 'app' as const, whiteLabel: false, isAdmin: true, entitlements: { apiAccess: true } },
      { surface: 'site' as const },
    ]
    for (const v of viewers) {
      for (const a of KB_ARTICLES) expect(isVisible(metaBySlug(a.slug)!, v), `${a.slug}/${JSON.stringify(v)}`).toBe(isVisible(a, v))
    }
  })

  it('resolves the articles that explain a screen', () => {
    expect(metaForScreen('/app/geofences').map((m) => m.slug)).toContain(KB.geofences)
    expect(metaForScreen('/app/nowhere')).toEqual([])
  })

  it('every screen an article claims to explain is an app route we actually have', () => {
    // A `screen` that does not exist is a "related help" panel that never appears — silent, and
    // exactly the kind of rot a rename leaves behind.
    const ROUTES = new Set([
      '/app', '/app/dashboard', '/app/devices', '/app/accounts', '/app/drivers', '/app/maintenance',
      '/app/trips', '/app/routing', '/app/playback', '/app/geofences', '/app/rules', '/app/events',
      '/app/reports', '/app/api-keys', '/app/webhooks', '/app/branding', '/app/audit', '/app/settings',
    ])
    for (const m of KB_META) {
      if (m.screen !== undefined) expect(ROUTES.has(m.screen), `${m.slug} -> ${m.screen}`).toBe(true)
    }
  })
})
