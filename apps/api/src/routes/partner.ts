import { createHash, randomBytes } from 'node:crypto'
import { Hono, type Context } from 'hono'
import { bodyLimit } from 'hono/body-limit'
import type { Redis } from 'ioredis'

import type { Db } from '@orbetra/db'
import { dealRegistrationCreateSchema, emailDomain, FREE_MAIL_DOMAINS, partnerLoginSchema, partnerSetPasswordSchema } from '@orbetra/shared'

// one implementation of the lockout primitives for BOTH login surfaces — partner had its own
// byte-identical copies, which is how two surfaces drift apart without anyone noticing
import { count, gateRead, ADMIT_SCRIPT, DECAY_SCRIPT, FAIL_SOURCE_SCRIPT, KNOWN_GOOD_TTL_S, LOCKOUT_SCRIPT as RL_SCRIPT, UNMARKED_ADMIT_EVERY } from '../auth/gates.js'
import { DUMMY_HASH_PROMISE, hashPassword, verifyPassword } from '../auth/passwords.js'
import { problem } from '../auth/middleware.js'
import { mintPartnerToken, verifyPartnerToken } from '../auth/partnerJwt.js'
import { clientIp } from '../net.js'

/**
 * Partner (affiliate) self-service auth + read API (F5). A partner is NOT a tenant user, so this is a
 * fully separate surface: login/set-password are PUBLIC (mounted before the tenant auth guard), and
 * me/commissions are guarded by a partner-only middleware that never touches tenant scope. A partner
 * only ever sees THEIR OWN affiliate row + commissions (scoped by the verified token's subject).
 */
export interface PartnerRouteDeps {
  db: Db
  redis: Redis
  jwtSecret: string
  /** partner access-token TTL (no refresh); default 8h — a low-sensitivity read-only view. */
  partnerTtlS?: number
  /** set/reset-password token lifetime; default 24h (an admin-conveyed invite link). */
  setPwTokenTtlS?: number
  trustProxy: boolean
  getRemoteAddr: (c: unknown) => string
  /** the click counter failed — an unapplied migration or a Redis fault silently zeroes every
   *  partner's funnel, which reads exactly like "nobody clicked" */
  onClickCountFailed?: () => void
  /** Where `/r/<code>` sends a visitor — the PUBLIC SITE, not the app. Absent ⇒ the short link 404s
   *  rather than redirecting somewhere wrong; a marketing link that lands on the wrong host is worse
   *  than one that is not there yet. */
  siteUrl?: string
  /** Login ceilings; each falls back to this module's default. Threaded from env so a partner
   *  locked out during an incident can be freed without a redeploy — the tenant login already
   *  had that and the doc comment claimed parity the operability did not have. */
  loginLimits?: {
    maxFails?: number
    maxFailsPerIp?: number
    maxAttemptsPerIpHard?: number
    maxFailIpsPerEmail?: number
  }
  /** A lockout gate refused a partner login — same counter the tenant login feeds, so the
   *  `auth_lockout_tripped_total` series is not blind to half the authentication surface. */
  onLockout?: (gate: 'credential' | 'ip' | 'email' | 'degraded') => void
}

// the affiliate row shape, derived from the repo (avoids importing @prisma/client — rule 2)
type Affiliate = NonNullable<Awaited<ReturnType<Db['affiliates']['get']>>>
type PartnerEnv = { Variables: { partner: Affiliate } }

const sha256 = (s: string): string => createHash('sha256').update(s).digest('hex')
const DEFAULT_TTL_S = 8 * 3_600
const DEFAULT_SETPW_TTL_S = 24 * 3_600
// Defaults for the same three ceilings the tenant login carries (audit MED) — see the long gate
// note in `auth/login.ts` for why each sits where it does. Overridable per deployment via
// `PartnerRouteDeps.loginLimits`, so a ceiling can be raised during an incident without a redeploy.
const LOGIN_RL_MAX = 10 // per (IP, email) attempts, pre-verify
const LOGIN_RL_MAX_IP = 60 // SOFT: per-IP FAILURES, post-verify — never denies a valid credential
const LOGIN_RL_MAX_ATTEMPTS_IP_HARD = 2_000 // HARD: per-IP ATTEMPTS, pre-verify — the CPU shed
const LOGIN_RL_MAX_FAIL_IPS = 30 // DISTINCT source IPs failing against one partner account
const REDEEM_RL_MAX = 30 // set-password redeem attempts per IP per window
const RL_WINDOW_S = 3_600

