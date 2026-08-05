import type { Redis } from 'ioredis'

/**
 * Shared plumbing for the login lockout gates (tenant + partner). Both surfaces run the same three
 * ceilings and must degrade the same way; duplicating this is how one of them silently stops
 * matching the other.
 */

/** One pipelined reply as a number. A FAILED command yields 0 — deliberately, see `gateRead`. */
export const count = (entry: [Error | null, unknown] | undefined): number =>
  entry === undefined || entry[0] !== null ? 0 : Number(entry[1] ?? 0)

/**
 * Run a lockout-gate pipeline and, on any failure, return `null` so every gate reads zero and the
 * request proceeds — a deliberate FAIL-OPEN, made explicit and metered rather than emergent.
 *
 * The choice matters: fail-closed would mean a Redis hiccup logs the whole platform out of its own
 * product, which for a fleet-tracking service is the worse outage. Fail-open means brute-force
 * protection is absent for the duration — argon2 and the process-wide 8-slot semaphore are still
 * the backstop — and, crucially, that it is VISIBLE: `auth_lockout_tripped_total{gate="degraded"}`
 * moves, so the window is an alert rather than a silent hole.
 *
 * Two failure shapes are covered. ioredis returns per-command errors INSIDE the result array
 * instead of throwing (`-OOM`, `-MISCONF` after a failed BGSAVE, `-READONLY` on a replica), which
 * is why `count()` treats an errored entry as absent rather than reading `undefined` as zero by
 * accident. And with `maxRetriesPerRequest: null` plus the default offline queue, a DISCONNECTED
 * Redis makes commands wait forever rather than reject — so a login would hang, not fail. The
 * timeout is what turns that into a degraded login instead of a hung one.
 */
const GATE_TIMEOUT_MS = 1_000
export async function gateRead(
  deps: { redis: Redis; onLockout?: (gate: 'credential' | 'ip' | 'email' | 'degraded') => void },
  run: () => Promise<[Error | null, unknown][] | null>,
): Promise<[Error | null, unknown][] | null> {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    const res = await Promise.race([
      run(),
      new Promise<null>((resolve) => {
        timer = setTimeout(() => resolve(null), GATE_TIMEOUT_MS)
      }),
    ])
    if (res === null || res.some(([err]) => err !== null)) {
      deps.onLockout?.('degraded')
      return null
    }
    return res
  } catch {
    deps.onLockout?.('degraded')
    return null
  } finally {
    if (timer !== undefined) clearTimeout(timer)
  }
}

// atomic fixed-window bump (mirrors caddyAsk RL_SCRIPT): INCR, set TTL on the first hit OR re-arm
// a stranded TTL-less key — a failed one-shot EXPIRE must never leave a key that 429s forever
// (review LOW-2: a Redis blip between INCR and EXPIRE would else permanently lock an IP+email pair)
export const LOCKOUT_SCRIPT = `local n = redis.call('INCR', KEYS[1])
if n == 1 or redis.call('TTL', KEYS[1]) < 0 then redis.call('EXPIRE', KEYS[1], ARGV[1]) end
return n`

// One success repays one failure on the per-IP budget, floored at zero (never negative: a
// long-running honest office must not bank credit an attacker could later spend). Leaves the TTL
// alone — the window is the window.
export const DECAY_SCRIPT = `local n = tonumber(redis.call('GET', KEYS[1]) or '0')
if n > 0 then redis.call('DECR', KEYS[1]) end
return n`

// Record a source IP against an account's failure set and keep the window armed. A HyperLogLog, not
// a SET: an attacker with ten thousand hosts would otherwise write ten thousand members into a key
// they chose, and 12 KB of fixed memory is the difference between a counter and an amplifier. At the
// cardinalities that matter here (tens) the sparse encoding is exact.
export const FAIL_SOURCE_SCRIPT = `redis.call('PFADD', KEYS[1], ARGV[1])
if redis.call('TTL', KEYS[1]) < 0 then redis.call('EXPIRE', KEYS[1], ARGV[2]) end
return redis.call('PFCOUNT', KEYS[1])`
