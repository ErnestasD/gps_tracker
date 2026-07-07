import { liveEventSchema, type LiveEvent } from '@orbetra/shared'

import { clearSession, getAccessToken, refreshSession } from './auth'
import { API_BASE, ApiError } from './http'

export { ApiError } from './http'

/**
 * Authenticated fetch (E03-1): bearer = in-memory access JWT; on 401 refresh the
 * session ONCE (single-flight inside refreshSession) and retry — a second 401
 * means the refresh family is gone, so clear and let the router bounce to /login.
 */
async function apiFetch(path: string, retried = false): Promise<Response> {
  const token = getAccessToken()
  const res = await fetch(`${API_BASE}${path}`, {
    headers: token !== null ? { authorization: `Bearer ${token}` } : {},
  })
  if (res.status === 401) {
    if (!retried && (await refreshSession())) return apiFetch(path, true)
    clearSession()
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

/** Initial map/list snapshot — WS itself sends no backfill. */
export async function getLastPositions(): Promise<LiveEvent[]> {
  const res = await apiFetch('/v1/devices/last')
  const body = (await res.json()) as { devices: unknown }
  const parsed = liveEventSchema.array().safeParse(body.devices)
  return parsed.success ? parsed.data : []
}

/** POST /v1/auth/password (Settings/Profile, E03-2). Throws ApiError(401) when the
 * current password is wrong. */
export async function changePassword(currentPassword: string, newPassword: string): Promise<void> {
  const token = getAccessToken()
  const res = await fetch(`${API_BASE}/v1/auth/password`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(token !== null ? { authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify({ currentPassword, newPassword }),
  })
  if (!res.ok) throw new ApiError(res.status)
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