/** Partner-only auth guard: a valid `typ:'partner'` token → loads the affiliate and requires it to
 *  still be ACTIVE (review MED — so suspending a partner takes effect immediately, not at token TTL,
 *  and a deleted affiliate can't keep reading). The loaded row is put on the context for reuse. */
function partnerAuth(deps: PartnerRouteDeps) {
  return async (c: Context<PartnerEnv>, next: () => Promise<void>) => {
    const header = c.req.header('authorization') ?? ''
    const token = header.startsWith('Bearer ') ? header.slice(7).trim() : ''
    if (token === '') return problem(c, 401, 'Unauthorized')
    const claims = await verifyPartnerToken(token, deps.jwtSecret)
    if (claims === null) return problem(c, 401, 'Unauthorized')
    const partner = await deps.db.affiliates.get(claims.sub)
    if (partner === null || partner.status !== 'active') return problem(c, 401, 'Unauthorized')
    c.set('partner', partner)
    await next()
  }
}

export function createPartnerRoutes(deps: PartnerRouteDeps): Hono<PartnerEnv> {
  const app = new Hono<PartnerEnv>()
  // tiny bodies (email/token/password) — cap the unauthenticated POSTs so an oversized body can't
  // amplify memory (review LOW: these mount before the global /v1/* limiter, so they need their own)
  app.use('/v1/partner/*', bodyLimit({ maxSize: 64 * 1024 }))
  const ttlS = deps.partnerTtlS ?? DEFAULT_TTL_S
  const ip = (c: Context) => clientIp(c.req.header('x-forwarded-for'), deps.getRemoteAddr(c), deps.trustProxy)

  // ── PUBLIC: login ────────────────────────────────────────────────────────────
  app.post('/v1/partner/login', async (c) => {
    const parsed = partnerLoginSchema.safeParse(await c.req.json().catch(() => null))
    if (!parsed.success) return problem(c, 400, 'Bad Request', 'email and password required')
    const email = parsed.data.email.trim().toLowerCase()
    // Same three gates, same placement rules, as the tenant login — see the long note in
    // `auth/login.ts`. Briefly: the per-credential rule is incremented and gated on one atomic
    // result (a check-then-act gate around argon2 bounds nothing under concurrency); the hard
    // per-IP ATTEMPT ceiling sheds CPU pre-verify and is never refunded; the soft per-IP FAILURE
    // ceiling is post-verify so an office is never denied a valid credential; and the account
    // ceiling counts DISTINCT source IPs, because counting attempts pre-verify would let one host
    // lock a named partner out of the portal and counting them post-verify would bound nothing.
    // Affiliate emails are the most public identifiers on the platform.
    const lim = deps.loginLimits
    const maxCred = lim?.maxFails ?? LOGIN_RL_MAX
    const maxFailsIp = lim?.maxFailsPerIp ?? LOGIN_RL_MAX_IP
    const maxAttemptsIpHard = lim?.maxAttemptsPerIpHard ?? LOGIN_RL_MAX_ATTEMPTS_IP_HARD
    const maxFailIps = lim?.maxFailIpsPerEmail ?? LOGIN_RL_MAX_FAIL_IPS
    const emailHash = sha256(email).slice(0, 16)
    const src = ip(c)
    const lockKey = `partner:fail:${src}:${emailHash}`
    const failIpKey = `partner:fail:ip:${src}`
    const attemptIpKey = `partner:attempt:ip:${src}`
    const emailIpsKey = `partner:fail:ips:${emailHash}`
    const okIpKey = `partner:ok:ip:${src}`
    const w = String(RL_WINDOW_S)
    const tooMany = async (key: string, gate: 'credential' | 'ip' | 'email'): Promise<Response> => {
      deps.onLockout?.(gate)
      const ttl = await deps.redis.ttl(key).catch(() => RL_WINDOW_S)
      c.header('Retry-After', String(Math.max(1, ttl)))
      return problem(c, 429, 'Too Many Attempts', 'try again later')
    }
    // gateRead/count: identical degradation posture to the tenant login — an unevaluable gate
    // fails OPEN, deliberately and metered, rather than 500ing or hanging (see `auth/gates.ts`)
    const pre = await gateRead(deps, () =>
      deps.redis.pipeline().get(attemptIpKey).pfcount(emailIpsKey).get(failIpKey).exists(okIpKey).exec(),
    )
    // `pre === null` = a gate could not be evaluated; skip them all rather than read absent values
    // as zero (which would also invert fail-open for a ceiling configured to 0). See auth/gates.ts.
    if (pre !== null) {
      if (count(pre[0]) >= maxAttemptsIpHard) return tooMany(attemptIpKey, 'ip')
      if (count(pre[1]) >= maxFailIps) return tooMany(emailIpsKey, 'email')
      // soft ceiling on an unmarked bucket: throttled to one in N, never refused outright — a hard
      // refusal is a renewable lockout for everyone on that egress, and this window is an HOUR
      if (count(pre[2]) >= maxFailsIp && count(pre[3]) === 0) {
        const admitted = await gateRead(deps, () =>
          deps.redis
            .pipeline()
            .eval(ADMIT_SCRIPT, 1, `partner:admit:ip:${src}`, String(UNMARKED_ADMIT_EVERY), w)
            .exec(),
        )
        if (admitted !== null && count(admitted[0]) === 0) return tooMany(failIpKey, 'ip')
      }
    }
    const bumped = await gateRead(deps, () =>
      deps.redis.pipeline().eval(RL_SCRIPT, 1, lockKey, w).eval(RL_SCRIPT, 1, attemptIpKey, w).exec(),
    )
    if (bumped !== null) {
      if (count(bumped[0]) > maxCred) return tooMany(lockKey, 'credential')
      if (count(bumped[1]) > maxAttemptsIpHard) return tooMany(attemptIpKey, 'ip')
    }
    const partner = await deps.db.affiliates.findByEmailForAuth(email)
    // constant-ish time: an unknown email / unset password still burns one dummy verify
    const hash = partner?.passwordHash ?? (await DUMMY_HASH_PROMISE)
    const ok = await verifyPassword(hash, parsed.data.password)
    // only an ACTIVE partner with a set password + matching credential may sign in
    if (partner === null || partner.passwordHash === null || !ok || partner.status !== 'active') {
      const failed = await gateRead(deps, () =>
        deps.redis
          .pipeline()
          .eval(RL_SCRIPT, 1, failIpKey, w)
          .eval(FAIL_SOURCE_SCRIPT, 1, emailIpsKey, src, w)
          .exec(),
      )
      if (failed !== null && count(failed[0]) > maxFailsIp) return tooMany(failIpKey, 'ip')
      return problem(c, 401, 'Unauthorized', 'invalid credentials')
    }
    // the per-credential counter is cleared outright; the per-IP FAILURE budget only DECAYS by one,
    // and the ATTEMPT counter is untouched — a refundable volume shed sheds nothing
    await Promise.all([
      deps.redis.del(lockKey).catch(() => undefined),
      deps.redis.eval(DECAY_SCRIPT, 1, failIpKey).catch(() => undefined),
      deps.redis.setex(okIpKey, KNOWN_GOOD_TTL_S, '1').catch(() => undefined),
    ])
    const token = await mintPartnerToken(partner.id, deps.jwtSecret, ttlS)
    c.header('Cache-Control', 'no-store')
    return c.json({ accessToken: token, expiresInS: ttlS })
  })

  // ── PUBLIC: set/reset password via a one-time token ──────────────────────────
  app.post('/v1/partner/set-password', async (c) => {
    if (Number(await deps.redis.eval(RL_SCRIPT, 1, `partner:redeem:${ip(c)}`, String(RL_WINDOW_S))) > REDEEM_RL_MAX) {
      return problem(c, 429, 'Too Many Requests')
    }
    const parsed = partnerSetPasswordSchema.safeParse(await c.req.json().catch(() => null))
    if (!parsed.success) return problem(c, 400, 'Bad Request', 'invalid token or password')
    const now = new Date()
    // hash BEFORE consuming — the token is single-use, so an argon2 overload (503) after the consume
    // would permanently burn the invite link (parity with /v1/auth/reset-password)
    const newHash = await hashPassword(parsed.data.password)
    const affiliateId = await deps.db.affiliates.consumePwToken(sha256(parsed.data.token), now)
    if (affiliateId === null) return problem(c, 400, 'Bad Request', 'invalid or expired token')
    await deps.db.affiliates.setPassword(affiliateId, newHash)
    // burn any sibling outstanding tokens so only the newest link ever worked (review LOW)
    await deps.db.affiliates.invalidatePwTokens(affiliateId, now)
    c.header('Cache-Control', 'no-store')
    return c.json({ ok: true })
  })

  // ── PARTNER-AUTH: the partner's own profile + commissions ────────────────────
  app.get('/v1/partner/me', partnerAuth(deps), (c) => {
    const partner = c.get('partner')
    c.header('Cache-Control', 'no-store')
    // never leak the hash; expose only the partner-facing fields
    return c.json({
      id: partner.id, name: partner.name, email: partner.email, code: partner.code,
      commissionPct: partner.commissionPct.toString(), commissionMonths: partner.commissionMonths,
      // the performance tier, so the portal can say "reach N customers for Y%" instead of leaving a
      // partner to discover their own incentive by accident
      tierPct: partner.tierPct?.toString() ?? null, tierMinCustomers: partner.tierMinCustomers,
      status: partner.status, createdAt: partner.createdAt.toISOString(),
    })
  })

  /**
   * The partner's commission ledger — every line traceable back to a customer and an invoice.
   *
   * This used to return an amount, a status and a raw Stripe invoice id, which is a number a partner
   * can neither check nor dispute: "€90, pending" says nothing about who paid, when, or at what rate.
   * Each row now carries the customer, what THEY paid, the rate applied and the resulting commission,
   * so the arithmetic is visible on the page.
   */
  app.get('/v1/partner/commissions', partnerAuth(deps), async (c) => {
    const rows = await deps.db.affiliates.listCommissionsForPartner(c.get('partner').id)
    c.header('Cache-Control', 'no-store')
    return c.json(rows)
  })

  /**
   * The customers this partner introduced.
   *
   * A partner is entitled to know which of their referrals converted, what those customers pay, and
   * when each earning window closes — that is the deal they signed. They are NOT entitled to anything
   * else about that tenant, so the repo selects the company name, plan and subscription state and
   * nothing further: no users, no devices, no contact details.
   */
  app.get('/v1/partner/customers', partnerAuth(deps), async (c) => {
    const rows = await deps.db.affiliates.listReferredCustomers(c.get('partner').id)
    c.header('Cache-Control', 'no-store')
    return c.json(rows)
  })

  /**
   * Register a prospect — the claim that protects a partner who introduced a fleet in person.
   *
   * Two refusals here rather than at approval time, because both are rules a partner should learn
   * once instead of by having a claim rejected days later:
   *  * a FREE-MAIL domain is never a company, and one approved claim on gmail.com would quietly take
   *    every self-serve signup on the platform;
   *  * a partner's OWN domain is a self-referral, which §6.9 forbids for commissions and which would
   *    be a strange thing to protect them from.
   * Everything else is an admin's judgement, which is what `pending` is for.
   */
  app.post('/v1/partner/deals', partnerAuth(deps), bodyLimit({ maxSize: 16 * 1024 }), async (c) => {
    const partner = c.get('partner')
    const parsed = dealRegistrationCreateSchema.safeParse(await c.req.json().catch(() => null))
    if (!parsed.success) return problem(c, 400, 'Bad Request')
    const { domain } = parsed.data
    if (FREE_MAIL_DOMAINS.has(domain)) return problem(c, 400, 'Bad Request', 'free_mail_domain')
    if (domain === emailDomain(partner.email)) return problem(c, 400, 'Bad Request', 'own_domain')
    // A CAP ON THE OUTSTANDING QUEUE, not on the total. The admin queue is one bounded page ordered
    // pending-first, so a partner filing junk claims could otherwise push every competitor's pending
    // claim off the only screen anyone reviews them on — and nothing ages them out. Once ours are
    // decided, more can be filed.
    if ((await deps.db.affiliates.countPendingDeals(partner.id)) >= MAX_PENDING_DEALS) {
      return problem(c, 429, 'Too Many Requests', 'too_many_pending')
    }
    /**
     * HOUSE ACCOUNT. Registration protects new business; a company already on the platform is not
     * new business, and a domain another partner already serves is not this one's to claim.
     *
     * ONE slug for both, deliberately. Two distinct answers turn this endpoint into a customer-base
     * oracle: any active partner — a reseller, i.e. a competitor in the same market — could walk a
     * domain list and learn precisely which companies are ours and which are a rival's. The refusal
     * is also RATE-LIMITED and AUDIT-LOGGED, because a probe writes no row and spends no queue quota,
     * so without those it is free and invisible. This codebase treats existence oracles as defects
     * elsewhere (audit #67 made signup answer identically on both branches on purpose).
     *
     * NOT re-thrown at approval. The test is a heuristic over email domains and it will be wrong
     * sometimes; an admin who can see a claim is legitimate must be able to say so, which is what
     * the queue is for. The standing is shown on the row instead.
     */
    const probes = (await deps.redis.eval(RL_SCRIPT, 1, `deals:probe:${partner.id}`, String(DEAL_PROBE_WINDOW_S))) as number
    if (probes > DEAL_PROBE_MAX) return problem(c, 429, 'Too Many Requests', 'too_many_pending')
    const standing = await deps.db.affiliates.domainStanding(domain, partner.id)
    if (standing.houseAccounts > 0 || standing.otherPartnerAccounts > 0) {
      console.warn('deal registration refused (house account)', { affiliateId: partner.id, domain })
      return problem(c, 409, 'Conflict', 'not_eligible')
    }
    const row = await deps.db.affiliates.createDeal({
      affiliateId: partner.id,
      company: parsed.data.company,
      domain,
      ...(parsed.data.contactName !== undefined ? { contactName: parsed.data.contactName } : {}),
      ...(parsed.data.contactEmail !== undefined ? { contactEmail: parsed.data.contactEmail } : {}),
      ...(parsed.data.note !== undefined ? { note: parsed.data.note } : {}),
    })
    c.header('Cache-Control', 'no-store')
    return c.json(dealView(row), 201)
  })

  /** A partner's own claims and where each one stands. */
  app.get('/v1/partner/deals', partnerAuth(deps), async (c) => {
    const rows = await deps.db.affiliates.listDealsForPartner(c.get('partner').id)
    c.header('Cache-Control', 'no-store')
    return c.json(rows.map(dealView))
  })

  /** The four funnel stages: how many opened the link, enquired, signed up, and started paying. */
  app.get('/v1/partner/funnel', partnerAuth(deps), async (c) => {
    const partner = c.get('partner')
    c.header('Cache-Control', 'no-store')
    return c.json(await deps.db.affiliates.funnelFor(partner.id, partner.code, new Date()))
  })

  /**
   * The partner's SHORT LINK: `orbetra.com/r/<code>` → the site, with the referral attached.
   *
   * Two things it is not. It does not set the ref cookie: that is a non-essential cookie and the
   * site sets it only after the visitor accepts the notice, so this redirects with `?ref=` and lets
   * the existing consent flow decide. And it does not reveal whether a code exists — an unknown code
   * redirects exactly like a real one, because a public endpoint that answers "is BALTIC25 a real
   * partner?" differently is an enumeration oracle over our partner list.
   *
   * Counting is best-effort by design: a failed count must never cost a visitor the page they asked
   * for. The redirect happens regardless.
   */
  app.get('/r/:code', async (c) => {
    const raw = c.req.param('code')
    const site = deps.siteUrl
    if (site === undefined) return c.notFound()
    const code = SHORT_CODE_RE.test(raw) ? raw : null
    // an invalid code still lands on the site — just without attribution
    const target = code === null ? site : `${site}/?ref=${encodeURIComponent(code)}`

    // REDIRECT FIRST, count after. Two reasons, and the second is the important one:
    //
    //  * a visitor should not wait on two or three Postgres round trips to reach a marketing page;
    //  * doing the lookup before responding made the promise above FALSE. A valid code took a
    //    Redis SET NX and an upsert that an invalid one did not, so the endpoint answered "is
    //    BALTIC25 a real partner?" in milliseconds of latency — and leaked a third state, "valid
    //    and already counted today". Matching status and Location is not enough when the work
    //    differs; the fix is to do the same amount of work before every response, which is none.
    if (code !== null) void countClick(deps, c, code)
    return c.redirect(target, 302)
  })

  return app
}

