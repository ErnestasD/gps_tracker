import { getJson, mutate } from './client'
import { API_BASE } from './http'

/** A temporary public share link (V1-nice). Mirrors packages/shared ShareLinkView. */
export interface ShareLinkView {
  id: string
  deviceId: string
  prefix: string
  label: string | null
  expiresAt: string
  revokedAt: string | null
  createdAt: string
}
export interface CreatedShare {
  token: string
  path: string // "/s/<token>"
  view: ShareLinkView
}
/** The public (no-auth) share payload — mirrors packages/shared PublicShareView. */
export interface PublicShare {
  label: string | null
  expiresAt: string
  position: { lat: number; lon: number; fixTime: string; speedKph: number | null; course: number | null } | null
}

/** TTL presets shown in the create form (hours). Capped at 30 days server-side. */
export const TTL_OPTIONS: readonly { hours: number; key: string }[] = [
  { hours: 1, key: '1h' },
  { hours: 8, key: '8h' },
  { hours: 24, key: '24h' },
  { hours: 168, key: '7d' },
]

export const createShare = (deviceId: string, ttlHours: number, label?: string) =>
  mutate<CreatedShare>('POST', `/v1/devices/${encodeURIComponent(deviceId)}/shares`, { ttlHours, ...(label ? { label } : {}) })
export const listShares = (deviceId: string) => getJson<ShareLinkView[]>(`/v1/devices/${encodeURIComponent(deviceId)}/shares`)
export const revokeShare = (id: string) => mutate<{ ok: true }>('DELETE', `/v1/shares/${encodeURIComponent(id)}`)

/** Public resolve — NO auth (the token is the capability). 404 ⇒ expired/revoked/unknown. */
export async function fetchPublicShare(token: string): Promise<PublicShare | null> {
  const res = await fetch(`${API_BASE}/v1/public/share/${encodeURIComponent(token)}`)
  if (res.status === 404 || res.status === 410) return null
  if (!res.ok) throw new Error(`share ${res.status}`)
  return (await res.json()) as PublicShare
}

// ── pure helpers (unit-tested) ─────────────────────────────────────────────────────────────
/** The full shareable URL — the share page is served by this same web origin. `origin` is
 *  injectable so the helper is testable without a DOM. */
export function shareUrl(token: string, origin: string): string {
  return `${origin.replace(/\/$/, '')}/s/${token}`
}

/** Human "expires in …" / "expired" label. Bucketed to minutes/hours/days; nowMs injectable. */
export function expiryLabel(expiresAt: string, nowMs: number): { expired: boolean; unit: 'min' | 'hour' | 'day'; value: number } {
  const deltaMs = Date.parse(expiresAt) - nowMs
  if (!Number.isFinite(deltaMs) || deltaMs <= 0) return { expired: true, unit: 'min', value: 0 }
  const mins = Math.floor(deltaMs / 60_000)
  if (mins < 60) return { expired: false, unit: 'min', value: Math.max(1, mins) }
  const hours = Math.floor(mins / 60)
  if (hours < 24) return { expired: false, unit: 'hour', value: hours }
  return { expired: false, unit: 'day', value: Math.floor(hours / 24) }
}
