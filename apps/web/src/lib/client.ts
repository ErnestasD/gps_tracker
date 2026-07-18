import { clearSession, getAccessToken, refreshSession } from './auth'
import { API_BASE, ApiError } from './http'

/**
 * Global "session is truly dead" handler (R4 HIGH). Registered once by main.tsx to
 * router.navigate({ to: '/login' }). Kept as an injected callback (not a direct router
 * import) so this lib layer stays UI-free and cycle-free. Fires from the ONE place every
 * REST call funnels through — so any page, not just the map's WS path, recovers on a
 * mid-session refresh-cookie death instead of freezing on a stale/empty view.
 */
let onUnauthorized: (() => void) | null = null
export function setUnauthorizedHandler(fn: (() => void) | null): void {
  onUnauthorized = fn
}

/**
 * Authenticated request core (E03-3): bearer = in-memory access JWT; on 401 refresh
 * ONCE (single-flight in refreshSession) then retry; a second 401 clears the session,
 * fires the global unauthorized handler (→ /login) and throws. Shared by getJson (GET)
 * and mutate (POST/PATCH/DELETE) and by api.ts.
 */
export async function request(method: string, path: string, body?: unknown, retried = false): Promise<Response> {
  const token = getAccessToken()
  const res = await fetch(`${API_BASE}${path}`, {
    method,
    headers: {
      ...(token !== null ? { authorization: `Bearer ${token}` } : {}),
      ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  })
  if (res.status === 401) {
    if (!retried && (await refreshSession())) return request(method, path, body, true)
    clearSession()
    onUnauthorized?.() // redirect to /login from wherever the dead session first surfaced
    throw new ApiError(401)
  }
  if (!res.ok) throw new ApiError(res.status)
  return res
}

export async function getJson<T>(path: string): Promise<T> {
  return (await (await request('GET', path)).json()) as T
}

export async function mutate<T>(method: 'POST' | 'PATCH' | 'DELETE', path: string, body?: unknown): Promise<T> {
  return (await (await request(method, path, body)).json()) as T
}
