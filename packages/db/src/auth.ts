import { PrismaClient } from '@prisma/client'

import type { Role, TenantPlan } from '@orbetra/shared'

/**
 * Auth DB surface (E03-1) — the FIRST PrismaClient in the repo and the seed of
 * E03-2's scoped-repository layer (E03-2 folds this into src/repos/ and threads
 * the client through). Deliberately narrow: only what login/refresh need.
 *
 * SCOPING EXCEPTION: the methods listed in UNSCOPED_AUTH_METHODS run WITHOUT a
 * tenant scope — login necessarily precedes tenant knowledge, and refresh-token
 * rows hang off userId and are only ever addressed by tokenHash/pk. Every other
 * repo method (E03-2+) takes an explicit Scope. E03-2's isolation meta-test
 * imports this constant as its ONLY exemption list — do not add entries without
 * an ADR.
 */
export const UNSCOPED_AUTH_METHODS = [
  'users.findByEmailAllTenants',
  'users.findByIdForAuth',
  'refreshTokens.*',
  // forgot-password: the raw token IS the capability (precedes any session/tenant knowledge);
  // rows hang off userId and are only ever addressed by tokenHash. UNSCOPED BY DESIGN.
  'passwordResetTokens.*',
  // retention prunes: a horizon is platform-wide by definition, the caller is the worker's daily
  // sweep with no request identity behind it, and they address rows only by expiry. Same shape as
  // webhookDeliveries.pruneOlderThan / rawRejects.pruneOlderThan on the scoped side (audit MED #53).
  'tokenRetention.*',
  // email verification (audit MED #67): the raw token IS the capability and it precedes any session
  // or tenant knowledge, exactly like passwordResetTokens.*. `findUnverified` is a cross-tenant
  // lookup by address for the same reason login's is — an address is not owned by a tenant until
  // someone proves it.
  'emailVerificationTokens.*',
] as const

export interface AuthUserRow {
  id: string
  tenantId: string
  accountId: string | null
  email: string
  passwordHash: string
  role: Role
  locale: string
  /** the owning tenant's plan (entitlement axis) — joined from tenant so the session can carry entitlements. */
  plan: TenantPlan
  /** live Stripe/trial status + window, joined so the session hint matches the server's trial-aware gate. */
  subscriptionStatus: string | null
  currentPeriodEnd: Date | null
  /** null for an F2 LOCAL trial; set for a Stripe-side subscription (the trial discriminator). */
  stripeSubscriptionId: string | null
  /** NULL ⇒ the address was never proven and the account cannot authenticate (audit MED #67).
   *  Only public self-serve signup ever creates such a row. */
  emailVerifiedAt: Date | null
}

export interface RefreshTokenRow {
  familyId: string
  userId: string
  rotatedAt: Date | null
  revokedAt: Date | null
  expiresAt: Date
}