/**
 * A claim as its OWNER may see it.
 *
 * `reviewedBy` never travels: it is a platform admin's user id, and which of our people approved a
 * claim is our business, not the partner's. Everything else they typed themselves, or has to be
 * readable for the claim to mean anything.
 */
function dealView(d: {
  id: string
  company: string
  domain: string
  contactName: string | null
  contactEmail: string | null
  note: string | null
  status: string
  reason: string | null
  expiresAt: Date | null
  createdAt: Date
}) {
  return {
    id: d.id,
    company: d.company,
    domain: d.domain,
    contactName: d.contactName,
    contactEmail: d.contactEmail,
    note: d.note,
    status: d.status,
    reason: d.reason,
    expiresAt: d.expiresAt?.toISOString() ?? null,
    createdAt: d.createdAt.toISOString(),
  }
}

/**
 * Referral codes, mirroring `affiliateCodeSchema` — NOT apps/site's looser cookie validator.
 *
 * No underscore, deliberately. The server schema forbids it (it is a SQL LIKE wildcard), so `/r/A_B`
 * used to forward `?ref=A_B`, the site would store it in `tc_ref`, and then the pilot form and the
 * signup POST would reject the WHOLE submission — a mistyped short link turning into a silently
 * broken contact form rather than an unattributed one.
 */
