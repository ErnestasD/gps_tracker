import { sign, verify } from 'hono/jwt'
import { z } from 'zod'

import { roleSchema, type Role } from '@orbetra/shared'

/**
 * Access JWT (E03-1, §6.6/§6.7): HS256 via hono/jwt (built-in — ADR-019), 15 min
 * TTL. Claims carry tenant/account scope + role. Signer and verifier are the same
 * process, so no aud and no clock-skew leeway (revisit if verification ever moves
 * off-host). Refresh tokens are NOT JWTs — they are opaque CSPRNG values in an
 * httpOnly cookie (see login.ts).
 */

export const ISSUER = 'orbetra-api'

export interface AccessClaims {
  sub: string
  ten: string
  acc?: string
  role: Role
}

const claimsSchema = z.looseObject({
  sub: z.string().min(1),
  ten: z.string().min(1),
  acc: z.string().min(1).optional(),
  role: roleSchema,
  iss: z.literal(ISSUER),
  iat: z.number(),
  exp: z.number(),
})

export async function mintAccessToken(
  claims: AccessClaims,
  secret: string,
  ttlS: number,
  nowS = Math.floor(Date.now() / 1000),
): Promise<string> {
  return sign(
    { ...claims, iss: ISSUER, iat: nowS, exp: nowS + ttlS },
    secret,
    'HS256',
  )
}

/** Verify signature+exp (hono/jwt) then the claim SHAPE (zod) — a token signed
 * with our secret but missing scope claims must not authenticate. */
export async function verifyAccessToken(token: string, secret: string): Promise<AccessClaims | null> {
  try {
    const payload = await verify(token, secret, 'HS256')
    const parsed = claimsSchema.safeParse(payload)
    if (!parsed.success) return null
    const { sub, ten, acc, role } = parsed.data
    return acc !== undefined ? { sub, ten, acc, role } : { sub, ten, role }
  } catch {
    return null // bad signature / expired / malformed
  }
}