export interface AuthDb {
  users: {
    /** UNSCOPED BY DESIGN (see UNSCOPED_AUTH_METHODS): login precedes tenant knowledge. */
    findByEmailAllTenants(email: string): Promise<AuthUserRow[]>
    /** UNSCOPED BY DESIGN: pk lookup from a refresh token we minted ourselves. */
    findByIdForAuth(id: string): Promise<AuthUserRow | null>
    /** Self-service password change (E03-2): the userId comes from the verified
     * access token, so no tenant scope is needed. UNSCOPED BY DESIGN. */
    setPassword(id: string, passwordHash: string): Promise<void>
    /** Self-service locale change (PATCH /v1/auth/me): userId from the verified token,
     * so the language choice follows the user across devices + localizes server emails.
     * UNSCOPED BY DESIGN. */
    setLocale(id: string, locale: string): Promise<void>
  }
  refreshTokens: {
    create(row: { id: string; familyId: string; userId: string; tokenHash: string; expiresAt: Date }): Promise<void>
    /**
     * Atomic rotation claim: marks the token rotated iff it is live (not rotated,
     * not revoked, not expired). Exactly ONE of two concurrent claims wins —
     * row-level lock on the conditional UPDATE, no transaction needed.
     */
    claimForRotation(tokenHash: string, now: Date): Promise<{ familyId: string; userId: string } | null>
    /**
     * Rotate a live refresh token to a successor ATOMICALLY, fenced against session eviction.
     *
     * claim → check → insert must be ONE transaction holding a lock the eviction paths also take,
     * or the fence is a snapshot read that cannot see an uncommitted eviction (audit high). The
     * transaction claims the token, takes `SELECT … FOR UPDATE` on the owning user — which BLOCKS
     * behind any in-flight `revokeAllForUser` — and refuses if the claimed token predates the
     * user's session epoch. If rotation wins the lock instead, the eviction's `revokedAt IS NULL`
     * sweep runs afterwards and covers the successor we just wrote. Either order is safe.
     *
     * Returns null when the token is not live OR the family was evicted. UNSCOPED BY DESIGN.
     */
    rotate(
      tokenHash: string,
      now: Date,
      successor: { id: string; tokenHash: string; expiresAt: Date },
    ): Promise<{ familyId: string; userId: string } | null>
    findByTokenHash(tokenHash: string): Promise<RefreshTokenRow | null>
    revokeFamily(familyId: string, now: Date): Promise<void>
    /**
     * True when ANY row in the family carries `revokedAt` — i.e. the family was evicted (logout,
     * password change/reset, admin role change, user delete). Read AFTER a rotation insert: every
     * eviction path is an `updateMany WHERE revokedAt IS NULL`, which by definition cannot match a
     * row inserted after it ran, so a refresh in flight during the eviction re-mints a LIVE token in
     * the family that was just killed. Ordinary rotation sets `rotatedAt`, never `revokedAt`, so
     * this predicate is exactly "was this family evicted". UNSCOPED BY DESIGN (familyId comes from
     * the token we just claimed).
     */
    familyRevoked(familyId: string): Promise<boolean>
    /**
     * True when ANY row in the family carries `revokedAt`. Kept for the reuse-detection path;
     * NOT a revocation fence — see `rotate`.
     */
    familyRevoked(familyId: string): Promise<boolean>
    /** Revoke EVERY non-revoked refresh token for a user, across ALL families — the eviction a
     *  password change / admin reset needs so every other live session is logged out. UNSCOPED BY
     *  DESIGN (refresh-token rows hang off userId; the userId comes from the verified access token).
     *  Optional on the interface so lightweight AuthDb doubles need not implement it; the api calls it
     *  via a `typeof … === 'function'` guard (apps/api/src/auth/revoke.ts) and the real db provides it. */
    /**
     * Revoke EVERY session of a user, and stamp the epoch that makes the eviction visible to a
     * rotation already in flight. The carrier for a password reset, an admin role/scope change and
     * an account move — anything after which a token minted a second ago must stop working.
     */
    revokeAllForUser(userId: string, now: Date): Promise<void>
  }
  /** Forgot-password one-time tokens (raw = 32B CSPRNG, sha256-stored, single-use, short TTL). */
  passwordResetTokens: {
    create(row: { id: string; userId: string; tokenHash: string; expiresAt: Date }): Promise<void>
    /**
     * Atomic single-use consume: marks the token used iff it is live (not used, not expired) and
     * returns its userId. Exactly ONE of two concurrent consumes wins (row-level lock on the
     * conditional UPDATE, no transaction) — mirrors refreshTokens.claimForRotation.
     *
     * Redeeming it ALSO verifies the address (audit MED #67 review). A reset link is delivered to the
     * mailbox and comes back, which is the same proof the activation link carries — and without this
     * the recovery route we signpost was a dead end: the "you already have an account" mail says
     * "sign in, or reset your password", and for the case that mail exists for (an address squatted
     * by someone else's unverified signup) resetting succeeded and then login still 401'd, with no
     * explanation anywhere.
     */
    consume(tokenHash: string, now: Date): Promise<{ userId: string } | null>
    /** Invalidate a user's outstanding (unused) reset tokens — called when a NEW reset is requested
     *  (only the latest link stays valid) and after a successful reset. */
    invalidateAllForUser(userId: string, now: Date): Promise<void>
  }
  /**
   * Address-ownership proof for a public self-serve signup (audit MED #67). Same shape as
   * passwordResetTokens for the same reasons: the raw token is the capability, only its hash is
   * stored, and consuming it is a single atomic conditional UPDATE so two concurrent clicks on the
   * same link cannot both succeed. UNSCOPED BY DESIGN — verification precedes any session.
   */
  emailVerificationTokens: {
    create(row: { id: string; userId: string; tokenHash: string; expiresAt: Date }): Promise<void>
    /** Consume the token AND mark the user verified, atomically. Returns the user, or null when the
     *  token is unknown, used or expired. */
    consume(tokenHash: string, now: Date): Promise<{ userId: string; tenantId: string; email: string } | null>
    /** The UNVERIFIED user for an address, if any — the resend path. Null when the address is
     *  unknown OR already verified; the caller must answer identically either way. */
    findUnverified(email: string): Promise<{ id: string; tenantId: string; locale: string } | null>
    invalidateAllForUser(userId: string, now: Date): Promise<void>
  }
  /**
   * Retention for the token tables (audit MED #53). Nothing ever deleted from them: every login
   * writes a `refresh_tokens` row and every rotation writes another, so the table grows for the
   * life of the platform — on the hot auth path, where `findByTokenHash`/`claimForRotation` pay for
   * every dead row in the index. Reset tokens are smaller but identical in shape.
   *
   * DEAD means expired, revoked, rotated or used — a row in any of those states can never
   * authenticate anything again; the live-session check is a predicate on the row, not on its
   * existence. `cutoff` is applied to `expiresAt` so a token is only removed once it is past its own
   * lifetime as well, which keeps the family-revocation trail intact for as long as it could matter.
   */
  tokenRetention: {
    pruneRefreshTokens(cutoff: Date, batchSize?: number): Promise<number>
    pruneResetTokens(cutoff: Date, batchSize?: number): Promise<number>
    pruneAffiliateTokens(cutoff: Date, batchSize?: number): Promise<number>
    pruneVerificationTokens(cutoff: Date, batchSize?: number): Promise<number>
  }
  $disconnect(): Promise<void>
}