const SHORT_CODE_RE = /^[a-zA-Z0-9-]{3,64}$/
/** one visitor, one code, one day */
const CLICK_DEDUPE_TTL_S = 24 * 3600

/**
 * Link-preview fetchers and crawlers, which would otherwise turn one WhatsApp share into a click.
 *
 * Deliberately a substring list and not a allowlist: a false negative costs one inflated click, a
 * false positive silently loses a real visitor from the partner's funnel.
 */
const BOT_UA = /bot|crawl|spider|slurp|preview|fetch|monitor|curl|wget|python-|headless|lighthouse|facebookexternalhit|whatsapp|telegram|discord|skype|slack/i
function isBot(ua: string): boolean {
  return ua === '' || BOT_UA.test(ua)
}

/** How many undecided claims one partner may hold. Generous for a real pipeline, useless for a flood. */
const MAX_PENDING_DEALS = 25

/** A refused registration writes no row and spends no queue quota, so the ATTEMPT is what gets
 *  counted — otherwise walking a domain list past the house-account test is free and leaves no trace. */
const DEAL_PROBE_MAX = 40
const DEAL_PROBE_WINDOW_S = 3600

/** per-IP ceiling on the short link. Generous — it is a marketing URL, not a credential. */
const CLICK_RL_PER_MIN = 120
const CLICK_RL_WINDOW_S = 60

