export type {
  KbArticle,
  KbAudience,
  KbBlock,
  KbCalloutTone,
  KbCategory,
  KbCategoryId,
  KbDoc,
  KbLang,
  KbSurfaces,
} from './types.js'
export type { KbArticleMeta } from './types.js'
export { KB_CATEGORY_IDS, KB_LANGS } from './types.js'
export { KB_CATEGORIES } from './categories.js'
export { KB_META } from './meta.js'

import { KB_CATEGORY_IDS, type KbArticle, type KbArticleMeta, type KbAudience, type KbDoc, type KbLang } from './types.js'
import { KB_META } from './meta.js'

/**
 * Every article's slug, as a typed constant.
 *
 * Contextual help links across the product are written as `KB.geofences`, never as a bare string:
 * a typo in a string is a link that renders and 404s, and a typo here does not compile. This lives
 * in the ROOT entry point, so a page that links to an article does not import the article.
 */
export const KB = {
  howTrackingWorks: 'how-tracking-works',
  firstSteps: 'first-steps',
  loginsAndRoles: 'logins-and-roles',
  glossary: 'glossary',
  chooseATracker: 'choose-a-tracker',
  imei: 'imei',
  simAndApn: 'sim-and-apn',
  connectATracker: 'connect-a-tracker',
  configSms: 'config-sms',
  reportingIntervals: 'reporting-intervals',
  commands: 'commands',
  canAndObd: 'can-and-obd',
  deviceLifecycle: 'device-lifecycle',
  mapBasics: 'map-basics',
  positionAccuracy: 'position-accuracy',
  deviceStatus: 'device-status',
  shareALiveLink: 'share-a-live-link',
  howTripsAreDetected: 'how-trips-are-detected',
  distanceAndOdometer: 'distance-and-odometer',
  playback: 'playback',
  geofences: 'geofences',
  rulesAndAlerts: 'rules-and-alerts',
  eventTypes: 'event-types',
  notificationChannels: 'notification-channels',
  reportTypes: 'report-types',
  scheduledReports: 'scheduled-reports',
  timeZonesAndUnits: 'time-zones-and-units',
  drivers: 'drivers',
  vehicleCard: 'vehicle-card',
  maintenance: 'maintenance',
  plansAndLimits: 'plans-and-limits',
  billingAndInvoices: 'billing-and-invoices',
  unpaidWhatHappens: 'unpaid-what-happens',
  whiteLabelExplained: 'white-label-explained',
  customerAccounts: 'customer-accounts',
  branding: 'branding',
  customDomain: 'custom-domain',
  emailsToYourCustomers: 'emails-to-your-customers',
  apiQuickstart: 'api-quickstart',
  webhooks: 'webhooks',
  whereYourDataLives: 'where-your-data-lives',
  trackingEmployeesLawfully: 'tracking-employees-lawfully',
  exportAndEraseData: 'export-and-erase-data',
  deviceNotReporting: 'device-not-reporting',
  mapWontLoad: 'map-wont-load',
  notGettingEmails: 'not-getting-emails',
} as const

export type KbSlug = (typeof KB)[keyof typeof KB]

/** The surface an article is being rendered on. */
export type KbSurface = 'site' | 'app'

/** What the caller knows about the reader, for `visibleArticles`. */
export interface KbViewer {
  surface: KbSurface
  /** true on a reseller's own host — platform-business articles are withheld there */
  whiteLabel?: boolean
  /** true for tenant admins; `adminOnly` articles are withheld from everyone else */
  isAdmin?: boolean
  /** the tenant's live entitlements; an article gated on one the tenant lacks is withheld */
  entitlements?: Partial<Record<NonNullable<KbAudience['entitlement']>, boolean>>
}

/**
 * May this reader see this article?
 *
 * The default for every unknown is PERMISSIVE on the public site and RESTRICTIVE in the app: a
 * visitor to the marketing site is allowed to read about features they have not bought, because
 * that is what a marketing site is for, while an operator inside a dashboard should not be sent to
 * an article about a screen their plan does not include.
 */
export function isVisible(article: KbArticle | KbArticleMeta, viewer: KbViewer): boolean {
  if (!article.surfaces[viewer.surface]) return false
  if (viewer.surface === 'site') return true
  const a = article.audience
  if (a === undefined) return true
  // A reseller's customer must never be sent to an article about OUR plans, invoices or programme —
  // it names a commercial relationship they are not in and a company they have not heard of.
  if (a.platformOnly === true && viewer.whiteLabel === true) return false
  if (a.adminOnly === true && viewer.isAdmin !== true) return false
  if (a.entitlement !== undefined && viewer.entitlements?.[a.entitlement] !== true) return false
  return true
}

/** Every article this reader may see, in reading order. */
export function visibleArticles(articles: readonly KbArticle[], viewer: KbViewer): KbArticle[] {
  return articles.filter((a) => isVisible(a, viewer))
}

/** One article by slug, or undefined. */
export function articleBySlug(articles: readonly KbArticle[], slug: string): KbArticle | undefined {
  return articles.find((a) => a.slug === slug)
}

/** Articles grouped by category, in category order, skipping categories with nothing to show. */
export function articlesByCategory(articles: readonly KbArticle[]): { category: (typeof KB_CATEGORY_IDS)[number]; articles: KbArticle[] }[] {
  return KB_CATEGORY_IDS.map((category) => ({ category, articles: articles.filter((a) => a.category === category) })).filter(
    (g) => g.articles.length > 0,
  )
}

