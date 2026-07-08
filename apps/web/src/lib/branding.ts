import { getJson, mutate } from './client'

/**
 * White-label theming (E03-5, DASHBOARD_UI_SPEC §1): branding.primary → --accent,
 * branding.accent → --accent-2, logo swap. Colors are validated #rrggbb server-side
 * (brandingSchema) so writing them into a CSS custom property can't inject style;
 * we still re-validate here before setProperty (defense in depth). WCAG AA fallback:
 * if a color fails contrast against --surface, auto-lighten 15%.
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
const SURFACE = '#111a2e' // tokens.css --surface (dark); contrast reference

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
export const SURFACE_REF = SURFACE
/** Ensure a color reads on the dark surface (WCAG AA ≈ 3:1 for large UI accents). */
export function ensureContrast(hex: string): string {
  let c = hex
  for (let i = 0; i < 4 && contrast(c, SURFACE) < 3; i++) c = lighten(c, 0.15)
  return c
}

export function applyBranding(branding: Branding): void {
  const root = document.documentElement
  if (branding.primary !== undefined && HEX.test(branding.primary)) {
    root.style.setProperty('--accent', ensureContrast(branding.primary))
  }
  if (branding.accent !== undefined && HEX.test(branding.accent)) {
    root.style.setProperty('--accent-2', ensureContrast(branding.accent))
  }
  if (branding.productName !== undefined) document.title = branding.productName
}

export function resetBranding(): void {
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
