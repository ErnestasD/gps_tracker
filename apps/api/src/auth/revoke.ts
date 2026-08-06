import type { AuthDb } from '@orbetra/db'

/**
 * The refresh-token surface plus the OPTIONAL `revokeAllForUser` (E03 review HIGH). A password
 * change or admin reset must revoke EVERY family of the user — not just the current cookie's —
 * so a stolen/other session cannot outlive a password reset. The carrier is
 * `refreshTokens.revokeAllForUser(userId, now)`, which revokes every non-revoked row AND stamps the
 * session epoch in one transaction — the epoch is what reaches a rotation that has already claimed
 * its token, which a row sweep alone cannot.
 *
 * `fallbackFamilyId` is kept for one case only: a caller that holds a cookie but no user id yet.
 *
 */
export type RevocableRefreshTokens = AuthDb['refreshTokens']

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
  await refreshTokens.revokeAllForUser(userId, now)
  // belt to that braces: a caller that knows its own family revokes it too, so a repo-level
  // surprise (a partially-applied transaction, a fake in a test) still kills the session in hand
  if (fallbackFamilyId !== undefined) await refreshTokens.revokeFamily(fallbackFamilyId, now)
}
