import { parseAssetPath } from '@orbetra/shared'

import { getJson, mutate } from './client'
import { getTheme, onThemeChange, type Theme } from './prefs'

/**
 * White-label theming (E03-5, DASHBOARD_UI_SPEC §1): branding.primary → --accent,
 * branding.accent → --accent-2, logo swap. Colors are validated #rrggbb server-side
 * (brandingSchema) so writing them into a CSS custom property can't inject style;
 * we still re-validate here before setProperty (defense in depth). WCAG AA fallback:
 * if a color fails contrast against the ACTIVE theme's surface, auto-lighten (dark
 * theme) or auto-darken (light theme) in 15% steps. Theme switches re-clamp live
 * via onThemeChange (prefs.ts).
 */
export interface Branding {
  /** an https URL the tenant hosts, or `/v1/public/brand/<hash>.<ext>` for one they uploaded */
  logoUrl?: string
  /** the browser-tab icon (W10). Unset falls back to logoUrl — see faviconLinks. */
  faviconUrl?: string
  primary?: string
  accent?: string
  productName?: string
  supportEmail?: string
}

/** One uploaded image, as GET /v1/tenant/branding reports it. Mirrors BrandAssetMeta in packages/db. */
export interface BrandAsset {
  slot: 'logo' | 'favicon'
  mime: string
  sha256: string
  width: number | null
  height: number | null
  sizeBytes: number
  path: string
  updatedAt: string
}

export interface TenantDomain {
  id: string
  domain: string
  verified: boolean
  txtToken: string
  createdAt: string
}

/** Per-tenant custom-domain cap (server MAX_DOMAINS_PER_TENANT). Client guard mirrors it so the
 * cap surfaces as a clear message instead of the server's ambiguous 409 (shared with a duplicate). */
export const MAX_DOMAINS_PER_TENANT = 25

// DNS TXT ownership record, mirrors apps/api tenantSelf.ts expectedTxt(): `orbetra-verify=<token>`.
const TXT_PREFIX = 'orbetra-verify='
/** LEGACY form: a TXT on the domain itself. The server still accepts it; we no longer teach it. */
export function expectedTxt(txtToken: string): string {
  return `${TXT_PREFIX}${txtToken}`
}

/** Mirrors apps/api tenantSelf.ts TXT_HOST_LABEL. */
export const TXT_HOST_LABEL = '_orbetra-verify'

/** The hostname the ownership TXT belongs on. */
export function verifyHost(domain: string): string {
  return `${TXT_HOST_LABEL}.${domain}`
}

export type DnsRecord = {
  type: 'TXT' | 'CNAME' | 'A'
  /**
   * The owner name, fully qualified and WITH the trailing dot.
   *
   * The dot is what makes it absolute. A panel that follows zone-file rules — and the Lithuanian
   * registrar the founder uses is one — treats a name without it as relative and appends the zone,
   * so a pasted `fleet.dokigo.lt` is filed at `fleet.dokigo.lt.dokigo.lt`. The record list then
   * looks perfectly right while the name the customer types into a browser answers nothing.
   *
   * This panel used to say "never add a trailing dot", which is what produced exactly that. The
   * evidence was in the founder's own zone: the TXT they entered WITH a dot resolved, the CNAME
   * they entered without one did not.
   */
  name: string
  value: string
  /** the explanation behind this row's ⓘ — never printed inline; see the panel */
  hintKey: 'branding.dnsHintTxt' | 'branding.dnsHintCname' | 'branding.dnsHintA'
  /** anchor in the public docs this row's ↗ opens */
  docAnchor: 'dns-what' | 'dns-cname-a'
}

/**
 * The records a pending domain needs, as a TABLE rather than a sentence.
 *
 * The page used to print "Add this TXT record to dokigo.lt" above the bare string
 * `orbetra-verify=2a129…`, which reads as a record NAMED `orbetra-verify` with that value — the
 * founder read it exactly that way, and following that reading never verifies, with nothing to say
 * why. Type / Name / Value, each copyable, is the shape every DNS panel asks for and every other
 * product hands over.
 *
 * Derived from `listDomains`' `txtToken` so the records survive a reload, not only the transient
 * add-response. `dnsTarget` comes from GET /v1/tenant/branding; without it the CNAME row is
 * omitted rather than invented.
 */
