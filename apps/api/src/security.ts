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
 * (Uploaded brand SVGs DO set their own per-response CSP — see caddyAsk.ts. Nothing is
 * overridden there precisely because there is no global one.)
 */

/**
 * The one path prefix whose responses are meant to be loaded cross-origin.
 *
 * `Cross-Origin-Resource-Policy: same-origin` is right for an API of JSON, and wrong for the one
 * route that answers with a picture: a tenant's brand image is fetched by their sign-in page, by the
 * dashboard on our app host, and by mail clients rendering their logo — all different origins from
 * the one that served it. Because these headers are applied AFTER the handler, a route cannot
 * loosen this for itself; the exception has to live here.
 *
 * Nothing is given away by it. The bytes are a public logo, already on an unauthenticated login
 * page, and an SVG among them carries its own `sandbox` CSP.
 */
const CROSS_ORIGIN_PREFIX = '/v1/public/brand/'

export function securityHeaders(opts: { hsts: boolean }): MiddlewareHandler {
  const hstsValue = 'max-age=15552000; includeSubDomains' // 180 days
  return async (c, next) => {
    await next()
    c.header('X-Content-Type-Options', 'nosniff')
    c.header('X-Frame-Options', 'DENY')
    c.header('Referrer-Policy', 'no-referrer')
    c.header('Cross-Origin-Opener-Policy', 'same-origin')
    c.header('Cross-Origin-Resource-Policy', c.req.path.startsWith(CROSS_ORIGIN_PREFIX) ? 'cross-origin' : 'same-origin')
    c.header('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=()')
    if (opts.hsts) c.header('Strict-Transport-Security', hstsValue)
  }
}

/**
 * Atomic fixed-window counter: INCR, and arm the TTL on the first hit OR whenever the key somehow
 * lost one (`TTL < 0`) — an unexpiring counter would lock a caller out permanently. Returns the
 * post-increment count; the caller compares it against its own ceiling.
 *
 * Fails OPEN (returns 0) on a Redis error OR a timeout: a rate limiter is a guard rail, and an
 * availability blip in Redis must not take the whole API down with it. The timeout is not
 * belt-and-braces — with `maxRetriesPerRequest: null` and the default offline queue, a
 * DISCONNECTED Redis makes commands WAIT rather than reject, so the catch never runs and the
 * request hangs instead of degrading. This is the first thing `GET /v1/devices/last` and
 * `POST /v1/auth/password` do, so a hang here is the whole route.
 */
const RL_TIMEOUT_MS = 1_000
const RL_SCRIPT = `local n = redis.call('INCR', KEYS[1])
if n == 1 or redis.call('TTL', KEYS[1]) < 0 then redis.call('EXPIRE', KEYS[1], ARGV[1]) end
return n`

export async function fixedWindowCount(
  redis: { eval(script: string, numKeys: number, ...args: (string | number)[]): Promise<unknown> } | undefined,
  key: string,
  windowS: number,
  /** Fired when the limiter could not be evaluated and the caller was let through. `gateRead` has
   *  the same hook for the same reason: a fail-open window must be an alert, not a silent hole —
   *  `POST /v1/auth/password` losing its limiter means two 64 MB argon2 ops per request, unbounded,
   *  into the process-wide semaphore, invisibly. */
  onDegraded?: () => void,
): Promise<number> {
  if (redis === undefined) return 0
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    const n = await Promise.race([
      redis.eval(RL_SCRIPT, 1, key, String(windowS)),
      new Promise<number>((resolve) => {
        timer = setTimeout(() => {
          onDegraded?.()
          resolve(0)
        }, RL_TIMEOUT_MS)
      }),
    ])
    return Number(n ?? 0)
  } catch {
    onDegraded?.()
    return 0
  } finally {
    if (timer !== undefined) clearTimeout(timer)
  }
}
