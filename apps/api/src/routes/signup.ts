import { createHash, randomUUID } from 'node:crypto'

import { Hono, type Context } from 'hono'
import { bodyLimit } from 'hono/body-limit'
import type { Redis } from 'ioredis'

import { SignupEmailInUseError, type Db } from '@orbetra/db'
import { emailDomain, FREE_MAIL_DOMAINS, signupSchema } from '@orbetra/shared'

import { hashPassword } from '../auth/passwords.js'
import { clientIp } from '../net.js'
import { problem } from '../auth/middleware.js'
import { sendVerificationEmail } from './verifyEmail.js'

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
/** over the per-partner notice cap — skipped silently, and NOT an error worth a counter */
class SkipPartnerNotice extends Error {}

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
    /** the ACTIVATION mail for a real signup — the account cannot be signed in to until its link is
     *  clicked, which is what makes the taken and free branches indistinguishable (audit MED #67). */
    enqueueVerifyEmail(job: { kind: 'verify-email'; email: string; tenantId: string; locale: string; verifyUrl: string; expiresHours: number }): Promise<void>
    /** the referral notice — optional, so a deployment without it simply sends no partner mail */
    enqueuePartnerEmail?(job: { kind: 'partner'; event: 'referral' | 'commission' | 'payout-request'; email: string; tenantId: string; locale: string; customer: string; amount?: string; portalUrl: string }): Promise<void>
  }
  /** public site origin — the partner portal link in the referral notice. Absent ⇒ no notice. */
  siteUrl?: string
  /** the referral notice could not be queued — a wedged queue is otherwise indistinguishable from
   *  "no referrals happened", since the send is deliberately silent */
  onPartnerMailFailed?: () => void
  /** a signup hit an address that already exists. Bulk probing was previously indistinguishable from
   *  ordinary traffic; a rising rate here is someone walking a list. */
  onEmailInUse?: () => void
  /** the ACTIVATION mail could not be sent — the customer is stranded and cannot log in, and the
   *  response cannot say so. Non-zero ⇒ page. */
  onVerifyMailFailed?: () => void
  /** the activation path is not wired at all (no mail deps / no APP_BASE_URL) — same consequence,
   *  different cause, and it throws nothing, so it needs its own signal. */
  onVerifyMailUnconfigured?: () => void
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

/** Per-recipient ceiling for the "you already have an account" mail (audit review HIGH). */
const EXISTS_MAIL_MAX = 3
const EXISTS_MAIL_WINDOW_S = 3_600

const sha256 = (s: string): string => createHash('sha256').update(s).digest('hex')

/**
 * Best-effort locale from `Accept-Language`, limited to the four the emails are written in.
 *
 * A header, not a DB lookup: the recipient's stored locale lives on their user row, and reading it
 * here would put a query on the taken path that the free path does not have. The browser that just
 * typed the address is a good proxy, and an unrecognised language falls back to English.
 */