/**
 * Does this address have a word in front of the domain?
 *
 * `fleet.dokigo.lt` does; `dokigo.lt` does not, and a bare domain cannot take a CNAME — the name
 * already carries the records that make it a domain at all, and a CNAME may not sit beside them.
 *
 * Counting dots gets `example.co.uk` wrong (it is bare, and this calls it prefixed). That costs a
 * misplaced "use this one" hint on one row of a table that shows both records with both values, on
 * a page whose live status check then says which one actually took. Getting it exactly right needs
 * the public-suffix list — a downloadable, expiring dataset — which is a great deal of machinery
 * for a hint.
 */
export function hasPrefix(domain: string): boolean {
  return domain.split('.').length > 2
}

/** A hostname in its absolute form — the trailing dot is the part that carries the meaning. */
export function fqdn(host: string): string {
  return host.endsWith('.') ? host : `${host}.`
}

/** The same name relative to `zone`, for a panel that wants only the part before the domain. */
export function relativeName(host: string, zone: string): string {
  const h = host.replace(/\.$/, '')
  const z = zone.replace(/\.$/, '')
  if (h === z) return '@'
  return h.endsWith(`.${z}`) ? h.slice(0, -(z.length + 1)) : h
}

/**
 * Which record actually routes THIS address to us.
 *
 * An address with a word in front takes a CNAME; a bare domain cannot hold one and needs the
 * address. The panel shows ONE of them. It used to show both, tagged "use this one" and "not
 * needed here" — the founder's verdict was that it looked cheap, and he was right: a setup panel
 * that lists a record you must not create is asking the reader to do the product's thinking.
 */
export function routingKind(domain: string, override?: 'cname' | 'a'): 'cname' | 'a' {
  return override ?? (hasPrefix(domain) ? 'cname' : 'a')
}

export function dnsRecordsFor(
  domain: string,
  txtToken: string,
  dnsTarget: string | null,
  dnsAddresses: string[] = [],
  /** forced by live DNS when the guess is wrong — see the panel's use of the `occupied` reason */
  override?: 'cname' | 'a',
): DnsRecord[] {
  const out: DnsRecord[] = [
    { type: 'TXT', name: fqdn(verifyHost(domain)), value: txtToken, hintKey: 'branding.dnsHintTxt', docAnchor: 'dns-what' },
  ]
  /**
   * Exactly one routing record. If the preferred kind has nothing behind it in this deployment —
   * no edge host, or an edge host that does not resolve — the other is used rather than leaving
   * the reader with a verification record and no way to be reached.
   */
  const wantCname = routingKind(domain, override) === 'cname'
  const canCname = dnsTarget !== null && dnsTarget !== ''
  if (wantCname && canCname) {
    out.push({
      type: 'CNAME',
      name: fqdn(domain),
      // the TARGET needs the dot for the same reason the name does: a bare `dash.orbetra.com` in a
      // zone-file panel becomes `dash.orbetra.com.dokigo.lt`
      value: fqdn(dnsTarget),
      hintKey: 'branding.dnsHintCname',
      docAnchor: 'dns-cname-a',
    })
  } else if (dnsAddresses.length > 0) {
    for (const address of dnsAddresses) {
      // an ADDRESS is not a name — a dot here would be nonsense
      out.push({ type: 'A', name: fqdn(domain), value: address, hintKey: 'branding.dnsHintA', docAnchor: 'dns-cname-a' })
    }
  } else if (canCname) {
    out.push({ type: 'CNAME', name: fqdn(domain), value: fqdn(dnsTarget), hintKey: 'branding.dnsHintCname', docAnchor: 'dns-cname-a' })
  }

  return out
}

