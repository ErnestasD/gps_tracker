import { createHash, randomBytes, randomUUID } from 'node:crypto'

import { Hono, type Context } from 'hono'
import { bodyLimit } from 'hono/body-limit'
import type { Redis } from 'ioredis'

import type { Db } from '@orbetra/db'

import { clientIp } from '../net.js'

/**
 * Public e-mail verification for self-serve signup (audit MED #67).
 *
 * WHY THIS EXISTS AT ALL. Answering a duplicate signup with the same 201 as a real one removed the
 * oracle from the RESPONSE, but not from the system: the free branch still handed back a working
 * account, so a second request — a login with the password the caller had just chosen — answered
 * "does this address exist" with certainty. Proof of ownership is what removes that second request.
 * An unverified account fails login exactly like a wrong password, so both branches of signup now
 * end in the same 401 and there is nothing left to observe.
 *
 * Independently, it is also the thing that stops a stranger registering someone else's address.
 *
 * TWO ENDPOINTS, TWO DIFFERENT ANSWERS, ON PURPOSE:
 *  - `POST /v1/public/verify-email` is honest — a token is either good or it is not, and saying so
 *    reveals nothing: tokens are 256 bits of CSPRNG and are stored only as a SHA-256 hash.
 *  - `POST /v1/public/verify-email/resend` ALWAYS answers 200 with the same body, exactly like
 *    forgot-password, because its input is an ADDRESS. It is rate-limited per address as well as per
 *    IP so it cannot be turned into a mail-bomb aimed at one inbox.
 */
export interface VerifyEmailRouteDeps {
  db: Db
  redis: Redis
  getRemoteAddr: (c: unknown) => string
  trustProxy: boolean
  /** absolute base for the link in the mail. Absent ⇒ resend is a silent no-op (still 200). */
  appBaseUrl?: string | undefined
  mail?: {
    enqueueVerifyEmail(job: { kind: 'verify-email'; email: string; tenantId: string; locale: string; verifyUrl: string; expiresHours: number }): Promise<void>
  }
  /** a verification actually completed — the signup funnel's real conversion signal. */
  onVerified?: () => void
  /** the activation path is not wired at all (no mail deps / no APP_BASE_URL), so every new signup
   *  is an account that can never log in. MUST be zero in production. */
  onMailUnconfigured?: () => void
}

/** 48 h. Long enough to survive a signup on a Friday evening; short enough that an intercepted link
 *  in an old mailbox is not a standing key to the account. */
export const VERIFY_TTL_S = 48 * 3_600
const RESEND_MAX_PER_EMAIL = 3
const RESEND_MAX_PER_IP = 10
const RESEND_WINDOW_S = 3_600

const sha256 = (s: string): string => createHash('sha256').update(s).digest('hex')

const RL_SCRIPT = `local n = redis.call('INCR', KEYS[1])
if n == 1 or redis.call('TTL', KEYS[1]) < 0 then redis.call('EXPIRE', KEYS[1], ARGV[1]) end
return n`

/**
 * Mint a token, store only its hash, and hand the finished link to the worker.
 *
 * Exported because SIGNUP calls it too: the welcome mail and a resend must produce the same link
 * shape and the same single-use semantics, and two copies of that would eventually disagree.
 * Invalidates any outstanding token first, so only the newest link works — a user who clicks an old
 * mail after requesting a new one gets a clean failure instead of a silent success on a stale token.
 */
export async function sendVerificationEmail(
  deps: Pick<VerifyEmailRouteDeps, 'db' | 'mail' | 'appBaseUrl' | 'onMailUnconfigured'>,
  user: { id: string; tenantId: string; email: string; locale: string },
): Promise<void> {
  // NOT silent. An unset APP_BASE_URL or unwired mail deps means every signup creates an account
  // nobody can ever log into, and the response cannot say so — a 201 either way is the whole design.
  // Without this counter the failure is invisible: `onVerifyMailFailed` only fires when the enqueue
  // THROWS, and not being wired at all throws nothing.
  if (deps.mail === undefined || deps.appBaseUrl === undefined) {
    deps.onMailUnconfigured?.()
    console.error('verify-email: activation mail is NOT configured — new signups cannot log in')
    return
  }
  const base = deps.appBaseUrl.replace(/\/+$/, '')
  await deps.db.auth.emailVerificationTokens.invalidateAllForUser(user.id, new Date())
  const rawToken = randomBytes(32).toString('hex')
  await deps.db.auth.emailVerificationTokens.create({
    id: randomUUID(),
    userId: user.id,
    tokenHash: sha256(rawToken),
    expiresAt: new Date(Date.now() + VERIFY_TTL_S * 1000),
  })
  await deps.mail.enqueueVerifyEmail({
    kind: 'verify-email',
    email: user.email,
    tenantId: user.tenantId,
    locale: user.locale,
    // `lng` carries the RECIPIENT's language across the origin hop. The mail is written in their
    // language and the page it opens used to guess from the browser, so a Lithuanian activation
    // mail could land on an English screen — or the reverse, which is what a prospect sees first.
    verifyUrl: `${base}/verify-email?token=${rawToken}&lng=${encodeURIComponent(user.locale)}`,
    expiresHours: Math.round(VERIFY_TTL_S / 3_600),
  })
}

