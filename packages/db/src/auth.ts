import { PrismaClient } from '@prisma/client'

import type { Role } from '@orbetra/shared'

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
] as const

export interface AuthUserRow {
  id: string
  tenantId: string
  accountId: string | null
  email: string
  passwordHash: string
  role: Role
  locale: string
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
  }
  $disconnect(): Promise<void>
}

export function createAuthDb(databaseUrl: string): AuthDb {
  const prisma = new PrismaClient({ datasourceUrl: databaseUrl })
  return {
    users: {
      findByEmailAllTenants: (email) =>
        prisma.user.findMany({
          where: { email },
          select: { id: true, tenantId: true, accountId: true, email: true, passwordHash: true, role: true, locale: true },
        }),
      findByIdForAuth: (id) =>
        prisma.user.findUnique({
          where: { id },
          select: { id: true, tenantId: true, accountId: true, email: true, passwordHash: true, role: true, locale: true },
        }),
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
        await prisma.refreshToken.updateMany({
          where: { familyId, revokedAt: null },
          data: { revokedAt: now },
        })
      },
    },
    $disconnect: () => prisma.$disconnect(),
  }
}