const HEX = /^#[0-9a-fA-F]{6}$/
// tokens.css --surface per theme (ADR-028 palette) — contrast references for the clamp guard.
const SURFACE = '#10151f' // dark
const SURFACE_LIGHT = '#ffffff'

function toRgb(hex: string): [number, number, number] {
  return [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)) as [number, number, number]
}
function relLuminance([r, g, b]: [number, number, number]): number {
  const lin = (c: number) => {
    const s = c / 255
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4
  }
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b)
}
export function contrast(a: string, b: string): number {
  const [la, lb] = [relLuminance(toRgb(a)), relLuminance(toRgb(b))]
  const [hi, lo] = la > lb ? [la, lb] : [lb, la]
  return (hi + 0.05) / (lo + 0.05)
}
function lighten(hex: string, amount: number): string {
  return (
    '#' +
    toRgb(hex)
      .map((c) => Math.round(Math.min(255, c + (255 - c) * amount)).toString(16).padStart(2, '0'))
      .join('')
  )
}
function darken(hex: string, amount: number): string {
  return (
    '#' +
    toRgb(hex)
      .map((c) => Math.round(Math.max(0, c * (1 - amount))).toString(16).padStart(2, '0'))
      .join('')
  )
}
export const SURFACE_REF = SURFACE
export const SURFACE_LIGHT_REF = SURFACE_LIGHT
/**
 * Clamp a color toward readability on the given theme's surface (WCAG AA ≈ 3:1
 * for large UI accents): dark surface → lighten, light surface → darken; 15%
 * steps, max 4, then give up (never overshoot past the tenant's intent).
 */
export function clampForTheme(hex: string, theme: Theme): string {
  const surface = theme === 'light' ? SURFACE_LIGHT : SURFACE
  const step = theme === 'light' ? darken : lighten
  let c = hex
  for (let i = 0; i < 4 && contrast(c, surface) < 3; i++) c = step(c, 0.15)
  return c
}
/** Ensure a color reads on the active theme's surface (defaults to dark for back-compat). */
export function ensureContrast(hex: string, theme: Theme = 'dark'): string {
  return clampForTheme(hex, theme)
}

// Last-applied branding, kept so a theme switch can re-clamp accents against the
// new surface. Subscription is lazy (first apply) — this module is imported by
// node-side unit tests where window/document don't exist.
//
// The FLAG is remembered with it. The theme re-apply called `applyBranding(appliedBranding)` with
// no flag, so a tenant's user clicking the light/dark switch put the platform's icon in their tab
// and our name in their title — permanently. A default argument made every forgotten call site do
// the same, which is why `whiteLabel` is required now and this variable exists.
let appliedBranding: Branding | null = null
let appliedWhiteLabel = false
let themeSubscribed = false

/**
 * The brand this browser last SAW on this host, replayed before the first paint.
 *
 * Both brand sources are fetches — `/v1/branding` by Host, and `/v1/…/branding` once authenticated —
 * so until one lands the page paints the CSS defaults, which are OURS. A tenant admin who saved
 * their colours and hit refresh watched the Orbetra accent and logo appear and then swap to theirs
 * (founder, 2026-09-06). On a reseller's own domain that is our brand on their screen, briefly, on
 * every single load.
 *
 * Same shape as the theme, which has always been applied from storage before render for exactly
 * this reason (main.tsx). The cache is only ever a HEAD START: whatever the fetch says still wins a
 * moment later, so a brand changed elsewhere self-corrects on the next load.
 *
 * Keyed by HOST. A reseller's domain and ours are different brands, and a shared browser must never
 * paint one tenant's colours onto another's login page.
 */
const BRAND_CACHE_KEY = 'orbetra.brand'

/**
 * WHERE a remembered brand came from, which decides where it may be replayed.
 *
 * 'host'    — `/v1/branding` answered for this Host: the brand this DOMAIN wears, logged in or not.
 * 'session' — the tenant of whoever was signed in. On a white-label domain that is the same brand;
 *             on `dash.orbetra.com` it is a customer's, and the pre-auth pages there are OURS.
 */