/**
 * Count one unique open — off the response path, so nothing here is observable from outside.
 *
 * This is the only public endpoint in the codebase that WRITES, and it sits in front of a
 * ten-connection pool with no auth. A per-IP ceiling comes first and short-circuits before the
 * lookup: without it one host looping this URL holds every connection and takes tenant login and
 * the Stripe webhook down with it, at no cost to the attacker and with no metric that separates it
 * from popularity.
 */
async function countClick(deps: PartnerRouteDeps, c: Context<PartnerEnv>, code: string): Promise<void> {
  try {
    if (isBot(c.req.header('user-agent') ?? '')) return
    const addr = clientIp(c.req.header('x-forwarded-for'), deps.getRemoteAddr(c), deps.trustProxy)
    const hits = (await deps.redis.eval(RL_SCRIPT, 1, `r:rl:${addr}`, String(CLICK_RL_WINDOW_S))) as number
    if (hits > CLICK_RL_PER_MIN) return
    const affiliate = await deps.db.affiliates.getActiveByCode(code)
    if (affiliate === null) return
    const now = new Date()
    const day = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()))
    // ONE VISITOR PER CODE PER DAY. A partner asking "how many people opened my link" is not helped
    // by a number their own three refreshes inflate. SET NX is the whole mechanism: the first
    // arrival wins the key and gets counted, the rest of the day is free.
    const seen = `aff:click:${affiliate.id}:${sha256(addr).slice(0, 32)}:${day.toISOString().slice(0, 10)}`
    const first = await deps.redis.set(seen, '1', 'EX', CLICK_DEDUPE_TTL_S, 'NX')
    if (first !== null) await deps.db.affiliates.recordClick(affiliate.id, day)
  } catch (err) {
    // A broken counter must not break the link — and it is off the response path anyway. The
    // counter hook is how this becomes visible to US: without it, an unapplied migration makes
    // every partner's funnel read 0 forever, which is indistinguishable from "nobody clicked".
    deps.onClickCountFailed?.()
    console.warn('affiliate click count failed', err instanceof Error ? err.message : String(err))
  }
}

/** Issue a one-time set/reset-password token for a partner (called by the platform_admin route). The
 *  plaintext is returned ONCE for the admin to convey; only its hash is stored. */
export async function issuePartnerSetPwToken(db: Db, affiliateId: string, ttlS = DEFAULT_SETPW_TTL_S): Promise<string> {
  const raw = randomBytes(32).toString('hex')
  // REPLACE, not create: a second link must retire the first, which is what the admin UI promises
  // and what an admin re-minting to revoke a mis-sent link is relying on.
  await db.affiliates.replacePwToken(affiliateId, sha256(raw), new Date(Date.now() + ttlS * 1000), new Date())
  return raw
}
