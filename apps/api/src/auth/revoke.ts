import type { AuthDb } from '@orbetra/db'

/**
 * The refresh-token surface plus the OPTIONAL `revokeAllForUser` (E03 review HIGH). A password
 * change or admin reset must revoke EVERY family of the user — not just the current cookie's —
 * so a stolen/other session cannot outlive a password reset. The proper carrier is
 * `refreshTokens.revokeAllForUser(userId, now)`; packages/db does not yet expose it (there is no
 * per-user family listing to loop over from apps/api either), so we call it WHEN present and
 * otherwise fall back to the caller's known family. Until then, an admin reset (no known family)
 * is a best-effort no-op and only self-service change revokes the current session.
 *
 * TODO(db): implement `refreshTokens.revokeAllForUser(userId, now)` in packages/db (revoke all
 * non-revoked rows for the user) and drop the optionality here.
 */
export type RevocableRefreshTokens = AuthDb['refreshTokens'] & {
  revokeAllForUser?(userId: string, now: Date): Promise<void>
}

/**
 * Revoke ALL of a user's refresh families (every session). Falls back to `fallbackFamilyId`
 * (the current cookie's family) when the repo cannot yet revoke by user.
 */
export async function revokeAllUserSessions(
  refreshTokens: RevocableRefreshTokens,
  userId: string,
  fallbackFamilyId?: string,
): Promise<void> {
  const now = new Date()
  if (refreshTokens.revokeAllForUser !== undefined) {
    await refreshTokens.revokeAllForUser(userId, now)
    return
  }
  if (fallbackFamilyId !== undefined) await refreshTokens.revokeFamily(fallbackFamilyId, now)
}