function preferredLocale(header: string | undefined): string {
  if (header === undefined) return 'en'
  for (const part of header.split(',')) {
    const tag = part.split(';')[0]?.trim().toLowerCase().slice(0, 2)
    if (tag === 'lt' || tag === 'de' || tag === 'pl' || tag === 'en') return tag
  }
  return 'en'
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
    if (!parsed.success) return problem(c, 400, 'Bad Request', 'invalid request')
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
      if (perIp > limit.max) return problem(c, 429, 'Too Many Requests', 'rate limited')
      const global = (await deps.redis.eval(RL_SCRIPT, 1, 'signup:rl:global', String(limit.windowS))) as number
      if (global > limit.globalMax) return problem(c, 429, 'Too Many Requests', 'rate limited')
    } catch (err) {
      console.error('signup rate-limit unavailable', err)
      return problem(c, 503, 'Service Unavailable', 'temporarily unavailable')
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
    // one locale for both branches — the taken path must not be distinguishable by the language of
    // a mail the caller never sees, and the real signup should arrive in the language just used
    const locale = preferredLocale(c.req.header('accept-language'))
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
    const selfReferral =
      candidate !== null &&
      (canonicalMailbox(candidate.email) === canonicalMailbox(email) ||
        (emailDomain(candidate.email) === emailDomain(email) && !FREE_MAIL_DOMAINS.has(emailDomain(email))))
    if (selfReferral) console.warn('signup: self-referral attribution dropped', candidate.code)
    const linked = selfReferral ? null : candidate

    /**
     * DEAL REGISTRATION fallback (§6.9) — the case the whole feature exists for.
     *
     * A partner introduces a fleet in person; the fleet later types our address into a browser with
     * no link, no code and no cookie, and the partner earns nothing. An approved, unexpired claim on
     * the signup's email domain attributes it to them.
     *
     * A REFERRAL LINK WINS when one is present. The link is the customer's own action at the moment
     * of signing up, and honouring a third party's standing claim over it would let a claim quietly
     * take a signup another partner actively drove. A claim covers the no-link case, which is the
     * only case anyone complained about.
     *
     * The free-mail rule is enforced at registration, not here — but the guard is repeated because
     * this is where a mistake would be expensive, and one approved gmail.com claim would otherwise
     * take every self-serve signup on the platform.
     */
    let claimed: { id: string } | null = null
    let claimOwner: Awaited<ReturnType<typeof deps.db.affiliates.get>> = null
    if (linked === null) {
      const domain = emailDomain(email)
      if (domain !== '' && !FREE_MAIL_DOMAINS.has(domain)) {
        try {
          const claim = await deps.db.affiliates.claimFor(domain, new Date())
          if (claim !== null) {
            const owner = await deps.db.affiliates.get(claim.affiliateId)
            // THE SAME SELF-REFERRAL FLOOR the link path applies (§6.9). It was missing here, and
            // the omission was self-inflicted: `selfReferral` sets `linked = null`, which is
            // precisely the condition that opens this branch — so the guard's own output routed the
            // request into the unguarded path. A partner whose contact address is a gmail one (which
            // this codebase explicitly expects of small resellers) could claim their own company
            // domain and earn on their own subscription.
            const ownSignup =
              owner !== null &&
              (canonicalMailbox(owner.email) === canonicalMailbox(email) ||
                (emailDomain(owner.email) === domain && !FREE_MAIL_DOMAINS.has(domain)))
            if (ownSignup) console.warn('signup: self-referral via deal claim dropped', claim.id)
            // an inactive partner's claim attributes nothing, exactly as their code would not.
            // `owner` is kept and REUSED below rather than re-fetched: the second read was a TOCTOU
            // that could attribute to a partner suspended in between, or spend a claim for a signup
            // it never earned.
            else if (owner !== null && owner.status === 'active') {
              claimed = { id: claim.id }
              claimOwner = owner
            }
          }
        } catch (claimErr) {
          // attribution is never allowed to block a signup — a customer creating an account must not
          // fail because a partner-facing lookup did
          console.warn('signup: deal claim lookup failed', claimErr instanceof Error ? claimErr.message : String(claimErr))
        }
      }
    }
    const ref = linked ?? claimOwner

    try {
      const created = await deps.db.tenants.createSelfServeSignup({
        tenantName: body.company?.trim() ? body.company.trim() : `${body.name.trim()}'s fleet`,
        accountName: 'My fleet',
        email,
        passwordHash: await hashPassword(body.password),
        plan: TRIAL_PLAN,
        trialEndsAt: new Date(Date.now() + TRIAL_DAYS * 24 * 3_600_000),
        referredByAffiliateId: ref?.id ?? null,
        locale,
        // the signup form sends the browser's IANA zone; it is the account's REPORTING zone (hard
        // rule 7), not a display preference. Absent ⇒ UTC, the old behaviour, which was only ever
        // right for a customer whose day genuinely starts at 00:00 UTC.
        ...(body.timezone !== undefined ? { timezone: body.timezone } : {}),
      })
      // ACTIVATION. The account exists but cannot authenticate until this link is clicked, so a
      // failure to send is not cosmetic — it strands a real customer. It is still swallowed rather
      // than surfaced: a 500 here would be visible ONLY on the free branch, which is precisely the
      // signal this whole design removes. The resend endpoint is the recovery path, and the counter
      // below is how a broken queue becomes visible to us instead of to them.
      try {
        // PER-RECIPIENT cap, exactly like the taken branch's mail — and here it is load-bearing for a
        // second reason. `victim+1@gmail.com`, `victim+2@…` and dot-aliases all deliver to ONE inbox
        // while being distinct addresses to us, so without this the per-IP (5/h) and global (200/h)
        // buckets bound the sender and nothing bounds the recipient: 200 activation mails an hour
        // into one mailbox, from our own SES identity. `canonicalMailbox` is the same normaliser the
        // self-referral guard already uses, so the aliases collapse to the mailbox that receives them.
        const mailKey = `signup:verify:${sha256(canonicalMailbox(email)).slice(0, 16)}`
        const sends = (await deps.redis.eval(RL_SCRIPT, 1, mailKey, String(EXISTS_MAIL_WINDOW_S))) as number
        if (sends <= EXISTS_MAIL_MAX) {
          await sendVerificationEmail(
            { db: deps.db, ...(deps.mail !== undefined ? { mail: deps.mail } : {}), ...(deps.appBaseUrl !== undefined ? { appBaseUrl: deps.appBaseUrl } : {}), ...(deps.onVerifyMailUnconfigured !== undefined ? { onMailUnconfigured: deps.onVerifyMailUnconfigured } : {}) },
            { id: created.userId, tenantId: created.tenantId, email, locale },
          )
        }
      } catch (mailErr) {
        deps.onVerifyMailFailed?.()
        console.error('signup: could not send the activation mail', mailErr instanceof Error ? mailErr.message : String(mailErr))
      }
      // …and close the claim it came from, so the partner's list shows it landed and a second
      // signup from the same domain does not silently re-use a protection that has been spent
      if (claimed !== null) {
        try {
          await deps.db.affiliates.markDealConverted(claimed.id, created.tenantId, new Date())
        } catch (convErr) {
          console.warn('signup: deal claim not marked converted', convErr instanceof Error ? convErr.message : String(convErr))
        }
      }
      // TELL THE PARTNER. A referral used to be invisible to the person who made it: they were
      // handed a link and had to log in on a hunch to find out whether it had worked. Best-effort
      // and swallowed for the same reason as the activation mail above — a failure here must not be
      // observable from outside, or the free branch and the taken branch stop looking identical.
      if (ref !== null && deps.mail?.enqueuePartnerEmail !== undefined && deps.siteUrl !== undefined) {
        try {
          // PER-PARTNER cap, exactly like the two mails above and for the same reason — except the
          // victim here is chosen by the ATTACKER, not by accident. A referral code is the most
          // public identifier a partner owns: 200 signups/hour with `?ref=<their code>` is 200 mails
          // an hour into their inbox from our own SES identity, and 200 junk tenants named with
          // attacker-chosen text in their customer list. Over the cap the mail is skipped; the
          // response is unconditional either way.
          const refKey = `signup:refnotice:${sha256(ref.id).slice(0, 16)}`
          const notices = (await deps.redis.eval(RL_SCRIPT, 1, refKey, String(EXISTS_MAIL_WINDOW_S))) as number
          if (notices > EXISTS_MAIL_MAX) throw new SkipPartnerNotice()
          await deps.mail.enqueuePartnerEmail({
            kind: 'partner',
            event: 'referral',
            email: ref.email,
            tenantId: '', // platform-branded; see the job's doc comment
            locale: ref.locale, // the PARTNER's language — not the customer's browser
            customer: body.company?.trim() ? body.company.trim() : `${body.name.trim()}'s fleet`,
            portalUrl: `${deps.siteUrl.replace(/\/+$/, '')}/partner/dashboard`,
          })
        } catch (notifyErr) {
          if (!(notifyErr instanceof SkipPartnerNotice)) {
            deps.onPartnerMailFailed?.()
            console.warn('signup: partner referral notice not queued', notifyErr instanceof Error ? notifyErr.message : String(notifyErr))
          }
        }
      }
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
            // PER-RECIPIENT cap, IP-INDEPENDENT — the same guard forgot-password carries, for the
            // same reason. The per-IP (5/h) and global (200/h) signup buckets bound the attacker's
            // rate but not the VICTIM's inbox: 40 IPs is 200 mails/hour at one address, from our own
            // SES identity, which the recipient marks as spam. Keyed on the address, so rotating
            // hosts does not multiply it. Over the cap the mail is skipped and the response is
            // byte-identical — silence must never be observable from outside.
            const key = `signup:exists:${sha256(email).slice(0, 16)}`
            const n = (await deps.redis.eval(RL_SCRIPT, 1, key, String(EXISTS_MAIL_WINDOW_S))) as number
            if (n <= EXISTS_MAIL_MAX) {
              await deps.mail.enqueueSignupExistsEmail({
                kind: 'signup-exists',
                email,
                // resolved in the WORKER, not here: this route has no authenticated identity, and a
                // tenant lookup on the request path would add a measurable step the free path does
                // not have. The worker is already off the request path, so it can find the tenant by
                // address and render the message in that tenant's branding — a white-label TSP's end
                // user must not receive an Orbetra-branded mail naming their supplier.
                tenantId: '',
                locale,
                loginUrl: `${base}/login?lng=${encodeURIComponent(locale)}`,
                resetUrl: `${base}/forgot-password?lng=${encodeURIComponent(locale)}`,
              })
            }
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
