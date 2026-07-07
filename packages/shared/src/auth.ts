import { z } from 'zod'

import { roleSchema } from './roles.js'

/**
 * Argon2id parameters (E03-1 story: m=64MB, t=3, p=4). SINGLE SOURCE for both
 * apps/api/src/auth/passwords.ts and packages/db/seed/users.ts — the AC[3]
 * anti-weakening test guards every hashing path through this constant.
 */
export const ARGON2ID_PARAMS = {
  memoryCost: 65536, // KiB = 64 MB
  timeCost: 3,
  parallelism: 4,
} as const

// ── web ↔ api auth contract (§6.6 POST /v1/auth/login|refresh|logout) ────────

export const loginRequestSchema = z.object({
  // normalized BEFORE validation — "  VW@X.LT " must reach the lookup as "vw@x.lt"
  email: z.preprocess(
    (v) => (typeof v === 'string' ? v.trim().toLowerCase() : v),
    z.string().email().max(320),
  ),
  password: z.string().min(1).max(1024),
})
export type LoginRequest = z.infer<typeof loginRequestSchema>

export const authUserSchema = z.strictObject({
  id: z.string(),
  email: z.string(),
  role: roleSchema,
  tenantId: z.string(),
  accountId: z.string().nullable(),
  locale: z.string(),
})
export type AuthUser = z.infer<typeof authUserSchema>

/** Response of POST /v1/auth/login and /v1/auth/refresh (refresh cookie rides separately). */
export const authSessionSchema = z.strictObject({
  accessToken: z.string(),
  expiresInS: z.number().int(),
  user: authUserSchema,
})
export type AuthSession = z.infer<typeof authSessionSchema>
