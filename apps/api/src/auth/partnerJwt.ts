import { sign, verify } from 'hono/jwt'
import { z } from 'zod'

import { ISSUER } from './jwt.js'

/**
 * Partner (affiliate) access JWT (F5). Kept DELIBERATELY SEPARATE from the tenant access token
 * (jwt.ts): a partner is not a tenant user, carries NO tenant/account scope, and must never satisfy
 * a tenant-scoped route (nor a tenant token a partner route). Same HS256 secret + same process, but a
 * `typ:'partner'` discriminator + the ABSENCE of `ten` make the two mutually unforgeable — the tenant
 * verifier requires `ten` (→ rejects a partner token) and this verifier requires `typ:'partner'`
 * (→ rejects a tenant token). No refresh: a partner re-logs in when the (moderate-TTL) token expires;
 * the surface is a low-sensitivity, read-only view of the partner's own commissions.
 */
export interface PartnerClaims {
  sub: string // affiliate id
}

const partnerClaimsSchema = z.looseObject({
  sub: z.string().min(1),
  typ: z.literal('partner'),
  iss: z.literal(ISSUER),
  iat: z.number(),
  exp: z.number(),
})

export function mintPartnerToken(affiliateId: string, secret: string, ttlS: number, nowS = Math.floor(Date.now() / 1000)): Promise<string> {
  return sign({ sub: affiliateId, typ: 'partner', iss: ISSUER, iat: nowS, exp: nowS + ttlS }, secret, 'HS256')
}

export async function verifyPartnerToken(token: string, secret: string): Promise<PartnerClaims | null> {
  try {
    const parsed = partnerClaimsSchema.safeParse(await verify(token, secret, 'HS256'))
    return parsed.success ? { sub: parsed.data.sub } : null
  } catch {
    return null
  }
}
