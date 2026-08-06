import { randomUUID } from 'node:crypto'

import { Hono, type Context } from 'hono'
import { bodyLimit } from 'hono/body-limit'
import type { Redis } from 'ioredis'

import { SignupEmailInUseError, type Db } from '@orbetra/db'
import { signupSchema } from '@orbetra/shared'

import { hashPassword } from '../auth/passwords.js'
import { clientIp } from '../net.js'

/**
 * PUBLIC self-serve signup (F2, item 5/W9): a direct small-fleet customer creates their own tenant +
 * admin user on a 30-day trial — the second unauthenticated write after pilot-request, hardened for
 * the fact that it creates real tenants:
 *  - HONEYPOT: a non-empty `hp_field` gets the SAME 201 shape as success (random id, nothing stored).
 *  - NO ENUMERATION: an email that already has an account gets that same 201 too, and the owner is
 *    told by email instead (audit MED #67) — see the catch at the bottom.
 *  - RATE LIMIT per real client IP + a platform-wide circuit breaker, atomic INCR+EXPIRE, fails CLOSED.
 *  - zod-validated; body size capped here (mounted before the global /v1 limiter).
 *
 * Trial mechanics: tenant gets plan `direct_10`, subscriptionStatus 'trialing' and currentPeriodEnd =
 * now + 30 days (the publicly advertised length). The AUTHORITATIVE entitlement gate (db.tenants.getEntitlements) floors a `trialing`
 * tenant past that instant — no sweep needed, expiry is immediate. Upgrading via Stripe replaces the
 * status through the ordinary webhook path. NO session is returned — the web app sends the user through
 * the normal login (single auth path; signup never mints tokens).
 *
 * Attribution: `ref` resolves via getActiveByCode (EXACT lower(code) match, ACTIVE only) → referredByAffiliateId;
 * an unknown/inactive code attributes to no one and never blocks the signup.
 */
export interface SignupRouteDeps {
  db: Db
  redis: Redis
  getRemoteAddr: (c: unknown) => string
  trustProxy: boolean
  /** per-IP cap + a platform-wide circuit breaker; both fail CLOSED. */
  rateLimit?: { max: number; windowS: number; globalMax?: number }
  /** absolute base for the links in the "you already have an account" mail. Absent ⇒ no mail is
   *  sent (the response is unchanged either way — the 201 is not conditional on the mail). */
  appBaseUrl?: string | undefined
  /** Same worker queue forgot-password uses. Absent ⇒ signup still answers 201; the address owner
   *  simply is not told, which is the pre-existing behaviour minus the oracle. */
  mail?: {
    enqueueSignupExistsEmail(job: { kind: 'signup-exists'; email: string; tenantId: string; locale: string; loginUrl: string; resetUrl: string }): Promise<void>
  }
  /** a signup hit an address that already exists. Bulk probing was previously indistinguishable from
   *  ordinary traffic; a rising rate here is someone walking a list. */
  onEmailInUse?: () => void
}

// 30 days — the publicly advertised trial. The marketing site AND the Terms of Service both state
// "free trials run for 30 days without a card", so the backend must grant exactly that; a shorter
// window would break a contractual promise.
/** Jittered stand-in for a real signup's latency — timing equivalence WITHOUT touching argon2. */
const HONEYPOT_DELAY_MS = 200
const TRIAL_DAYS = 30
const TRIAL_PLAN = 'direct_10' as const

// atomic fixed-window (mirrors pilotRequest): INCR, TTL on first hit, re-arm a stranded key
/**
 * Consumer mailbox providers. A shared one says nothing about a shared identity, so it must not be
 * read as a self-referral — see the guard below. Not exhaustive by design: the list only has to
 * cover what a small reseller in this market plausibly uses as a contact address.
 */
const FREE_MAIL_DOMAINS = new Set([
  'gmail.com', 'googlemail.com', 'yahoo.com', 'yahoo.co.uk', 'outlook.com', 'hotmail.com', 'hotmail.co.uk',
  'live.com', 'msn.com', 'icloud.com', 'me.com', 'mac.com', 'aol.com', 'proton.me', 'protonmail.com',
  'gmx.com', 'gmx.de', 'gmx.net', 'web.de', 't-online.de', 'freenet.de',
  'inbox.lt', 'gmail.lt', 'takas.lt', 'one.lt', 'zebra.lt', 'centras.lt', 'delfi.lt',
  'wp.pl', 'o2.pl', 'onet.pl', 'interia.pl', 'gazeta.pl', 'op.pl', 'poczta.onet.pl',
  'yandex.ru', 'mail.ru', 'seznam.cz', 'zoho.com', 'fastmail.com', 'hushmail.com', 'tutanota.com', 'tuta.io',
])

