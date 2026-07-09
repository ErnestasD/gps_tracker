import type { Redis } from 'ioredis'

import { hashKey, type ApiKeyRepo } from '@orbetra/db'

import type { AuthContext } from './middleware.js'

/**
 * API-key authentication (E06-3, §6.6). An integration sends `X-Api-Key: orb_live_…`; we
 * SHA-256 it, look up the active key, and build a READ-ONLY AuthContext (role `viewer`) so
 * key holders can GET/report but never mutate (WRITE_POLICY excludes viewer). A per-key
 * fixed-window counter enforces the rate limit (600/min default) — a pragmatic approximation
 * of §8's token bucket, mirroring the login-lockout Redis INCR pattern.
 */
export interface ApiKeyAuthDeps {
  apiKeys: ApiKeyRepo
  redis: Redis
  /** requests per minute per key (default 600, §8) */
  perMin: number
  /** injected for deterministic tests; defaults to Date.now */
  now?: () => number
}
export type ApiKeyOutcome = { ok: AuthContext } | { error: 'unauthorized' | 'rate_limited' }
export interface ApiKeyAuth {
  resolve(rawKey: string): Promise<ApiKeyOutcome>
}

export function createApiKeyAuth(deps: ApiKeyAuthDeps): ApiKeyAuth {
  const now = deps.now ?? (() => Date.now())
  return {
    resolve: async (rawKey) => {
      const resolved = await deps.apiKeys.findActiveByHash(hashKey(rawKey))
      if (resolved === null) return { error: 'unauthorized' } // unknown or revoked key

      // fixed 60 s window per key; the counter TTLs out so it self-resets. NOTE: a
      // boundary-straddling client can burst up to ~2× at a window edge — accepted for v1
      // (600/min is a soft cap; the edge proxy provides per-IP defense). A Redis blip must
      // NOT break API access, so the limiter fails OPEN (skip throttle, still authenticated).
      try {
        const bucket = Math.floor(now() / 60_000)
        const rlKey = `apikey:rl:${resolved.id}:${bucket}`
        const n = await deps.redis.incr(rlKey)
        if (n === 1) await deps.redis.expire(rlKey, 60)
        if (n > deps.perMin) return { error: 'rate_limited' }
      } catch {
        // Redis unavailable → allow the request rather than 500 the whole API-key surface
      }

      // last-used is advisory telemetry — never block or fail the request on it
      void deps.apiKeys.touch(resolved.id).catch(() => undefined)

      return {
        ok: {
          userId: resolved.id, // no human user; the key id identifies the principal
          tenantId: resolved.tenantId,
          ...(resolved.accountId !== null ? { accountId: resolved.accountId } : {}),
          role: 'viewer', // read-only: reads + reports, never writes
        },
      }
    },
  }
}
