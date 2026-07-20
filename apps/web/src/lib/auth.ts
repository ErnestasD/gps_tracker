import { authSessionSchema, type AuthUser } from '@orbetra/shared'

import { API_BASE, ApiError } from './http'

/**
 * Session state (E03-1, replaces the sessionStorage stub): the access JWT lives
 * ONLY in module memory — XSS cannot read what is never stored. Persistence
 * across reloads comes from the httpOnly `orb_refresh` cookie (Path=/v1/auth):
 * the router guard calls refreshSession() before bouncing to /login.
 */
let accessToken: string | null = null
let currentUser: AuthUser | null = null

export function getAccessToken(): string | null {
  return accessToken
}

export function getCurrentUser(): AuthUser | null {
  return currentUser
}

export function clearSession(): void {
  accessToken = null
  currentUser = null
}

async function applySession(res: Response): Promise<AuthUser> {
  const parsed = authSessionSchema.safeParse(await res.json())
  if (!parsed.success) throw new ApiError(500)
  accessToken = parsed.data.accessToken
  currentUser = parsed.data.user
  return parsed.data.user
}

/** POST /v1/auth/login — throws ApiError(401|409|429|…) for the form to map. */
export async function login(email: string, password: string): Promise<AuthUser> {
  const res = await fetch(`${API_BASE}/v1/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, password }),
  })
  if (!res.ok) throw new ApiError(res.status)
  return applySession(res)
}

/**
 * POST /v1/auth/forgot-password (ADR-031). Deliberately returns nothing meaningful: the server
 * answers 200 whether or not the email exists (no enumeration), so the UI always shows the same
 * "check your email" confirmation. Only a 429 (rate-limited) is surfaced to the user.
 */
export async function requestPasswordReset(email: string): Promise<void> {
  const res = await fetch(`${API_BASE}/v1/auth/forgot-password`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email }),
  })
  if (!res.ok) throw new ApiError(res.status)
}

/** POST /v1/auth/reset-password (ADR-031) — redeem the emailed token + set a new password.
 *  Throws ApiError(400) for an invalid/expired token or a too-short password. */
export async function resetPassword(token: string, newPassword: string): Promise<void> {
  const res = await fetch(`${API_BASE}/v1/auth/reset-password`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ token, newPassword }),
  })
  if (!res.ok) throw new ApiError(res.status)
}

let refreshInFlight: Promise<boolean> | null = null

/**
 * POST /v1/auth/refresh (cookie-authenticated). SINGLE-FLIGHT: concurrent 401s
 * from parallel requests must not stampede — a second refresh with the same
 * cookie would look like token REUSE server-side and revoke the whole family.
 */
export function refreshSession(): Promise<boolean> {
  refreshInFlight ??= (async () => {
    try {
      const res = await fetch(`${API_BASE}/v1/auth/refresh`, { method: 'POST' })
      if (!res.ok) {
        clearSession()
        return false
      }
      await applySession(res)
      return true
    } catch {
      clearSession()
      return false
    } finally {
      refreshInFlight = null
    }
  })()
  return refreshInFlight
}

/** POST /v1/auth/logout — revokes the refresh family server-side; always clears locally. */
export async function logout(): Promise<void> {
  try {
    await fetch(`${API_BASE}/v1/auth/logout`, { method: 'POST' })
  } catch {
    // server unreachable — local clear still logs the tab out
  }
  clearSession()
}