/**
 * The mailbox an address actually delivers to, for the self-referral equality test.
 *
 * A literal string compare is not enough once the DOMAIN fallback is disabled for free-mail
 * providers: `reseller+anything@gmail.com` and `res.eller@gmail.com` both land in
 * `reseller@gmail.com`, and both were caught by the old domain rule. Without canonicalisation the
 * carve-out would hand a partner a zero-effort way to earn commission on their own subscription —
 * the anti-fraud floor PROJECT_PLAN §6.9 is there for.
 *
 * `+suffix` is stripped everywhere (universal among the providers in the list); dots are stripped
 * only for Google, which is the only one that ignores them.
 */
function canonicalMailbox(raw: string): string {
  const at = raw.trim().toLowerCase().lastIndexOf('@')
  if (at === -1) return raw.trim().toLowerCase()
  const domain = raw.trim().toLowerCase().slice(at + 1)
  let local = raw.trim().toLowerCase().slice(0, at)
  const plus = local.indexOf('+')
  if (plus !== -1) local = local.slice(0, plus)
  if (domain === 'gmail.com' || domain === 'googlemail.com') local = local.replaceAll('.', '')
  return `${local}@${domain}`
}

const RL_SCRIPT = `local n = redis.call('INCR', KEYS[1])
if n == 1 or redis.call('TTL', KEYS[1]) < 0 then redis.call('EXPIRE', KEYS[1], ARGV[1]) end
return n`

