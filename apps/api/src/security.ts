import type { MiddlewareHandler } from 'hono'

/**
 * Security response headers (E07-5, §8 W7 S5). Explicit, hand-set (no middleware dep) so
 * the exact header set is visible and testable here:
 *
 * - `X-Content-Type-Options: nosniff` — a JSON/problem+json API must never be sniffed
 *   into HTML (stored-XSS-via-content-type class).
 * - `X-Frame-Options: DENY` — nothing here is embeddable; blocks clickjacking on /v1/docs.
 * - `Referrer-Policy: no-referrer` — URLs can carry ids; never leak them cross-origin.
 * - `Cross-Origin-Opener-Policy: same-origin` + `Cross-Origin-Resource-Policy: same-origin`
 *   — isolate the browsing context; API responses are not cross-origin subresources.
 * - `Permissions-Policy` — the API/docs never need sensors/camera/mic/geolocation*.
 *   (*device geolocation of the BROWSER — tracker positions are data, not a browser API.)
 * - `Strict-Transport-Security` — only when `hsts` is on (production behind TLS; §6.7
 *   deploys terminate TLS at Caddy). Browsers ignore HSTS over plain http, but keeping it
 *   explicit avoids advertising a policy dev/e2e can't honor.
 *
 * NO global Content-Security-Policy: every /v1 response is JSON except /v1/docs, whose
 * self-contained inline script would need a nonce/hash — tracked in the security-pass
 * audit (docs/audit/security-pass-2026-07.md), revisit if the docs page grows.
 */
export function securityHeaders(opts: { hsts: boolean }): MiddlewareHandler {
  const hstsValue = 'max-age=15552000; includeSubDomains' // 180 days
  return async (c, next) => {
    await next()
    c.header('X-Content-Type-Options', 'nosniff')
    c.header('X-Frame-Options', 'DENY')
    c.header('Referrer-Policy', 'no-referrer')
    c.header('Cross-Origin-Opener-Policy', 'same-origin')
    c.header('Cross-Origin-Resource-Policy', 'same-origin')
    c.header('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=()')
    if (opts.hsts) c.header('Strict-Transport-Security', hstsValue)
  }
}

/**
 * Atomic fixed-window counter: INCR, and arm the TTL on the first hit OR whenever the key somehow
 * lost one (`TTL < 0`) — an unexpiring counter would lock a caller out permanently. Returns the
 * post-increment count; the caller compares it against its own ceiling.
 *
 * Fails OPEN (returns 0) on a Redis error: a rate limiter is a guard rail, and an availability
 * blip in Redis must not take the whole API down with it.
 */
const RL_SCRIPT = `local n = redis.call('INCR', KEYS[1])
if n == 1 or redis.call('TTL', KEYS[1]) < 0 then redis.call('EXPIRE', KEYS[1], ARGV[1]) end
return n`

export async function fixedWindowCount(
  redis: { eval(script: string, numKeys: number, ...args: (string | number)[]): Promise<unknown> } | undefined,
  key: string,
  windowS: number,
): Promise<number> {
  if (redis === undefined) return 0
  try {
    return (await redis.eval(RL_SCRIPT, 1, key, String(windowS))) as number
  } catch {
    return 0
  }
}