type BrandSource = 'host' | 'session'

interface CachedBrand {
  h: string
  w: boolean
  b: Branding
  s: BrandSource
}

function rememberBrand(branding: Branding, whiteLabel: boolean, source: BrandSource): void {
  try {
    const entry: CachedBrand = { h: window.location.host, w: whiteLabel, b: branding, s: source }
    localStorage.setItem(BRAND_CACHE_KEY, JSON.stringify(entry))
  } catch {
    /* storage disabled, or no window (node unit tests) — the fetch still applies the brand */
  }
}

/** Routes that are reachable WITHOUT a session. Whoever is standing here is not yet anybody, so the
 *  brand they see is the domain's — never the last tenant signed in on this browser. */
const PRE_AUTH = /^\/(login|forgot-password|reset-password|verify-email|s\/)/

/** Drop a session-sourced entry (logout). A host-sourced one is a property of the DOMAIN and stays:
 *  it is what the login page should wear. */
export function forgetSessionBrand(): void {
  try {
    if (readBrandCache()?.s === 'session') localStorage.removeItem(BRAND_CACHE_KEY)
  } catch {
    /* storage disabled — nothing to forget */
  }
}

/** The cached entry for THIS host, or null. Any missing, malformed or foreign-host value is null. */
function readBrandCache(): CachedBrand | null {
  try {
    const raw = localStorage.getItem(BRAND_CACHE_KEY)
    if (raw === null) return null
    const parsed: unknown = JSON.parse(raw)
    if (typeof parsed !== 'object' || parsed === null) return null
    const { h, w, b, s } = parsed as Partial<CachedBrand>
    if (h !== window.location.host || typeof w !== 'boolean' || typeof b !== 'object' || b === null) return null
    if (s !== 'host' && s !== 'session') return null // pre-source shape: it cannot say where it may be shown
    return { h, w, b, s }
  } catch {
    return null
  }
}

/**
 * Paint the cached brand for THIS host, if there is one. Call once at startup, before render.
 * Silent and total: no cache means the page renders exactly as it did before.
 */
export function primeBrandingFromCache(): void {
  const c = readBrandCache()
  if (c === null) return
  // a customer's brand must never pre-paint the shared login form on our own host
  if (c.s === 'session' && PRE_AUTH.test(window.location.pathname)) return
  applyBranding(c.b, c.w, false)
}

/**
 * The cached brand as a starting VALUE, for the parts of the shell that are React state rather than
 * CSS custom properties — the sidebar logo and product name. `primeBrandingFromCache` covers the
 * accents, the title and the favicon; without this the mark and the name still flashed ours.
 */
export function cachedBranding(): Branding | null {
  return readBrandCache()?.b ?? null
}

/**
 * Apply a resolved brand to the document.
 *
 * `whiteLabel` decides what happens to the parts a tenant left blank, and getting that wrong is how
 * OUR mark ends up on THEIR page permanently rather than for a moment. On a tenant host an unset
 * logo means NO icon — the browser's blank default — because our purple mark beside their product
 * name is worse than no mark at all. On our own host the platform defaults are correct.
 */
/**
 * While the Branding page is open, the DOCUMENT belongs to its live preview.
 *
 * Two writers race there: the operator typing a colour, and the background fetches that resolve the
 * host's and the tenant's saved brand. Before colours were CLEARED as well as set, a late fetch was
 * harmless — it simply did not touch an accent it had no value for. Now it takes one off, so a
 * `/v1/branding` response landing a moment after a keystroke wiped the preview the operator was
 * looking at (caught by the E03-5 smoke test, not by a person, which is the only reason it did not
 * ship). A user's keystroke outranks a fetch nobody asked for.
 */
let previewOwner = 0

/** Take the document for a live preview; call the returned function on unmount. */
export function beginBrandPreview(): () => void {
  const token = ++previewOwner
  return () => {
    if (previewOwner === token) previewOwner = 0
  }
}