export function createSignupRoute(deps: SignupRouteDeps): Hono {
  const app = new Hono()
  const cfg = deps.rateLimit ?? { max: 5, windowS: 3600 }
  const limit = { ...cfg, globalMax: cfg.globalMax ?? Math.max(cfg.max * 40, 200) }
  // tiny payload — cap the unauthenticated POST before it buffers (parity with partner routes)
  app.use('/v1/public/signup', bodyLimit({ maxSize: 64 * 1024 }))

  app.post('/v1/public/signup', async (c: Context) => {
    const parsed = signupSchema.safeParse(await c.req.json().catch(() => null))
    if (!parsed.success) return c.json({ error: 'invalid request' }, 400)
    const body = parsed.data

    // FAIL CLOSED (unlike pilot-request, which fails open because a lost lead is unrecoverable).
    // This route creates a tenant + account + admin user + billing object, and it is the only thing
    // standing between the open internet and mass tenant creation — a Redis blip must not turn it
    // into an unlimited endpoint. A signup the user can simply retry is the cheaper failure.
    // A GLOBAL bucket sits behind the per-IP one as a circuit breaker: a distributed flood spreads
    // across IPs but still has to fit under the platform-wide ceiling, which also protects the
    // shared argon2 semaphore (hashPassword) that login depends on.
    //
    // This runs BEFORE the honeypot branch (audit high): the honeypot also hashes, so while it sat
    // above these buckets it was an unauthenticated, unlimited path straight into the process-wide
    // 8-slot argon2 semaphore that tenant login, password change/reset and partner login all share.
    // Sustained honeypot traffic from one host pinned every slot and queued real logins behind it —
    // a platform-wide authentication outage triggered by setting one JSON field.
    try {
      const ip = clientIp(c.req.header('x-forwarded-for'), deps.getRemoteAddr(c), deps.trustProxy)
      const perIp = (await deps.redis.eval(RL_SCRIPT, 1, `signup:rl:${ip}`, String(limit.windowS))) as number
      if (perIp > limit.max) return c.json({ error: 'rate limited' }, 429)
      const global = (await deps.redis.eval(RL_SCRIPT, 1, 'signup:rl:global', String(limit.windowS))) as number
      if (global > limit.globalMax) return c.json({ error: 'rate limited' }, 429)
    } catch (err) {
      console.error('signup rate-limit unavailable', err)
      return c.json({ error: 'temporarily unavailable' }, 503)
    }

    // HONEYPOT: a fake success indistinguishable from the real thing — same body shape, random id,
    // nothing stored. It still has to SPEND time, because returning instantly would let a bot A/B
    // the trap by timing even though the JSON matches — but it spends it SLEEPING, not hashing.
    // Real argon2 here handed anonymous traffic a free path into the process-wide semaphore that
    // login depends on; the trap only ever needed the latency, never the work (audit high).
    if (body.hp_field !== undefined && body.hp_field !== '') {
      await new Promise((r) => setTimeout(r, HONEYPOT_DELAY_MS * (0.85 + 0.3 * Math.random())))
      return c.json({ ok: true, id: randomUUID() }, 201)
    }

    const email = body.email.trim().toLowerCase()
    // attribution BEFORE the transaction (read-only): active code → affiliate, else none
    const candidate = body.ref !== undefined ? await deps.db.affiliates.getActiveByCode(body.ref) : null
    // SELF-REFERRAL GUARD (PROJECT_PLAN §6.9): a partner must not earn commission on their own
    // subscription. Signing up with an email in the affiliate's own domain drops the attribution —
    // the tenant is still created, it simply earns nobody a commission.
    //
    // Free-mail domains are EXCLUDED from the comparison (audit MED). Matching raw domains meant a
    // partner whose contact address is a gmail.com one lost commission on every gmail.com referral
    // — which for a small reseller is most of them — silently, with only a server-side log to say
    // so. A shared public mailbox provider is not evidence of a shared identity; a company domain
    // is. The exact-address check still catches the literal case it is for.
    const domainOf = (e: string) => e.slice(e.lastIndexOf('@') + 1).toLowerCase()
    const selfReferral =
      candidate !== null &&
      (canonicalMailbox(candidate.email) === canonicalMailbox(email) ||
        (domainOf(candidate.email) === domainOf(email) && !FREE_MAIL_DOMAINS.has(domainOf(email))))
    if (selfReferral) console.warn('signup: self-referral attribution dropped', candidate.code)
    const ref = selfReferral ? null : candidate

    try {
      const created = await deps.db.tenants.createSelfServeSignup({
        tenantName: body.company?.trim() ? body.company.trim() : `${body.name.trim()}'s fleet`,
        accountName: 'My fleet',
        email,
        passwordHash: await hashPassword(body.password),
        plan: TRIAL_PLAN,
        trialEndsAt: new Date(Date.now() + TRIAL_DAYS * 24 * 3_600_000),
        referredByAffiliateId: ref?.id ?? null,
        // the signup form sends the browser's IANA zone; it is the account's REPORTING zone (hard
        // rule 7), not a display preference. Absent ⇒ UTC, the old behaviour, which was only ever
        // right for a customer whose day genuinely starts at 00:00 UTC.
        ...(body.timezone !== undefined ? { timezone: body.timezone } : {}),
      })
      return c.json({ ok: true, id: created.tenantId }, 201)
    } catch (err) {
      if (err instanceof SignupEmailInUseError) {
        // NOT a 409 (audit MED #67). A distinct status here was a platform-wide, unauthenticated
        // account-existence oracle answered in one request with no timing work — in a codebase that
        // burns a dummy argon2 verify on unknown-email login and fabricates a DB write on
        // forgot-password precisely so neither reveals whether an address exists. One status code
        // undid all of it, over the same identity space.
        //
        // The response is now byte-identical to the honeypot's and shaped like a success, and the
        // truth goes out of band to the only party entitled to it: the address's owner. `id` is a
        // random uuid — a real signup returns its tenant id, and the caller cannot tell the
        // difference without already holding the account.
        //
        // The mail is best-effort and deliberately AWAITED-then-swallowed: a queue outage must not
        // turn this back into a distinguishable path (a 500 would be the oracle again, louder).
        deps.onEmailInUse?.()
        if (deps.mail !== undefined && deps.appBaseUrl !== undefined) {
          const base = deps.appBaseUrl.replace(/\/+$/, '')
          try {
            await deps.mail.enqueueSignupExistsEmail({
              kind: 'signup-exists',
              email,
              // the tenant is resolved for BRANDING only, and we deliberately do not look it up: the
              // signup path has no authenticated identity, and a lookup here would reintroduce a
              // timing difference between the taken and free paths. '' ⇒ default Orbetra branding.
              tenantId: '',
              locale: 'en',
              loginUrl: `${base}/login`,
              resetUrl: `${base}/forgot-password`,
            })
          } catch (mailErr) {
            console.error('signup: could not enqueue the account-exists notice', mailErr instanceof Error ? mailErr.message : String(mailErr))
          }
        }
        return c.json({ ok: true, id: randomUUID() }, 201)
      }
      throw err
    }
  })

  return app
}