/** The articles that explain a given product screen — the "related help" on that page. */
export function articlesForScreen(articles: readonly KbArticle[], screen: string): KbArticle[] {
  return articles.filter((a) => a.screen === screen)
}

/**
 * Search, deliberately without an index or a dependency.
 *
 * Fifty articles is a list you can scan on every keystroke, so the whole thing is a scored
 * substring match: title hits rank above summary hits, which rank above keywords, which rank above
 * the body. Diacritics are folded, so a Lithuanian reader typing `kelione` finds "kelionė" and a
 * German reader typing `ubersicht` finds "Übersicht" — nobody should have to spell a search term
 * correctly to find the page that would have taught them the word.
 */
export function searchArticles(articles: readonly KbArticle[], lang: KbLang, query: string): KbArticle[] {
  const q = fold(query)
  if (q === '') return []
  const scored: { a: KbArticle; score: number }[] = []
  for (const a of articles) {
    const doc = a.doc[lang]
    let score = 0
    if (fold(doc.title).includes(q)) score += 100
    if (fold(doc.summary).includes(q)) score += 40
    if (doc.keywords.some((k) => fold(k).includes(q))) score += 25
    if (fold(a.slug).includes(q)) score += 20
    if (fold(bodyText(doc)).includes(q)) score += 5
    if (score > 0) scored.push({ a, score })
  }
  return scored.sort((x, y) => y.score - x.score).map((s) => s.a)
}

/** Lower-case and strip diacritics, so search does not require correct spelling of a loan word. */
function fold(s: string): string {
  return s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
}

/** All translatable prose of one document, flattened — the low-priority search haystack. */
export function bodyText(doc: KbDoc): string {
  const out: string[] = []
  for (const b of doc.blocks) {
    if (b.h2 !== undefined) out.push(b.h2)
    if (b.p !== undefined) out.push(b.p)
    if (b.ul !== undefined) out.push(...b.ul)
    if (b.ol !== undefined) out.push(...b.ol)
    if (b.table !== undefined) {
      out.push(...b.table.head)
      for (const row of b.table.rows) out.push(...row)
    }
  }
  return out.join(' ')
}

// ── the inline markup contract ───────────────────────────────────────────────
/**
 * Article prose carries a deliberately tiny markup subset, identical on both surfaces:
 * `**bold**`, `` `code` ``, and `[text](href)`. No HTML ever comes out of a content string, so no
 * renderer needs `dangerouslySetInnerHTML` and no translator can accidentally inject markup.
 *
 * Link hrefs use three schemes rather than raw URLs, because the same sentence is read in two
 * places that resolve destinations differently:
 *
 *   `kb:<slug>`   another article — `/learn/<slug>` on the site, `/app/learn/<slug>` in the app.
 *   `app:<path>`  a product screen — a real link inside the app, plain text on the public site
 *                 (a visitor with no dashboard should not be handed a link into one).
 *   `site:<path>` a public page — a real link on the site, plain text in the app. This is what
 *                 keeps our pricing page, our signup and our marketing out of a reseller's
 *                 dashboard: there is no href to leak because the app never renders one.
 *
 * Plain `https://` links are still allowed for genuinely external references. `assertNoBrandLeak`
 * in the package's own test suite refuses any that name the platform inside an app-visible article.
 */
export type KbLinkTarget =
  | { kind: 'article'; slug: string }
  | { kind: 'screen'; path: string }
  | { kind: 'site'; path: string }
  | { kind: 'external'; href: string }
  | { kind: 'text' }

/** Resolve one link href for a surface. `text` means: render the label, but not as a link. */
export function resolveLink(href: string, surface: KbSurface): KbLinkTarget {
  if (href.startsWith('kb:')) return { kind: 'article', slug: href.slice(3) }
  if (href.startsWith('app:')) return surface === 'app' ? { kind: 'screen', path: href.slice(4) } : { kind: 'text' }
  if (href.startsWith('site:')) return surface === 'site' ? { kind: 'site', path: href.slice(5) } : { kind: 'text' }
  if (/^https?:\/\//.test(href)) return { kind: 'external', href }
  // anything else is authored wrongly; render the label rather than an anchor to nowhere
  return { kind: 'text' }
}

/**
 * The token every article uses instead of a product name.
 *
 * The prose says `{product}` and each surface substitutes: the public site puts its own name in,
 * and the dashboard puts in whatever the tenant configured — or, on a white-label host with no
 * name set, a neutral noun. The alternative was two copies of every article, one branded and one
 * not, which would have drifted apart within a month.
 */
export const KB_PRODUCT_TOKEN = '{product}'

/** Substitute the product name into one string. */
export function withProduct(text: string, productName: string): string {
  return text.split(KB_PRODUCT_TOKEN).join(productName)
}

/** One article's metadata by slug — what a contextual help link resolves, without the prose. */
export function metaBySlug(slug: string): KbArticleMeta | undefined {
  return KB_META.find((m) => m.slug === slug)
}

/** The articles that explain a given product screen, from metadata alone. */
export function metaForScreen(screen: string): KbArticleMeta[] {
  return KB_META.filter((m) => m.screen === screen)
}