export function applyBranding(branding: Branding, whiteLabel: boolean, remember: BrandSource | false = 'session'): void {
  // A background apply (host or session) never overrides a preview in progress. The preview itself
  // passes `false` and always wins, as does the cache replay, which runs before any page mounts.
  if (previewOwner !== 0 && remember !== false) return
  appliedBranding = branding
  appliedWhiteLabel = whiteLabel
  // `false` is the Branding page's per-keystroke live preview and the cache replay itself — a draft
  // nobody saved, and a value that came OUT of the cache, must not be written back into it.
  if (remember !== false) rememberBrand(branding, whiteLabel, remember)
  if (!themeSubscribed) {
    themeSubscribed = true
    onThemeChange(() => {
      if (appliedBranding) applyBranding(appliedBranding, appliedWhiteLabel, false)
    })
  }
  const theme = getTheme()
  const root = document.documentElement
  /**
   * SET or CLEAR — never "set if present".
   *
   * These are inline custom properties on <html>, so leaving one in place is not neutral: it keeps
   * overriding the stylesheet until the document is thrown away. Applying a brand with no colours
   * (the platform's) therefore did not restore OUR accent, it just declined to change the tenant's.
   * Signing out of a TSP account handed the shared login form that tenant's colours, and only a
   * reload — a new document — put them back (founder, 2026-09-06).
   */
  const paint = (prop: string, hex: string | undefined) => {
    if (hex !== undefined && HEX.test(hex)) root.style.setProperty(prop, clampForTheme(hex, theme))
    else root.style.removeProperty(prop)
  }
  paint('--accent', branding.primary)
  paint('--accent-2', branding.accent)
  // ALWAYS set the title. Guarding on productName left `index.html`'s value in the tab, which used
  // to be "Orbetra" — so a tenant who set colours but no name kept ours for good. index.html now
  // ships no title at all, so an unnamed tenant shows the browser's URL, which is their own domain.
  // ALWAYS assign — declining to set it is not the same as clearing it. `else if (!whiteLabel)` left
  // whatever was there, so one call with whiteLabel=false (AppShell's effect at mount, before the
  // host is known) wrote "Orbetra" into a tenant's tab and nothing ever took it out again.
  document.title = branding.productName ?? (whiteLabel ? '' : PLATFORM_NAME)
  // The tab icon prefers `faviconUrl` and falls back to the logo. It used to BE the logo, with no
  // separate input, which asked one file to be a wide wordmark in the sidebar and a legible mark at
  // 16px — so the fallback is not politeness, it is what keeps every tenant who configured a logo
  // before faviconUrl existed showing exactly the icon they already had.
  // `??` alone is wrong here: the settings form holds a CLEARED field as '', not undefined, so
  // clearing the favicon made the tab icon vanish in the live preview while the field's own preview
  // and the eventual saved result both fell back to the logo (clean() drops empty strings). Three
  // views of one setting, disagreeing.
  applyFavicon(iconFor(branding), whiteLabel)
}

/**
 * Which image is the tab icon: the favicon if they set one, else the logo. Pure and exported so the
 * settings preview, the live preview and the manifest all answer this the same way.
 *
 * Treats '' as unset, because a form field the user cleared is an empty string and every reader has
 * to agree that means "fall back", not "no icon".
 */
export function iconFor(branding: Pick<Branding, 'logoUrl' | 'faviconUrl'>): string | undefined {
  const pick = (v: string | undefined): string | undefined => (v !== undefined && v !== '' ? v : undefined)
  return pick(branding.faviconUrl) ?? pick(branding.logoUrl)
}

export interface FaviconLink {
  rel: string
  href: string
  type?: string
}
export const PLATFORM_NAME = 'Orbetra'
/**
 * OUR icons. NOT at /favicon.* any more: a browser asks for /favicon.ico on its own when a page
 * declares no icon, so leaving the file there served our mark to every tenant before a line of
 * JavaScript ran. Now nothing answers that path and these are reachable only from here.
 */
