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
  logoUrl?: string
  primary?: string
  accent?: string
  productName?: string
  supportEmail?: string
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
  type: 'TXT' | 'CNAME'
  /** fully-qualified owner name — see branding.dnsRelative for why it is not shown relative */
  name: string
  value: string
  /** which of the two jobs this record does, for the row's one-line explanation */
  purposeKey: 'branding.dnsPurposeTxt' | 'branding.dnsPurposeCname'
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
export function dnsRecordsFor(domain: string, txtToken: string, dnsTarget: string | null): DnsRecord[] {
  const out: DnsRecord[] = [
    { type: 'TXT', name: verifyHost(domain), value: txtToken, purposeKey: 'branding.dnsPurposeTxt' },
  ]
  if (dnsTarget !== null && dnsTarget !== '') {
    out.push({ type: 'CNAME', name: domain, value: dnsTarget, purposeKey: 'branding.dnsPurposeCname' })
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
 * Apply a resolved brand to the document.
 *
 * `whiteLabel` decides what happens to the parts a tenant left blank, and getting that wrong is how
 * OUR mark ends up on THEIR page permanently rather than for a moment. On a tenant host an unset
 * logo means NO icon — the browser's blank default — because our purple mark beside their product
 * name is worse than no mark at all. On our own host the platform defaults are correct.
 */
export function applyBranding(branding: Branding, whiteLabel: boolean): void {
  appliedBranding = branding
  appliedWhiteLabel = whiteLabel
  if (!themeSubscribed) {
    themeSubscribed = true
    onThemeChange(() => {
      if (appliedBranding) applyBranding(appliedBranding, appliedWhiteLabel)
    })
  }
  const theme = getTheme()
  const root = document.documentElement
  if (branding.primary !== undefined && HEX.test(branding.primary)) {
    root.style.setProperty('--accent', clampForTheme(branding.primary, theme))
  }
  if (branding.accent !== undefined && HEX.test(branding.accent)) {
    root.style.setProperty('--accent-2', clampForTheme(branding.accent, theme))
  }
  // ALWAYS set the title. Guarding on productName left `index.html`'s value in the tab, which used
  // to be "Orbetra" — so a tenant who set colours but no name kept ours for good. index.html now
  // ships no title at all, so an unnamed tenant shows the browser's URL, which is their own domain.
  // ALWAYS assign — declining to set it is not the same as clearing it. `else if (!whiteLabel)` left
  // whatever was there, so one call with whiteLabel=false (AppShell's effect at mount, before the
  // host is known) wrote "Orbetra" into a tenant's tab and nothing ever took it out again.
  document.title = branding.productName ?? (whiteLabel ? '' : PLATFORM_NAME)
  // white-label favicon: a tenant's logo IS their favicon — no separate input, reuse logoUrl
  // (brandingSchema pins it to an https URL).
  applyFavicon(branding.logoUrl, whiteLabel)
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
 * A white-label host with no logo gets NONE, which renders as the browser's blank page icon. That is
 * the whole point: the previous fallback put the platform's mark in a reseller's customers' tabs and
 * left it there, because "no logo configured" is not "show someone else's logo".
 */
export function faviconLinks(logoUrl: string | undefined, whiteLabel = false): FaviconLink[] {
  if (logoUrl !== undefined && logoUrl !== '') return [{ rel: 'icon', href: logoUrl }, { rel: 'apple-touch-icon', href: logoUrl }]
  return whiteLabel ? [] : DEFAULT_ICONS
}

/** Point the browser-tab icon at `logoUrl` (tenant white-label) or restore the Orbetra defaults. */
function applyFavicon(logoUrl: string | undefined, whiteLabel = false): void {
  const head = document.head
  head.querySelectorAll('link[rel~="icon"], link[rel="apple-touch-icon"]').forEach((el) => el.remove())
  for (const l of faviconLinks(logoUrl, whiteLabel)) {
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
/** Branding plus the two pieces of DEPLOYMENT config the Domains card needs and cannot infer:
 *  where a tenant points their own domain's CNAME, and whether `<slug>.<platformDomain>` is on
 *  offer at all (it needs a wildcard DNS record to exist). Either may be null. */
export const getBranding = () =>
  getJson<{ branding: Branding; name: string; dnsTarget: string | null; platformDomain: string | null }>('/v1/tenant/branding')
export const saveBranding = (b: Branding) => mutate<{ branding: Branding; name: string }>('PATCH', '/v1/tenant/branding', b)
export const listDomains = () => getJson<TenantDomain[]>('/v1/tenant/domains')
/** `txtRecord`/`dnsTarget` are null for a PLATFORM SUBDOMAIN — it comes back already verified,
 *  with nothing for the tenant to publish and nowhere for them to point anything. */
export const addDomain = (domain: string) =>
  mutate<TenantDomain & { txtRecord: string | null; dnsTarget: string | null }>('POST', '/v1/tenant/domains', { domain })
export const removeDomain = (id: string) => mutate<{ ok: boolean }>('DELETE', `/v1/tenant/domains/${id}`)
export const verifyDomain = (id: string) => mutate<TenantDomain>('POST', `/v1/tenant/domains/${id}/verify`)
