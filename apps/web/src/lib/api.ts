import { liveEventSchema, type LiveEvent } from '@orbetra/shared'

import { clearToken, getToken } from './auth'

/**
 * Same-origin by default: dev uses the Vite /v1 proxy, prod serves web+api behind
 * one Caddy origin. VITE_API_URL overrides for split deployments (README env table).
 */
const API_BASE: string = (import.meta.env.VITE_API_URL as string | undefined) ?? ''

export class ApiError extends Error {
  constructor(readonly status: number) {
    super(`API ${status}`)
  }
}

async function apiFetch(path: string): Promise<Response> {
  const token = getToken()
  const res = await fetch(`${API_BASE}${path}`, {
    headers: token ? { authorization: `Bearer ${token}` } : {},
  })
  if (res.status === 401) {
    clearToken() // token revoked/wrong — router guard bounces to /login on next nav
    throw new ApiError(401)
  }
  if (!res.ok) throw new ApiError(res.status)
  return res
}

export async function getWsTicket(): Promise<string> {
  const res = await apiFetch('/v1/ws-ticket')
  const body = (await res.json()) as { ticket: string }
  return body.ticket
}

/** Initial map/list snapshot (PR-A endpoint) — WS itself sends no backfill. */
export async function getLastPositions(): Promise<LiveEvent[]> {
  const res = await apiFetch('/v1/devices/last')
  const body = (await res.json()) as { devices: unknown }
  const parsed = liveEventSchema.array().safeParse(body.devices)
  return parsed.success ? parsed.data : []
}

export function wsUrl(ticket: string): string {
  if (API_BASE !== '') {
    const u = new URL(API_BASE)
    const proto = u.protocol === 'https:' ? 'wss:' : 'ws:'
    return `${proto}//${u.host}/v1/stream?ticket=${ticket}`
  }
  const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
  return `${proto}//${window.location.host}/v1/stream?ticket=${ticket}`
}
