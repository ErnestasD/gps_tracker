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
let appliedBranding: Branding | null = null
let themeSubscribed = false

export function applyBranding(branding: Branding): void {
  appliedBranding = branding
  if (!themeSubscribed) {
    themeSubscribed = true
    onThemeChange(() => {
      if (appliedBranding) applyBranding(appliedBranding)
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
  if (branding.productName !== undefined) document.title = branding.productName
}

export function resetBranding(): void {
  appliedBranding = null
  const root = document.documentElement
  root.style.removeProperty('--accent')
  root.style.removeProperty('--accent-2')
}

// ── API ──────────────────────────────────────────────────────────────────────
export const getBranding = () => getJson<{ branding: Branding; name: string }>('/v1/tenant/branding')
export const saveBranding = (b: Branding) => mutate<{ branding: Branding; name: string }>('PATCH', '/v1/tenant/branding', b)
export const listDomains = () => getJson<TenantDomain[]>('/v1/tenant/domains')
export const addDomain = (domain: string) => mutate<TenantDomain & { txtRecord: string }>('POST', '/v1/tenant/domains', { domain })
export const removeDomain = (id: string) => mutate<{ ok: boolean }>('DELETE', `/v1/tenant/domains/${id}`)
export const verifyDomain = (id: string) => mutate<TenantDomain>('POST', `/v1/tenant/domains/${id}/verify`)
