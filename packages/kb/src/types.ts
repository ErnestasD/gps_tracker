/**
 * The knowledge base ("Learn") content model — ADR-042.
 *
 * Long-form help is a poor fit for flat i18n keys, so an article is authored as an array of
 * blocks whose translatable text is a plain string carrying a tiny, safe inline markup subset.
 * That keeps translation a pure prose task (a translator edits strings, never JSX) while the
 * shape stays type-enforced across every language: a missing language or a missing article is a
 * typecheck error, exactly like the UI locales.
 *
 * The model is deliberately the SAME SHAPE as apps/site's legal/docs content model
 * (apps/site/src/content/legal/types.ts) so the site can render both with one renderer. It adds
 * three things that page did not need: callouts, per-article metadata, and a placeholder for the
 * product's name.
 */

/** The languages every article must exist in. Mirrors apps/site LANGUAGES and apps/web i18n. */
export const KB_LANGS = ['en', 'lt', 'pl', 'de'] as const
export type KbLang = (typeof KB_LANGS)[number]

/** Callout flavours. `note` explains, `tip` shortcuts, `warning` prevents a costly mistake. */
export type KbCalloutTone = 'note' | 'tip' | 'warning'

export interface KbBlock {
  /** section heading (rendered as <h2>) */
  h2?: string
  /**
   * Stable anchor for this heading, so a product screen can deep-link into the middle of an
   * article. Authored rather than slugified from the text: the heading is translated, and an
   * anchor that changes with the reader's language is a link that works in English and drops the
   * fragment in Lithuanian. Language-independent by construction.
   */
  id?: string
  /** paragraph — inline markup allowed */
  p?: string
  /** bulleted list — each item allows inline markup */
  ul?: string[]
  /** numbered list — each item allows inline markup */
  ol?: string[]
  /** a highlighted aside; `p` carries the text */
  callout?: KbCalloutTone
  /** simple table; cells allow inline markup */
  table?: { head: string[]; rows: string[][] }
  /** preformatted block — NEVER translated (kept byte-identical across languages) */
  code?: string
}

/** Which product surfaces an article may be shown on. */
export interface KbSurfaces {
  /**
   * The public marketing site's /learn section. Always our own brand, so an article here may
   * name the platform, quote our prices and link to our own pages.
   */
  site: boolean
  /**
   * The in-product help reader (apps/web /app/learn). This is rendered inside a dashboard that
   * may be wearing a RESELLER's brand, so an article marked `app: true` must be brand-neutral:
   * it says `{product}` (substituted at render) and never our own name, and it must not quote
   * our pricing or link to our own website. Enforced by packages/kb/__tests__/brand.spec.ts.
   */
  app: boolean
}

/**
 * Who an article is for, inside the product.
 *
 * The reader of a white-labelled dashboard is a reseller's CUSTOMER: our plans, our invoices and
 * our reseller programme are not their business and naming them is a leak of the same class as
 * showing our logo. `platformOnly` keeps those articles off a white-label host entirely.
 */
export interface KbAudience {
  /** hide unless the reader is a tenant admin (matches the routes' TENANT_ADMINS gate) */
  adminOnly?: boolean
  /**
   * The article talks about the PLATFORM's own business — our plans, our invoices, what happens
   * when one goes unpaid.
   *
   * Withheld on a white-label host from everyone except a tenant admin. The distinction matters:
   * on a reseller's domain the reader is usually that reseller's CUSTOMER, to whom our commercial
   * relationship is both confusing and none of their business — but the reseller themselves is our
   * customer, pays our invoices, and would otherwise have no help for the one subject they most
   * need it on. A reseller can only grant their customers `account_manager` and `viewer`, so
   * "tenant admin on a white-label host" is the reseller and nobody else.
   */
  platformOnly?: boolean
  /**
   * Hide unless the tenant's plan grants this entitlement. String rather than the imported
   * `EntitlementKey` so this package stays dependency-free; apps/web checks it against the live
   * entitlements object and packages/kb's own test asserts the values are real keys.
   */
  entitlement?: 'whiteLabel' | 'customDomains' | 'subAccounts' | 'apiAccess' | 'webhooks' | 'smsGateway'
}

/** One article, in ONE language. */
export interface KbDoc {
  title: string
  /** one sentence, used on cards, in search results and as the page's meta description */
  summary: string
  /** search terms a reader might type that do not appear in the prose (synonyms, old names) */
  keywords: string[]
  blocks: KbBlock[]
}

/** One article, in every language (type-enforced — no silent English fallback). */
export interface KbArticle {
  /** URL segment. Language-independent, lower-kebab, NEVER changed once published. */
  slug: string
  category: KbCategoryId
  surfaces: KbSurfaces
  audience?: KbAudience
  /** the in-product screen this article explains, if any — used for "related help" on that page */
  screen?: string
  doc: Record<KbLang, KbDoc>
}

export const KB_CATEGORY_IDS = [
  'start',
  'devices',
  'map',
  'trips',
  'alerts',
  'reports',
  'fleet',
  'account',
  'tsp',
  'integrations',
  'trust',
  'troubleshooting',
] as const
export type KbCategoryId = (typeof KB_CATEGORY_IDS)[number]

/** A category's own label — the section headings on the index and in the reader's sidebar. */
export interface KbCategory {
  id: KbCategoryId
  /** lucide-react icon name, resolved by each app (this package stays dependency-free) */
  icon: string
  label: Record<KbLang, { title: string; blurb: string }>
}

/**
 * An article WITHOUT its prose — slug, shelf, audience, screen and title in every language.
 *
 * This is what a contextual help link needs: enough to decide whether to render at all and what to
 * call the destination. It lives in the package ROOT (see meta.ts) so a dashboard page that links
 * to an article does not pull in a few hundred kilobytes of articles to do it. Generated from the
 * articles themselves and asserted equal to them by the package's own test — the two cannot drift.
 */
export interface KbArticleMeta {
  slug: string
  category: KbCategoryId
  surfaces: KbSurfaces
  audience?: KbAudience
  screen?: string
  title: Record<KbLang, string>
  /**
   * The one-line summary. Here as well as in the article because a route's `head` — the page title
   * and meta description a search engine reads — is resolved before the component loads, and
   * reading it from the article would put every article in the eager bundle.
   */
  summary: Record<KbLang, string>
}