const DEFAULT_ICONS: FaviconLink[] = [
  { rel: 'icon', href: '/platform-icon.ico' },
  // theme-reactive SVG: white mark on a dark browser tab, purple (default) on a light one
  { rel: 'icon', href: '/platform-icon.svg', type: 'image/svg+xml' },
  { rel: 'apple-touch-icon', href: '/icons/pwa-192.png' },
]
/**
 * Which <link> icons to render. Pure — tested.
 *
 * A white-label host with no icon gets NONE, which renders as the browser's blank page icon. That is
 * the whole point: the previous fallback put the platform's mark in a reseller's customers' tabs and
 * left it there, because "no logo configured" is not "show someone else's logo".
 *
 * `iconUrl` is already resolved by the caller (faviconUrl, else logoUrl) — this function decides
 * what to render, not which field wins.
 */
export function faviconLinks(iconUrl: string | undefined, whiteLabel = false): FaviconLink[] {
  if (iconUrl !== undefined && iconUrl !== '') {
    // Declare the type for an SVG so a browser that prefers vector picks it knowingly. Only our own
    // uploads carry a trustworthy extension; a tenant's external URL may end in anything, so the
    // type is stated only when the path is one we serve — decided by the shared parser, not by a
    // second copy of its regex that could drift from it.
    const type = parseAssetPath(iconUrl)?.mime === 'image/svg+xml' ? { type: 'image/svg+xml' } : {}
    return [{ rel: 'icon', href: iconUrl, ...type }, { rel: 'apple-touch-icon', href: iconUrl }]
  }
  return whiteLabel ? [] : DEFAULT_ICONS
}

/** Point the browser-tab icon at `iconUrl` (tenant white-label) or restore the Orbetra defaults. */
function applyFavicon(iconUrl: string | undefined, whiteLabel = false): void {
  const head = document.head
  head.querySelectorAll('link[rel~="icon"], link[rel="apple-touch-icon"]').forEach((el) => el.remove())
  for (const l of faviconLinks(iconUrl, whiteLabel)) {
    const link = document.createElement('link')
    link.rel = l.rel
    link.href = l.href
    if (l.type !== undefined) link.type = l.type
    head.appendChild(link)
  }
}

export function resetBranding(): void {
  appliedBranding = null
  appliedWhiteLabel = false
  const root = document.documentElement
  root.style.removeProperty('--accent')
  root.style.removeProperty('--accent-2')
  applyFavicon(undefined, false)
}

// Saved-branding change notifier: the always-mounted AppShell holds branding in local state (not
// react-query), so a save on the Branding page must broadcast for the sidebar name/logo to refresh
// without a full reload. Distinct from the live per-keystroke preview (applyBranding).
const BRANDING_EVENT = 'orbetra:branding'
export function emitBrandingChange(): void {
  window.dispatchEvent(new Event(BRANDING_EVENT))
}
/** Subscribe to saved-branding changes (a Save on the Branding page). Returns the unsubscribe. */
export function onBrandingChange(cb: () => void): () => void {
  window.addEventListener(BRANDING_EVENT, cb)
  return () => window.removeEventListener(BRANDING_EVENT, cb)
}

// ── API ──────────────────────────────────────────────────────────────────────
/**
 * Branding plus the DEPLOYMENT config the Domains card needs and cannot infer: where a tenant points
 * their own domain's CNAME, what an apex points at, and whether `<slug>.<platformDomain>` is on
 * offer at all (it needs a wildcard DNS record to exist).
 *
 * The config fields are OPTIONAL, not merely nullable: the server sends them only to a tenant-wide
 * admin (audit W-9). Everyone else — the viewers and account users this route serves the theme to on
 * every page load — gets branding without our hostnames in it. Absent and null both mean "no row to
 * show", which is what `dnsRecordsFor` already handles.
 */
