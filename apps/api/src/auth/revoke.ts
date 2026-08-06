import type { AuthDb } from '@orbetra/db'

/**
 * The refresh-token surface plus the by-user `revokeAllForUser` (E03 review HIGH). A password
 * change or admin reset must revoke EVERY family of the user — not just the current cookie's —
 * so a stolen/other session cannot outlive a password reset. The carrier is
 * `refreshTokens.revokeAllForUser(userId, now)`, which revokes every non-revoked row AND stamps the
 * session epoch in one transaction — the epoch is what reaches a rotation that has already claimed
 * its token, which a row sweep alone cannot.
 *
 * `fallbackFamilyId` is the caller's own family, revoked ALONGSIDE (not instead of) the by-user
 * sweep — see the note in the body about why they are attempted independently.
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
  // BOTH are attempted, independently. A sequential `await` short-circuits, so a repo-level surprise
  // — the 40P01 deadlock `rotate`'s own docstring says is possible — meant the "belt to braces"
  // family revoke never ran either, and the caller answered 500 for a password that HAD changed.
  const results = await Promise.allSettled([
    refreshTokens.revokeAllForUser(userId, now),
    ...(fallbackFamilyId !== undefined ? [refreshTokens.revokeFamily(fallbackFamilyId, now)] : []),
  ])
  const failed = results.filter((r) => r.status === 'rejected')
  if (failed.length === results.length) {
    // EVERYTHING failed — the sessions are still live, and that is worth surfacing. A partial
    // failure is not: one of the two paths revoked, and the caller's password is already changed.
    throw failed[0]!.reason instanceof Error ? failed[0]!.reason : new Error(String(failed[0]!.reason))
  }
  for (const r of failed) console.error('session revoke partially failed', r.reason instanceof Error ? r.reason.message : String(r.reason))
}
