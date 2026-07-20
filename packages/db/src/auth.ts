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
  }
  refreshTokens: {
    create(row: { id: string; familyId: string; userId: string; tokenHash: string; expiresAt: Date }): Promise<void>
    /**
     * Atomic rotation claim: marks the token rotated iff it is live (not rotated,
     * not revoked, not expired). Exactly ONE of two concurrent claims wins —
     * row-level lock on the conditional UPDATE, no transaction needed.
     */
    claimForRotation(tokenHash: string, now: Date): Promise<{ familyId: string; userId: string } | null>
    findByTokenHash(tokenHash: string): Promise<RefreshTokenRow | null>
    revokeFamily(familyId: string, now: Date): Promise<void>
    /** Revoke EVERY non-revoked refresh token for a user, across ALL families — the eviction a
     *  password change / admin reset needs so every other live session is logged out. UNSCOPED BY
     *  DESIGN (refresh-token rows hang off userId; the userId comes from the verified access token).
     *  Optional on the interface so lightweight AuthDb doubles need not implement it; the api calls it
     *  via a `typeof … === 'function'` guard (apps/api/src/auth/revoke.ts) and the real db provides it. */
    revokeAllForUser?(userId: string, now: Date): Promise<void>
  }
  /** Forgot-password one-time tokens (raw = 32B CSPRNG, sha256-stored, single-use, short TTL). */
  passwordResetTokens: {
    create(row: { id: string; userId: string; tokenHash: string; expiresAt: Date }): Promise<void>
    /**
     * Atomic single-use consume: marks the token used iff it is live (not used, not expired) and
     * returns its userId. Exactly ONE of two concurrent consumes wins (row-level lock on the
     * conditional UPDATE, no transaction) — mirrors refreshTokens.claimForRotation.
     */
    consume(tokenHash: string, now: Date): Promise<{ userId: string } | null>
    /** Invalidate a user's outstanding (unused) reset tokens — called when a NEW reset is requested
     *  (only the latest link stays valid) and after a successful reset. */
    invalidateAllForUser(userId: string, now: Date): Promise<void>
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
  // join the owning tenant's plan so the row carries the entitlement axis (login computes entitlements)
  tenant: { select: { plan: true } },
} as const

/** Flatten the joined `tenant.plan` into the flat AuthUserRow shape. */
type AuthUserJoined = Omit<AuthUserRow, 'plan'> & { tenant: { plan: TenantPlan } }
const flattenAuthRow = ({ tenant, ...rest }: AuthUserJoined): AuthUserRow => ({ ...rest, plan: tenant.plan })

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
      revokeAllForUser: async (userId, now) => {
        await prisma.refreshToken.updateMany({ where: { userId, revokedAt: null }, data: { revokedAt: now } })
      },
    },
    passwordResetTokens: {
      create: async (row) => {
        await prisma.passwordResetToken.create({ data: row })
      },
      consume: async (tokenHash, now) => {
        const claimed = await prisma.passwordResetToken.updateManyAndReturn({
          where: { tokenHash, usedAt: null, expiresAt: { gt: now } },
          data: { usedAt: now },
          select: { userId: true },
        })
        return claimed[0] ?? null
      },
      invalidateAllForUser: async (userId, now) => {
        await prisma.passwordResetToken.updateMany({ where: { userId, usedAt: null }, data: { usedAt: now } })
      },
    },
  }
}

export function createAuthDb(databaseUrl: string): AuthDb {
  const prisma = new PrismaClient({ datasourceUrl: databaseUrl })
  return { ...buildAuthMethods(prisma), $disconnect: () => prisma.$disconnect() }
}