export function createVerifyEmailRoute(deps: VerifyEmailRouteDeps): Hono {
  const app = new Hono()
  app.use('/v1/public/verify-email', bodyLimit({ maxSize: 8 * 1024 }))
  app.use('/v1/public/verify-email/resend', bodyLimit({ maxSize: 8 * 1024 }))

  app.post('/v1/public/verify-email', async (c: Context) => {
    const body = (await c.req.json().catch(() => null)) as { token?: unknown } | null
    const token = typeof body?.token === 'string' ? body.token.trim() : ''
    // shape-check before touching Redis or the DB: a 4 MB "token" must not become a hash + a query
    if (token.length < 32 || token.length > 256) return c.json({ error: 'invalid_or_expired' }, 400)

    // per-IP only — the input is an unguessable secret, so there is no account to protect here; the
    // limit exists so a bot cannot spend our CPU hashing garbage
    try {
      const ip = clientIp(c.req.header('x-forwarded-for'), deps.getRemoteAddr(c), deps.trustProxy)
      const n = (await deps.redis.eval(RL_SCRIPT, 1, `verify:rl:${ip}`, String(RESEND_WINDOW_S))) as number
      if (n > 60) return c.json({ error: 'rate limited' }, 429)
    } catch (err) {
      // fails OPEN, unlike signup: refusing to verify would leave a legitimate customer unable to
      // use the account they just paid attention to, and the token is still the only thing that
      // grants anything
      console.error('verify-email rate-limit unavailable', err instanceof Error ? err.message : String(err))
    }

    const consumed = await deps.db.auth.emailVerificationTokens.consume(sha256(token), new Date())
    if (consumed === null) return c.json({ error: 'invalid_or_expired' }, 400)
    deps.onVerified?.()
    // no session is minted here — signup never mints tokens either, and a verification link arriving
    // from a mail client (prefetched by a scanner, forwarded, logged in a proxy) must not BE a login
    return c.json({ ok: true })
  })

  app.post('/v1/public/verify-email/resend', async (c: Context) => {
    const body = (await c.req.json().catch(() => null)) as { email?: unknown } | null
    const email = typeof body?.email === 'string' ? body.email.trim().toLowerCase() : ''
    // ALWAYS the same answer from here on: a malformed address, an unknown one, an already-verified
    // one and a real resend are indistinguishable to the caller (the forgot-password contract).
    const ok = c.json({ ok: true })
    if (email === '' || email.length > 320) return ok

    try {
      const ip = clientIp(c.req.header('x-forwarded-for'), deps.getRemoteAddr(c), deps.trustProxy)
      const perIp = (await deps.redis.eval(RL_SCRIPT, 1, `verify:resend:ip:${ip}`, String(RESEND_WINDOW_S))) as number
      // PER-ADDRESS as well, and IP-independent: the per-IP bucket bounds the sender, not the
      // recipient, so without this a rotating pool could point every one of its allowances at a
      // single inbox — from our own SES identity, which the recipient then marks as spam.
      const perEmail = (await deps.redis.eval(RL_SCRIPT, 1, `verify:resend:em:${sha256(email).slice(0, 16)}`, String(RESEND_WINDOW_S))) as number
      if (perIp > RESEND_MAX_PER_IP || perEmail > RESEND_MAX_PER_EMAIL) return ok
    } catch (err) {
      // fails CLOSED — the mail is the side effect, and an unbounded send path is worse than a
      // resend the user can try again in a minute
      console.error('verify-email resend rate-limit unavailable', err instanceof Error ? err.message : String(err))
      return ok
    }

    try {
      const user = await deps.db.auth.emailVerificationTokens.findUnverified(email)
      if (user !== null) {
        await sendVerificationEmail(deps, { id: user.id, tenantId: user.tenantId, email, locale: user.locale })
      } else {
        // TIMING EQUIVALENCE, and it is not decoration — measured, the hit path (invalidate + insert
        // + enqueue) ran a median 5.6 ms against 3.2 ms for a miss, on disjoint distributions. One
        // signup plus one resend then answered "does this address have an account" with no
        // statistics at all, which is precisely the question this whole design refuses. So the miss
        // path performs the SAME writes against a random uuid that owns nothing: the invalidate
        // matches no rows and the insert lands a token for a user id that does not exist… which the
        // FK would reject, so it is the invalidate that is repeated twice instead. Same shape as
        // forgot-password's fabricated `invalidateAllForUser(randomUUID())` — the pattern this
        // codebase already uses for the same reason on the same identity space.
        const nobody = randomUUID()
        await deps.db.auth.emailVerificationTokens.invalidateAllForUser(nobody, new Date())
        await deps.db.auth.emailVerificationTokens.invalidateAllForUser(nobody, new Date())
      }
    } catch (err) {
      // a failure must not become a 500 — that would answer the question the 200 exists to refuse
      console.error('verify-email resend failed', err instanceof Error ? err.message : String(err))
    }
    return ok
  })

  return app
}