const AUTH_USER_SELECT = {
  id: true,
  tenantId: true,
  accountId: true,
  email: true,
  passwordHash: true,
  role: true,
  locale: true,
  emailVerifiedAt: true,
  // join the owning tenant's plan + live billing window so the session hint can be TRIAL-AWARE
  // (an expired F2 trial must not advertise features the server already floors) — login computes
  // entitlements with effectiveEntitlementsAt, the same helper the authoritative gate uses.
  tenant: { select: { plan: true, subscriptionStatus: true, currentPeriodEnd: true, stripeSubscriptionId: true } },
} as const

/** Flatten the joined tenant billing fields into the flat AuthUserRow shape. */
type AuthUserJoined = Omit<AuthUserRow, 'plan' | 'subscriptionStatus' | 'currentPeriodEnd' | 'stripeSubscriptionId'> & {
  tenant: { plan: TenantPlan; subscriptionStatus: string | null; currentPeriodEnd: Date | null; stripeSubscriptionId: string | null }
}
const flattenAuthRow = ({ tenant, ...rest }: AuthUserJoined): AuthUserRow => ({
  ...rest,
  plan: tenant.plan,
  subscriptionStatus: tenant.subscriptionStatus,
  currentPeriodEnd: tenant.currentPeriodEnd,
  stripeSubscriptionId: tenant.stripeSubscriptionId,
})

/** Auth methods over an existing PrismaClient — shared by createAuthDb and
 * createDb (E03-2) so both surfaces stay identical. */
