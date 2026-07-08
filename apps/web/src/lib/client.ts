import { clearSession, getAccessToken, refreshSession } from './auth'
import { API_BASE, ApiError } from './http'

/**
 * Authenticated request core (E03-3): bearer = in-memory access JWT; on 401 refresh
 * ONCE (single-flight in refreshSession) then retry; a second 401 clears the session
 * and throws so the router bounces to /login. Shared by getJson (GET) and mutate
 * (POST/PATCH/DELETE) and by api.ts.
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
