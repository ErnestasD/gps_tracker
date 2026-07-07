/**
 * Stub-era auth (E02-4 AuthStub counterpart): the shared bearer token lives in
 * sessionStorage — survives reload, stays per-tab, and is trivially deleted by
 * E03-1, which replaces this whole file with httpOnly-refresh + in-memory JWT.
 */
const KEY = 'orbetra.stub-token'

export function getToken(): string | null {
  try {
    return sessionStorage.getItem(KEY)
  } catch {
    return null // storage disabled (private mode edge) — treated as logged out
  }
}

export function setToken(token: string): void {
  sessionStorage.setItem(KEY, token)
}

export function clearToken(): void {
  try {
    sessionStorage.removeItem(KEY)
  } catch {
    // already unavailable — nothing to clear
  }
}