export const getBranding = () =>
  getJson<{
    branding: Branding
    name: string
    assets: BrandAsset[]
    dnsTarget?: string | null
    dnsAddresses?: string[]
    platformDomain?: string | null
  }>('/v1/tenant/branding')
export const saveBranding = (b: Branding) => mutate<{ branding: Branding; name: string }>('PATCH', '/v1/tenant/branding', b)

/**
 * Upload one brand image.
 *
 * The response carries the WHOLE merged branding object, and the caller must reseat both its form
 * state and its saved baseline from it. PATCH /v1/tenant/branding replaces the jsonb from whatever
 * the form holds, so a page that uploaded and then saved a stale form would erase the upload it had
 * just made — silently, since the request succeeds.
 */
export const uploadBrandAsset = (slot: 'logo' | 'favicon', mime: string, base64: string) =>
  mutate<{ branding: Branding; asset: BrandAsset }>('POST', `/v1/tenant/branding/asset/${slot}`, { mime, data: base64 })
export const removeBrandAsset = (slot: 'logo' | 'favicon') =>
  mutate<{ branding: Branding }>('DELETE', `/v1/tenant/branding/asset/${slot}`)

/** Strip the `data:<mime>;base64,` prefix a FileReader produces — the API wants the payload alone. */
export const stripDataUrl = (dataUrl: string): string => dataUrl.slice(dataUrl.indexOf(',') + 1)

/**
 * The settings form's state → the body `PATCH /v1/tenant/branding` receives. Drops empty strings so
 * a blank field doesn't fail the strict server schema.
 *
 * EVERY branding key must be listed here, which is why it lives beside the type rather than in the
 * page: PATCH replaces the whole jsonb with what this returns, so a key left out is not "unchanged",
 * it is deleted on the next save — from a form the user never touched. Tested against
 * `brandingSchema`'s own key list so a new field cannot be added without landing here.
 */
export function clean(b: Branding): Branding {
  const out: Branding = {}
  if (b.productName) out.productName = b.productName
  if (b.supportEmail) out.supportEmail = b.supportEmail
  if (b.primary) out.primary = b.primary
  if (b.accent) out.accent = b.accent
  if (b.logoUrl) out.logoUrl = b.logoUrl
  if (b.faviconUrl) out.faviconUrl = b.faviconUrl
  return out
}
export const listDomains = () => getJson<TenantDomain[]>('/v1/tenant/domains')
/** `txtRecord`/`dnsTarget` are null for a PLATFORM SUBDOMAIN — it comes back already verified,
 *  with nothing for the tenant to publish and nowhere for them to point anything. */
export const addDomain = (domain: string) =>
  mutate<TenantDomain & { txtRecord: string | null; dnsTarget: string | null }>('POST', '/v1/tenant/domains', { domain })
export const removeDomain = (id: string) => mutate<{ ok: boolean }>('DELETE', `/v1/tenant/domains/${id}`)
export const verifyDomain = (id: string) => mutate<TenantDomain>('POST', `/v1/tenant/domains/${id}/verify`)

/** What each record looks like in live DNS — see the API's checkDomainDns. */
export type DomainDns = {
  txt: { ok: boolean; found: string[]; reason: 'stale' | 'absent' | null }
  route: { ok: boolean; found: string[]; expected: string | null; reason: 'occupied' | 'elsewhere' | 'absent' | 'doubled' | null }
}

export const getDomainDns = (id: string) => getJson<DomainDns>(`/v1/tenant/domains/${id}/dns`)

/**
 * Where the ⓘ rows' ↗ links point.
 *
 * Built from the deployment's OWN platform domain rather than hardcoded: this dashboard is
 * white-labelled, and a link to a competitor-shaped brand in a reseller's admin is exactly the
 * leak the branding feature exists to prevent. No platform domain configured ⇒ no link, rather
 * than a link to somewhere that may not be ours.
 */
export function docsLink(platformDomain: string | null, anchor: string): string | null {
  const d = platformDomain?.trim()
  return d === undefined || d === '' ? null : `https://${d}/docs#${anchor}`
}