export function buildAuthMethods(prisma: PrismaClient): Omit<AuthDb, '$disconnect'> {
  return {
    users: {
      findByEmailAllTenants: async (email) =>
        (await prisma.user.findMany({ where: { email }, select: AUTH_USER_SELECT })).map(flattenAuthRow),
      findByIdForAuth: async (id) => {
        const row = await prisma.user.findUnique({ where: { id }, select: AUTH_USER_SELECT })
        return row === null ? null : flattenAuthRow(row)
      },
      setPassword: async (id, passwordHash) => {
        await prisma.user.update({ where: { id }, data: { passwordHash } })
      },
      setLocale: async (id, locale) => {
        await prisma.user.update({ where: { id }, data: { locale } })
      },
    },
    refreshTokens: {
      create: async (row) => {
        await prisma.refreshToken.create({ data: row })
      },
      claimForRotation: async (tokenHash, now) => {
        const claimed = await prisma.refreshToken.updateManyAndReturn({
          where: { tokenHash, rotatedAt: null, revokedAt: null, expiresAt: { gt: now } },
          data: { rotatedAt: now },
          select: { familyId: true, userId: true },
        })
        return claimed[0] ?? null
      },
      findByTokenHash: (tokenHash) =>
        prisma.refreshToken.findUnique({
          where: { tokenHash },
          select: { familyId: true, userId: true, rotatedAt: true, revokedAt: true, expiresAt: true },
        }),
      revokeFamily: async (familyId, now) => {
        await prisma.refreshToken.updateMany({ where: { familyId, revokedAt: null }, data: { revokedAt: now } })
      },
      familyRevoked: async (familyId) =>
        (await prisma.refreshToken.findFirst({ where: { familyId, revokedAt: { not: null } }, select: { id: true } })) !== null,
      revokeAllForUser: async (userId, now) => {
        // ONE transaction, user row FIRST: that write is the lock a concurrent rotation blocks on
        // (see `rotate`). Stamping the epoch is what makes the eviction visible to a rotation that
        // has already claimed its token — the row sweep alone cannot reach a row inserted later.
        await prisma.$transaction([
          prisma.user.update({ where: { id: userId }, data: { sessionsRevokedAt: now } }),
          prisma.refreshToken.updateMany({ where: { userId, revokedAt: null }, data: { revokedAt: now } }),
        ])
      },
      rotate: async (tokenHash, now, successor) =>
        prisma.$transaction(async (tx) => {
          // Whose token is this? An UNLOCKED read purely to learn the user id — correctness still
          // rests entirely on the conditional claim below, which is atomic on its own.
          const owner = await tx.refreshToken.findUnique({ where: { tokenHash }, select: { userId: true } })
          if (owner === null) return null
          // Lock the USER first, then the token. `revokeAllForUser` takes the same two in the same
          // order; the reverse (claim, then lock the user) deadlocks against it under load — one
          // transaction holds the token row and wants the user, the other holds the user and wants
          // the token, and Postgres kills one with 40P01. Lock ordering is the whole fix here.
          // This BLOCKS behind an in-flight eviction and releases at commit.
          const locked = await tx.$queryRaw<{ sessionsRevokedAt: Date | null }[]>`
            SELECT "sessionsRevokedAt" FROM "users" WHERE "id" = ${owner.userId}::uuid FOR UPDATE`
          const epoch = locked[0]?.sessionsRevokedAt ?? null
          const claimed = await tx.refreshToken.updateManyAndReturn({
            where: { tokenHash, rotatedAt: null, revokedAt: null, expiresAt: { gt: now } },
            data: { rotatedAt: now },
            select: { familyId: true, userId: true, createdAt: true },
          })
          const row = claimed[0]
          if (row === undefined) return null
          // the token we consumed was minted before the eviction ⇒ this whole family is dead
          if (epoch !== null && row.createdAt <= epoch) return null
          await tx.refreshToken.create({
            data: { id: successor.id, familyId: row.familyId, userId: row.userId, tokenHash: successor.tokenHash, expiresAt: successor.expiresAt },
          })
          return { familyId: row.familyId, userId: row.userId }
        }),
    },
    passwordResetTokens: {
      create: async (row) => {
        await prisma.passwordResetToken.create({ data: row })
      },
      consume: async (tokenHash, now) => {
        return await prisma.$transaction(async (tx) => {
          const claimed = await tx.passwordResetToken.updateManyAndReturn({
            where: { tokenHash, usedAt: null, expiresAt: { gt: now } },
            data: { usedAt: now },
            select: { userId: true },
          })
          const userId = claimed[0]?.userId
          if (userId === undefined) return null
          // …and the address is now PROVEN: the link went to that mailbox and came back, which is
          // exactly what the activation link demonstrates. Without this the recovery route we
          // signpost was a dead end — see the interface note. `updateMany`, so a user deleted under
          // us rolls the claim back instead of raising a P2025 the route never documents.
          const updated = await tx.user.updateMany({ where: { id: userId }, data: { emailVerifiedAt: now } })
          if (updated.count === 0) return null
          return { userId }
        })
      },
      invalidateAllForUser: async (userId, now) => {
        await prisma.passwordResetToken.updateMany({ where: { userId, usedAt: null }, data: { usedAt: now } })
      },
    },
    emailVerificationTokens: {
      create: async (row) => {
        await prisma.emailVerificationToken.create({ data: row })
      },
      consume: async (tokenHash, now) => {
        // ONE transaction: the token is spent and the user is verified together, so a crash between
        // them cannot leave a burnt link on an account that still cannot log in — the user's only
        // recovery would be a resend they have no reason to expect they need.
        return await prisma.$transaction(async (tx) => {
          const claimed = await tx.emailVerificationToken.updateManyAndReturn({
            where: { tokenHash, usedAt: null, expiresAt: { gt: now } },
            data: { usedAt: now },
            select: { userId: true },
          })
          const userId = claimed[0]?.userId
          if (userId === undefined) return null
          // idempotent on the user side: verifying an already-verified account is a no-op, not an error
          const updated = await tx.user.updateManyAndReturn({ where: { id: userId }, data: { emailVerifiedAt: now }, select: { id: true, tenantId: true, email: true } })
          const user = updated[0]
          // The user vanished under us — a concurrent tenant/user delete, or the unverified-signup
          // sweep. `update` would raise P2025, which the API's error mapper turns into a 404 rather
          // than the promised 400, and would leave the caller staring at a status the route never
          // documents. `updateMany` returns an empty set instead, and the enclosing transaction rolls
          // the claim back, so the token is not burnt either.
          if (user === undefined) return null
          return { userId: user.id, tenantId: user.tenantId, email: user.email }
        })
      },
      findUnverified: async (email) => {
        const row = await prisma.user.findFirst({ where: { email, emailVerifiedAt: null }, select: { id: true, tenantId: true, locale: true } })
        return row ?? null
      },
      invalidateAllForUser: async (userId, now) => {
        await prisma.emailVerificationToken.updateMany({ where: { userId, usedAt: null }, data: { usedAt: now } })
      },
    },
    tokenRetention: {
      // batched like every other prune here: the first run after this ships clears however many
      // months of dead rows have accumulated, and one unbounded DELETE would hold a lock on the
      // table `claimForRotation` needs for every token refresh in flight.
      pruneRefreshTokens: async (cutoff, batchSize = 5_000) => {
        const size = batchOf(batchSize)
        let total = 0
        for (;;) {
          // dead = it can never authenticate again. `expiresAt < cutoff` on TOP of that, so a
          // revoked-family row survives its own lifetime and stays available for forensics.
          const n = await prisma.$executeRaw`
            DELETE FROM refresh_tokens WHERE id IN (
              SELECT id FROM refresh_tokens
               WHERE "expiresAt" < ${cutoff}
                 AND ("revokedAt" IS NOT NULL OR "rotatedAt" IS NOT NULL OR "expiresAt" < now())
               LIMIT ${size})`
          total += n
          if (n < size) return total
        }
      },
      pruneResetTokens: async (cutoff, batchSize = 5_000) => {
        const size = batchOf(batchSize)
        let total = 0
        for (;;) {
          const n = await prisma.$executeRaw`
            DELETE FROM password_reset_tokens WHERE id IN (
              SELECT id FROM password_reset_tokens
               WHERE "expiresAt" < ${cutoff}
               LIMIT ${size})`
          total += n
          if (n < size) return total
        }
      },
      pruneVerificationTokens: async (cutoff, batchSize = 5_000) => {
        const size = batchOf(batchSize)
        let total = 0
        for (;;) {
          const n = await prisma.$executeRaw`
            DELETE FROM email_verification_tokens WHERE id IN (
              SELECT id FROM email_verification_tokens
               WHERE "expiresAt" < ${cutoff}
               LIMIT ${size})`
          total += n
          if (n < size) return total
        }
      },
      pruneAffiliateTokens: async (cutoff, batchSize = 5_000) => {
        const size = batchOf(batchSize)
        let total = 0
        for (;;) {
          const n = await prisma.$executeRaw`
            DELETE FROM affiliate_password_tokens WHERE id IN (
              SELECT id FROM affiliate_password_tokens
               WHERE "expiresAt" < ${cutoff}
               LIMIT ${size})`
          total += n
          if (n < size) return total
        }
      },
    },
  }
}

/** Clamp a caller-supplied batch size — shared by the token prunes. */
const batchOf = (n: number): number => Math.min(Math.max(Math.trunc(n), 1), 50_000)

export function createAuthDb(databaseUrl: string): AuthDb {
  const prisma = new PrismaClient({ datasourceUrl: databaseUrl })
  return { ...buildAuthMethods(prisma), $disconnect: () => prisma.$disconnect() }
}
