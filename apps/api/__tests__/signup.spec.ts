import { execFileSync } from 'node:child_process'
import { createServer } from 'node:http'
import { resolve } from 'node:path'
import { createHash, randomBytes, randomUUID } from 'node:crypto'

import { serve } from '@hono/node-server'
import { Redis } from 'ioredis'
import { GenericContainer, Wait, type StartedTestContainer } from 'testcontainers'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { createDb, type Db } from '@orbetra/db'

import { seedUser } from '../../../packages/db/seed/users.js'
import { createApp } from '../src/app.js'
import { mintTestToken, TEST_JWT_SECRET } from './helpers/auth.js'


/**
 * PUBLIC self-serve signup (F2). Proves: a direct customer creates a trial tenant + tenant-admin user
 * and can immediately LOG IN through the normal auth path; the trial floors at expiry via the
 * authoritative entitlement gate; a duplicate email answers with the SAME 201 as a real signup, so
 * the response is not an account-existence oracle (audit MED #67); the honeypot fakes success; an
 * active ?ref attributes the new tenant while an unknown ref never blocks; the tenant is isolated.
 */
const PG_IMAGE = 'timescale/timescaledb-ha:pg16'
const DB_PKG = resolve(import.meta.dirname, '../../../packages/db')

let pg: StartedTestContainer
let redisC: StartedTestContainer
let redis: Redis
let redisSub: Redis
let db: Db
let databaseUrl: string
let port: number
let httpServer: ReturnType<typeof createServer>
let platformToken: string
/** signup-exists mails the route enqueued, and how many times the in-use counter fired. */
const sentMail: { kind: string; email: string; loginUrl: string; resetUrl: string }[] = []
/** activation mails the route enqueued — the link is the only way a signup becomes usable. */
const sentVerify: { kind: string; email: string; verifyUrl: string; expiresHours: number }[] = []
const sentPartner: { event: string; email: string; customer: string; locale: string }[] = []
let emailInUseCount = 0

const base = () => `http://127.0.0.1:${port}`
const j = (path: string, method = 'GET', bodyObj?: unknown, headers: Record<string, string> = {}) =>
  fetch(`${base()}${path}`, {
    method,
    headers: { 'content-type': 'application/json', ...headers },
    ...(bodyObj !== undefined ? { body: JSON.stringify(bodyObj) } : {}),
  })
const signup = (body: unknown) => j('/v1/public/signup', 'POST', body)
const login = (email: string, password: string) => j('/v1/auth/login', 'POST', { email, password })

beforeAll(async () => {
  ;[pg, redisC] = await Promise.all([
    new GenericContainer(PG_IMAGE)
      .withEnvironment({ POSTGRES_PASSWORD: 'test', POSTGRES_DB: 'orbetra' })
      .withExposedPorts(5432)
      .withWaitStrategy(Wait.forLogMessage(/database system is ready to accept connections/, 2))
      .withStartupTimeout(240_000)
      .start(),
    new GenericContainer('redis:7-alpine').withExposedPorts(6379).withWaitStrategy(Wait.forLogMessage(/Ready to accept connections/)).start(),
  ])
  databaseUrl = `postgresql://postgres:test@${pg.getHost()}:${pg.getMappedPort(5432)}/orbetra`
  execFileSync('pnpm', ['exec', 'prisma', 'migrate', 'deploy'], { cwd: DB_PKG, env: { ...process.env, DATABASE_URL: databaseUrl } })
  const opts = { maxRetriesPerRequest: null }
  redis = new Redis(redisC.getMappedPort(6379), redisC.getHost(), opts)
  redisSub = new Redis(redisC.getMappedPort(6379), redisC.getHost(), opts)
  db = createDb(databaseUrl)
  const seeded = await seedUser({ databaseUrl, email: 'pa@x.test', password: 'password12', role: 'platform_admin', tenantName: 'PlatCo' })
  platformToken = await mintTestToken({ userId: seeded.userId, tenantId: seeded.tenantId, role: 'platform_admin' })

  const app = createApp({
    redis, redisSub, db,
    jwtSecret: TEST_JWT_SECRET, jwtTtlS: 900, refreshTtlS: 3600, ticketTtlS: 30,
    lockout: { maxFails: 100, windowS: 900 }, secureCookies: false, trustProxy: false,
    getRemoteAddr: () => '127.0.0.1',
    signupRateLimit: { max: 100, windowS: 3600 }, // the suite performs >5 signups from one IP
    appBaseUrl: 'https://app.orbetra.test',
    mail: {
      enqueueResetEmail: () => Promise.resolve(),
      enqueueSignupExistsEmail: (job) => { sentMail.push(job); return Promise.resolve() },
      enqueueVerifyEmail: (job) => { sentVerify.push(job); return Promise.resolve() },
      enqueuePartnerEmail: (job) => { sentPartner.push(job); return Promise.resolve() },
    },
    siteUrl: 'https://site.example',
    onSignupEmailInUse: () => { emailInUseCount++ },
  })
  httpServer = serve({ fetch: app.fetch, port: 0, createServer }) as ReturnType<typeof createServer>
  port = await new Promise<number>((r) => httpServer.on('listening', () => r((httpServer.address() as { port: number }).port)))
}, 300_000)

afterAll(async () => {
  httpServer?.closeAllConnections?.()
  await new Promise<void>((r) => httpServer.close(() => r()))
  await db.$disconnect()
  await redis.quit()
  await redisSub.quit()
  await Promise.all([pg.stop(), redisC.stop()])
})

describe('public self-serve signup (F2)', () => {
  it('creates a trial tenant + admin who can immediately log in via the NORMAL auth path', async () => {
    const res = await signup({ name: 'Jonas', email: 'jonas@fleet.test', password: 'password12', company: 'Jonas Logistics' })
    expect(res.status).toBe(201)
    const { id } = (await res.json()) as { id: string }
    // the tenant exists on the trial plan, trialing, with a future window
    const tenant = await db.tenants.get(id)
    expect(tenant).toMatchObject({ name: 'Jonas Logistics', plan: 'direct_10', subscriptionStatus: 'trialing' })
    // the trial window must match the PUBLIC promise (site copy + Terms of Service say 30 days) —
    // a drift here would break a contractual claim, so assert the length, not just "in the future"
    const days = (tenant!.currentPeriodEnd!.getTime() - Date.now()) / 86_400_000
    expect(days).toBeGreaterThan(29.5)
    expect(days).toBeLessThan(30.5)
    // trial entitlements: direct matrix (deviceLimit 10, no white-label)
    const ents = await db.tenants.getEntitlements(id)
    expect(ents).toMatchObject({ deviceLimit: 10, whiteLabel: false, apiAccess: false })
    // …but the account CANNOT log in yet: the address has not been proven, and until it is, the
    // right password is refused exactly like a wrong one (audit MED #67). This is the whole reason
    // the taken and free branches of signup are indistinguishable.
    expect((await login('jonas@fleet.test', 'password12')).status).toBe(401)

    // the activation mail went out with a single-use link…
    const mail = sentVerify.find((m) => m.email === 'jonas@fleet.test')
    expect(mail).toMatchObject({ kind: 'verify-email', expiresHours: 48 })
    const token = new URL(mail!.verifyUrl).searchParams.get('token')!
    expect(token).toMatch(/^[0-9a-f]{64}$/) // 32 bytes of CSPRNG, hex

    // …and after clicking it, the ORDINARY login works (verification mints no session of its own)
    expect((await j('/v1/public/verify-email', 'POST', { token })).status).toBe(200)
    const session = await login('jonas@fleet.test', 'password12')
    expect(session.status).toBe(200)
    const bodyJson = (await session.json()) as { user: { role: string; tenantId: string; accountId: string | null } }
    expect(bodyJson.user).toMatchObject({ role: 'tsp_admin', tenantId: id, accountId: null })

    // the link is SINGLE-USE — a second click (a mail scanner, a forwarded message) is refused
    expect((await j('/v1/public/verify-email', 'POST', { token })).status).toBe(400)
  })

  it('the login answer for an UNVERIFIED account is byte-identical to a wrong password', async () => {
    // this is the property that closes the oracle: signup(taken) and signup(free) both 201, and the
    // follow-up login — the second request that used to answer the question — is the same 401 either
    // way. Anything distinguishable here (status, body, or a lockout increment that shows up later
    // as a 429) hands the answer back for the price of one extra request.
    await signup({ name: 'Unv', email: 'unverified@fleet.test', password: 'password12' })
    const unverified = await login('unverified@fleet.test', 'password12') // RIGHT password, unproven address
    const wrongPassword = await login('unverified@fleet.test', 'totally-wrong-pw')
    const unknownAddress = await login('nobody-at-all@fleet.test', 'password12')
    expect([unverified.status, wrongPassword.status, unknownAddress.status]).toEqual([401, 401, 401])
    const bodies = await Promise.all([unverified.text(), wrongPassword.text(), unknownAddress.text()])
    expect(new Set(bodies).size).toBe(1)
  })

  it('a resend issues a NEW link and burns the old one', async () => {
    await signup({ name: 'Re', email: 'resend@fleet.test', password: 'password12' })
    const first = new URL(sentVerify.find((m) => m.email === 'resend@fleet.test')!.verifyUrl).searchParams.get('token')!
    expect((await j('/v1/public/verify-email/resend', 'POST', { email: 'resend@fleet.test' })).status).toBe(200)
    const mails = sentVerify.filter((m) => m.email === 'resend@fleet.test')
    expect(mails).toHaveLength(2)
    const second = new URL(mails[1]!.verifyUrl).searchParams.get('token')!
    expect(second).not.toBe(first)
    // only the NEWEST link works — a user who clicks an older mail gets a clean failure instead of
    // a silent success on a token they thought they had replaced
    expect((await j('/v1/public/verify-email', 'POST', { token: first })).status).toBe(400)
    expect((await j('/v1/public/verify-email', 'POST', { token: second })).status).toBe(200)
  })

  it('resend answers 200 for an unknown and an already-verified address alike, and sends nothing', async () => {
    const before = sentVerify.length
    expect((await j('/v1/public/verify-email/resend', 'POST', { email: 'no-such-person@fleet.test' })).status).toBe(200)
    expect((await j('/v1/public/verify-email/resend', 'POST', { email: 'jonas@fleet.test' })).status).toBe(200) // already verified above
    expect((await j('/v1/public/verify-email/resend', 'POST', { email: 'not an address' })).status).toBe(200)
    expect(sentVerify.length).toBe(before)
  })

  it('an ADMIN-created user can log in immediately — verification is only for the public route', async () => {
    // the single line that stops every admin-invited colleague being permanently locked out
    // (`users.create` sets emailVerifiedAt) was covered by NOTHING: removing it left 117 tests green.
    // This is the whole tenant-onboarding flow in three lines.
    const owner = await signupActivated({ name: 'Owner', email: 'owner@invite.test', password: 'password12' })
    const { id: tenantId } = (await owner.json()) as { id: string }
    const token = (await (await login('owner@invite.test', 'password12')).json()) as { accessToken: string }
    const created = await fetch(`http://127.0.0.1:${port}/v1/users`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${token.accessToken}` },
      body: JSON.stringify({ email: 'colleague@invite.test', password: 'password12', role: 'viewer', accountId: null }),
    })
    expect(created.status, await created.text()).toBe(201)
    expect(tenantId).toBeTruthy()
    expect((await login('colleague@invite.test', 'password12')).status).toBe(200)
  })

  it('a PASSWORD RESET also proves the address — the recovery route we signpost is not a dead end', async () => {
    // the "you already have an account" mail says "sign in, or reset your password". For the exact
    // case that mail exists for — an address squatted by someone else's unverified signup — resetting
    // used to succeed and then login still 401'd, with no explanation anywhere.
    await signup({ name: 'Squat', email: 'squatted@fleet.test', password: 'attacker-chose-this' })
    expect((await login('squatted@fleet.test', 'attacker-chose-this')).status).toBe(401) // unverified

    const [user] = await db.auth.users.findByEmailAllTenants('squatted@fleet.test')
    const raw = randomBytes(32).toString('hex')
    await db.auth.passwordResetTokens.create({
      id: randomUUID(),
      userId: user!.id,
      tokenHash: createHash('sha256').update(raw).digest('hex'),
      expiresAt: new Date(Date.now() + 3_600_000),
    })
    expect((await j('/v1/auth/reset-password', 'POST', { token: raw, newPassword: 'the-real-owner-pw' })).status).toBe(200)
    // …and the address is now proven, so the account works
    expect((await login('squatted@fleet.test', 'the-real-owner-pw')).status).toBe(200)
  })

  it('the ACTIVATION mail is capped per RECIPIENT, and plus-aliases do not multiply it', async () => {
    // per-IP and global buckets bound the SENDER; `victim+1@`, `victim+2@` … all deliver to one inbox
    const before = sentVerify.length
    for (let i = 0; i < 6; i++) {
      await signup({ name: `Alias ${i}`, email: `bomb+${i}@fleet.test`, password: 'password12' })
    }
    // 3/hour on the canonical mailbox — the tenants are still created, only the mail is withheld
    expect(sentVerify.length - before).toBe(3)
  })

  it('a garbage token is a clean 400, never a 500', async () => {
    for (const token of ['', 'short', 'x'.repeat(64), 'x'.repeat(500), '0'.repeat(64)]) {
      expect((await j('/v1/public/verify-email', 'POST', { token })).status, JSON.stringify(token.slice(0, 12))).toBe(400)
    }
    expect((await j('/v1/public/verify-email', 'POST', {})).status).toBe(400)
  })

  /**
   * Activate an account created OUTSIDE the route (the repo path in the cases below), by minting and
   * consuming a real token — the same code the link runs, so these tests cannot pass on a shortcut
   * the product does not have.
   */
  const activateByEmail = async (email: string): Promise<void> => {
    const [user] = await db.auth.users.findByEmailAllTenants(email)
    if (user === undefined) return
    const raw = randomBytes(32).toString('hex')
    await db.auth.emailVerificationTokens.create({
      id: randomUUID(),
      userId: user.id,
      tokenHash: createHash('sha256').update(raw).digest('hex'),
      expiresAt: new Date(Date.now() + 3_600_000),
    })
    await db.auth.emailVerificationTokens.consume(createHash('sha256').update(raw).digest('hex'), new Date())
  }

  /** Sign up AND activate, for the cases that are not about verification itself. */
  const signupActivated = async (body: { name: string; email: string; password: string; company?: string; ref?: string }): Promise<Response> => {
    const res = await signup(body)
    const mail = sentVerify.find((m) => m.email === body.email.trim().toLowerCase())
    if (mail !== undefined) {
      const token = new URL(mail.verifyUrl).searchParams.get('token')
      if (token !== null) await j('/v1/public/verify-email', 'POST', { token })
    }
    return res
  }

  it('an EXPIRED trial floors at the authoritative gate (no sweep needed)', async () => {
    const fresh = await signup({ name: 'Rasa', email: 'rasa@fleet.test', password: 'password12' })
    const { id } = (await fresh.json()) as { id: string }
    // an already-past trial window, created through the same repo API (simulates day 15)
    const past = await db.tenants.createSelfServeSignup({
      tenantName: 'Expired Co', accountName: 'My fleet', email: 'expired@fleet.test',
      passwordHash: 'x', plan: 'direct_10', trialEndsAt: new Date(Date.now() - 1000), referredByAffiliateId: null,
    })
    expect((await db.tenants.getEntitlements(past.tenantId)).deviceLimit).toBe(0) // floored — expired trial keeps nothing
    // while the fresh (unexpired) one keeps its plan matrix
    expect((await db.tenants.getEntitlements(id)).deviceLimit).toBe(10)
  })

  it('the SESSION hint is trial-aware — an expired trial never advertises what the server would 403', async () => {
    // a tenant whose trial has already elapsed, created through the repo, with a real login password
    const pw = 'password12'
    const hashed = (await (await signupActivated({ name: 'Hint', email: 'hint-live@fleet.test', password: pw })).json()) as { id: string }
    void hashed
    // reuse the live signup path for the UNEXPIRED case, and drive the expired case through login on a
    // tenant created with a past window (same argon2 hash as the live user so login succeeds)
    const liveUser = await db.auth.users.findByEmailAllTenants('hint-live@fleet.test')
    const expired = await db.tenants.createSelfServeSignup({
      tenantName: 'Hint Expired', accountName: 'My fleet', email: 'hint-expired@fleet.test',
      passwordHash: liveUser[0]!.passwordHash, plan: 'direct_10',
      trialEndsAt: new Date(Date.now() - 1000), referredByAffiliateId: null,
    })
    void expired
    await activateByEmail('hint-expired@fleet.test') // created through the repo, so it has no link
    const liveSession = (await (await login('hint-live@fleet.test', pw)).json()) as { user: { entitlements: { deviceLimit: number } } }
    const deadSession = (await (await login('hint-expired@fleet.test', pw)).json()) as { user: { entitlements: { deviceLimit: number } } }
    expect(liveSession.user.entitlements.deviceLimit).toBe(10) // in-trial → plan matrix
    expect(deadSession.user.entitlements.deviceLimit).toBe(0) // expired → floored, matching the server gate
  })

  it('a duplicate email is INDISTINGUISHABLE from a real signup — no enumeration oracle', async () => {
    // The 409 this replaces was a platform-wide account-existence oracle answered in one
    // unauthenticated request, in a codebase that burns a dummy argon2 verify on unknown-email login
    // and fabricates a DB write on forgot-password so neither reveals whether an address exists
    // (audit MED #67). The response must now be shaped exactly like a success.
    sentMail.length = 0
    emailInUseCount = 0
    const first = await signupActivated({ name: 'Dup', email: 'dup@fleet.test', password: 'password12' })
    const second = await signup({ name: 'Dup2', email: 'dup@fleet.test', password: 'password12' })
    expect(second.status).toBe(first.status) // 201, same as the real one
    const body = (await second.json()) as { ok: boolean; id: string }
    expect(body.ok).toBe(true)
    expect(body.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/) // a uuid, like a real tenant id
    // …and it created NOTHING: the original account still owns the address with its original password
    expect((await login('dup@fleet.test', 'password12')).status).toBe(200)

    // a pre-existing seeded user email behaves identically
    expect((await signup({ name: 'X', email: 'pa@x.test', password: 'password12' })).status).toBe(201)

    // the truth went out of band, to the address's owner, with no token and nothing the attempt supplied
    expect(sentMail.map((m) => m.email)).toEqual(['dup@fleet.test', 'pa@x.test'])
    // `?lng` carries the reader's language across the origin hop: the mail is written in it and the
    // page it opens used to re-guess from the browser, so an English reader landed on a Lithuanian
    // login screen
    expect(sentMail[0]).toMatchObject({
      kind: 'signup-exists',
      loginUrl: 'https://app.orbetra.test/login?lng=en',
      resetUrl: 'https://app.orbetra.test/forgot-password?lng=en',
    })
    // …and it is counted, because the response no longer is
    expect(emailInUseCount).toBe(2)
  })

  it('a mail-queue outage does NOT reopen the oracle — the response is unchanged', async () => {
    // a 500 here would be the same oracle, louder
    sentMail.length = 0
    const broken = createApp({
      redis, redisSub, db,
      jwtSecret: TEST_JWT_SECRET, jwtTtlS: 900, refreshTtlS: 3600, ticketTtlS: 30,
      lockout: { maxFails: 100, windowS: 900 }, secureCookies: false, trustProxy: false,
      getRemoteAddr: () => '127.0.0.1',
      signupRateLimit: { max: 100, windowS: 3600 },
      appBaseUrl: 'https://app.orbetra.test',
      mail: { enqueueResetEmail: () => Promise.resolve(), enqueueSignupExistsEmail: () => Promise.reject(new Error('redis down')) },
    })
    const srv = serve({ fetch: broken.fetch, port: 0, createServer }) as ReturnType<typeof createServer>
    const p = await new Promise<number>((r) => srv.on('listening', () => r((srv.address() as { port: number }).port)))
    try {
      const res = await fetch(`http://127.0.0.1:${p}/v1/public/signup`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: 'Dup3', email: 'dup@fleet.test', password: 'password12' }),
      })
      expect(res.status).toBe(201)
    } finally {
      srv.closeAllConnections?.()
      await new Promise<void>((r) => srv.close(() => r()))
    }
  })

  it('honeypot gets a FAKE 201 and stores nothing', async () => {
    const res = await signup({ name: 'Bot', email: 'bot@spam.test', password: 'password12', hp_field: 'gotcha' })
    expect(res.status).toBe(201)
    expect((await login('bot@spam.test', 'password12')).status).toBe(401) // nothing was created
  })

  it('the honeypot is rate-limited too — it must not be a free path into the argon2 semaphore', async () => {
    // REGRESSION (audit high): the honeypot branch (which HASHES) sat ABOVE the per-IP and global
    // buckets, so setting one JSON field bought unlimited, unauthenticated access to the process-wide
    // 8-slot argon2 semaphore that tenant login, password change/reset and partner login all share.
    // Sustained traffic pinned every slot and queued real logins behind it — an authentication
    // outage from an endpoint that was never supposed to do work at all.
    const tightApp = createApp({
      redis, redisSub, db,
      jwtSecret: TEST_JWT_SECRET, jwtTtlS: 900, refreshTtlS: 3600, ticketTtlS: 30,
      lockout: { maxFails: 100, windowS: 900 }, secureCookies: false, trustProxy: false,
      getRemoteAddr: () => '127.0.0.2',
      signupRateLimit: { max: 2, windowS: 3600 },
    })
    await redis.del('signup:rl:127.0.0.2', 'signup:rl:global')
    const bot = () =>
      tightApp.request('/v1/public/signup', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: 'Bot', email: 'bot2@spam.test', password: 'password12', hp_field: 'gotcha' }),
      })
    expect((await bot()).status).toBe(201) // still a convincing fake success…
    expect((await bot()).status).toBe(201)
    expect((await bot()).status).toBe(429) // …but it spends the same budget a real signup does
  })

  it('an ACTIVE ?ref attributes the tenant; an unknown ref never blocks', async () => {
    const actor = { userId: '00000000-0000-0000-0000-0000000000f2' }
    const aff = await db.affiliates.create(actor, { name: 'Signup Partner', email: 'sp@partner.co', code: 'SIGNUP1' })
    await db.affiliates.update(actor, aff.id, { status: 'active' })
    const attributed = await signup({ name: 'Ref', email: 'ref@fleet.test', password: 'password12', ref: 'signup1' }) // case-insensitive
    const { id } = (await attributed.json()) as { id: string }
    expect((await db.tenants.get(id))!.referredByAffiliateId).toBe(aff.id)
    // unknown code → created, unattributed
    const unknown = await signup({ name: 'NoRef', email: 'noref@fleet.test', password: 'password12', ref: 'NOSUCH1' })
    expect(unknown.status).toBe(201)
    const u = (await unknown.json()) as { id: string }
    expect((await db.tenants.get(u.id))!.referredByAffiliateId).toBeNull()
  })

  it('tells the PARTNER a referral arrived, in their language — and never for a self-referral', async () => {
    const actor = { userId: '00000000-0000-0000-0000-0000000000f2' }
    sentPartner.length = 0
    const aff = await db.affiliates.create(actor, { name: 'Notified Ltd', email: 'notice@partnerco.test', code: 'NOTICE1' })
    await db.affiliates.update(actor, aff.id, { status: 'active', locale: 'lt' })

    await signup({ name: 'Buyer', email: 'buyer@somefleet.test', password: 'password12', company: 'Some Fleet UAB', ref: 'NOTICE1' })
    expect(sentPartner).toHaveLength(1)
    expect(sentPartner[0]).toMatchObject({ event: 'referral', email: 'notice@partnerco.test', customer: 'Some Fleet UAB', locale: 'lt' })

    // a SELF-referral is dropped before attribution, so there is nothing to announce — telling a
    // partner they earned a referral we then refuse to attribute is worse than saying nothing
    await signup({ name: 'Owner', email: 'boss@partnerco.test', password: 'password12', ref: 'NOTICE1' })
    expect(sentPartner).toHaveLength(1)

    // …and the notice is capped PER PARTNER: their code is public, so 200 junk signups an hour with
    // it would otherwise be 200 mails an hour into their inbox from our own sending identity
    for (let i = 0; i < 6; i++) {
      await signup({ name: `Flood${i}`, email: `flood${i}@elsewhere.test`, password: 'password12', ref: 'NOTICE1' })
    }
    expect(sentPartner.length).toBeLessThanOrEqual(3)
  })

  it('an approved DEAL REGISTRATION attributes a link-less signup; a referral link still wins', async () => {
    const actor = { userId: '00000000-0000-0000-0000-0000000000f2' }
    const claimer = await db.affiliates.create(actor, { name: 'Claimer Ltd', email: 'c@claimerco.test', code: 'CLAIMER1' })
    const linker = await db.affiliates.create(actor, { name: 'Linker Ltd', email: 'l@linkerco.test', code: 'LINKER1' })
    await db.affiliates.update(actor, claimer.id, { status: 'active' })
    await db.affiliates.update(actor, linker.id, { status: 'active' })
    const approve = async (affiliateId: string, domain: string) => {
      const d = await db.affiliates.createDeal({ affiliateId, company: domain, domain })
      await db.affiliates.decideDeal(actor, d.id, 'approved', undefined, new Date())
      return d
    }

    // THE CASE THE FEATURE EXISTS FOR: no ref, no cookie, no link — the customer typed our address
    const claim = await approve(claimer.id, 'protectedco.test')
    const direct = (await (await signup({ name: 'Direct', email: 'ops@protectedco.test', password: 'password12' })).json()) as { id: string }
    expect((await db.tenants.get(direct.id))!.referredByAffiliateId).toBe(claimer.id)
    // …and the claim is spent, so a second signup from that domain does not re-use it
    const after = (await db.affiliates.listDealsForPartner(claimer.id)).find((d) => d.id === claim.id)
    expect(after?.status).toBe('converted')
    expect(after?.convertedTenantId).toBe(direct.id)

    // A LINK WINS over someone else's standing claim: the link is the customer's own action at the
    // moment of signing up, and a claim must never quietly take a signup another partner drove.
    await approve(claimer.id, 'contested.test')
    const viaLink = (await (await signup({ name: 'Linked', email: 'ops@contested.test', password: 'password12', ref: 'LINKER1' })).json()) as { id: string }
    expect((await db.tenants.get(viaLink.id))!.referredByAffiliateId).toBe(linker.id)

    // a PENDING claim attributes nothing — approval is the whole control
    await db.affiliates.createDeal({ affiliateId: claimer.id, company: 'Pending Co', domain: 'pendingco.test' })
    const unapproved = (await (await signup({ name: 'Pending', email: 'ops@pendingco.test', password: 'password12' })).json()) as { id: string }
    expect((await db.tenants.get(unapproved.id))!.referredByAffiliateId).toBeNull()

    // an EXPIRED claim attributes nothing either — expiry is derived at read time, not swept
    const stale = await approve(claimer.id, 'staleco.test')
    await db.affiliates.decideDeal(actor, stale.id, 'approved', undefined, new Date()) // already decided → no-op
    await db.affiliates.setDealExpiry(stale.id, new Date(Date.now() - 86_400_000))
    const expired = (await (await signup({ name: 'Stale', email: 'ops@staleco.test', password: 'password12' })).json()) as { id: string }
    expect((await db.tenants.get(expired.id))!.referredByAffiliateId).toBeNull()

    // a SUSPENDED partner's claim attributes nothing, exactly as their code would not
    await approve(claimer.id, 'suspendedclaim.test')
    await db.affiliates.update(actor, claimer.id, { status: 'suspended' })
    const susp = (await (await signup({ name: 'Susp', email: 'ops@suspendedclaim.test', password: 'password12' })).json()) as { id: string }
    expect((await db.tenants.get(susp.id))!.referredByAffiliateId).toBeNull()
  })

  it('drops SELF-REFERRAL attribution — a partner cannot earn commission on their own signup (§6.9)', async () => {
    const actor = { userId: '00000000-0000-0000-0000-0000000000f2' }
    const aff = await db.affiliates.create(actor, { name: 'Selfie Ltd', email: 'owner@selfie-fleet.test', code: 'SELFIE1' })
    await db.affiliates.update(actor, aff.id, { status: 'active' })
    // same email DOMAIN as the affiliate ⇒ attribution dropped, but the signup still succeeds
    const selfRes = await signup({ name: 'Owner', email: 'billing@selfie-fleet.test', password: 'password12', ref: 'SELFIE1' })
    expect(selfRes.status).toBe(201)
    const self = (await selfRes.json()) as { id: string }
    expect((await db.tenants.get(self.id))!.referredByAffiliateId).toBeNull()
    // an unrelated domain with the same code still attributes normally
    const other = (await (await signup({ name: 'Real', email: 'real@othercorp.test', password: 'password12', ref: 'SELFIE1' })).json()) as { id: string }
    expect((await db.tenants.get(other.id))!.referredByAffiliateId).toBe(aff.id)
  })

  it('rate-limits per IP (429) and FAILS CLOSED when Redis is unavailable (503, never unlimited)', async () => {
    // a dedicated app with a tight limit — the suite app deliberately raises it
    const tightApp = createApp({
      redis, redisSub, db,
      jwtSecret: TEST_JWT_SECRET, jwtTtlS: 900, refreshTtlS: 3600, ticketTtlS: 30,
      lockout: { maxFails: 100, windowS: 900 }, secureCookies: false, trustProxy: false,
      getRemoteAddr: () => '127.0.0.1',
      signupRateLimit: { max: 2, windowS: 3600 },
    })
    const srv = serve({ fetch: tightApp.fetch, port: 0, createServer }) as ReturnType<typeof createServer>
    const p = await new Promise<number>((r) => srv.on('listening', () => r((srv.address() as { port: number }).port)))
    const post = (email: string) =>
      fetch(`http://127.0.0.1:${p}/v1/public/signup`, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: 'RL', email, password: 'password12' }),
      })
    try {
      await redis.del('signup:rl:127.0.0.1', 'signup:rl:global')
      expect((await post('rl1@fleet.test')).status).toBe(201)
      expect((await post('rl2@fleet.test')).status).toBe(201)
      expect((await post('rl3@fleet.test')).status).toBe(429) // over the per-IP cap

      // Redis down ⇒ 503, NOT an unlimited endpoint (unlike pilot-request, which fails open)
      const brokenApp = createApp({
        redis: { eval: () => Promise.reject(new Error('redis down')) } as unknown as Redis,
        redisSub, db,
        jwtSecret: TEST_JWT_SECRET, jwtTtlS: 900, refreshTtlS: 3600, ticketTtlS: 30,
        lockout: { maxFails: 100, windowS: 900 }, secureCookies: false, trustProxy: false,
        getRemoteAddr: () => '127.0.0.1',
      })
      const srv2 = serve({ fetch: brokenApp.fetch, port: 0, createServer }) as ReturnType<typeof createServer>
      const p2 = await new Promise<number>((r) => srv2.on('listening', () => r((srv2.address() as { port: number }).port)))
      const res = await fetch(`http://127.0.0.1:${p2}/v1/public/signup`, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: 'X', email: 'closed@fleet.test', password: 'password12' }),
      })
      expect(res.status).toBe(503)
      srv2.closeAllConnections?.()
      await new Promise<void>((r) => srv2.close(() => r()))
    } finally {
      srv.closeAllConnections?.()
      await new Promise<void>((r) => srv.close(() => r()))
      await redis.del('signup:rl:127.0.0.1', 'signup:rl:global')
    }
  })

  it('a weak/invalid body → 400; the new tenant is invisible to other tenants (isolation)', async () => {
    expect((await signup({ name: 'X', email: 'not-an-email', password: 'password12' })).status).toBe(400)
    expect((await signup({ name: 'X', email: 'x@y.test', password: 'short' })).status).toBe(400)
    // a platform admin can see all tenants, but a tenant token cannot list tenants at all (403) —
    // covered by the isolation suite; here just assert the platform list includes the signups
    const list = await j('/v1/tenants', 'GET', undefined, { authorization: `Bearer ${platformToken}` })
    expect(list.status).toBe(200)
    const names = ((await list.json()) as { name: string }[]).map((t) => t.name)
    expect(names).toContain('Jonas Logistics')
  })

  it('the account is created in the SIGNUP-supplied reporting time zone, not hard-coded UTC', async () => {
    // The account time zone is what the server buckets report days by (hard rule 7). It was pinned
    // to UTC with no screen anywhere to change it, so a Lithuanian fleet's "yesterday" ran
    // 00:00-24:00 UTC — three hours out in summer, and trips straddling 03:00 local landed in the
    // wrong day. Every Direct customer had it wrong from the first report, invisibly.
    const res = await signup({ name: 'TZ', email: 'tz@fleet.test', password: 'password12', timezone: 'Europe/Vilnius' })
    expect(res.status).toBe(201)
    const { id } = (await res.json()) as { id: string }
    const accounts = await db.accounts.list({ tenantId: id })
    expect(accounts[0]!.timezone).toBe('Europe/Vilnius')
  })

  it('an unusable time zone is refused rather than stored (it would throw at every report render)', async () => {
    const res = await signup({ name: 'BadTZ', email: 'badtz@fleet.test', password: 'password12', timezone: 'Mars/Olympus' })
    expect(res.status).toBe(400)
  })

  it('no time zone still works — UTC, the previous behaviour', async () => {
    const res = await signup({ name: 'NoTZ', email: 'notz@fleet.test', password: 'password12' })
    expect(res.status).toBe(201)
    const { id } = (await res.json()) as { id: string }
    expect((await db.accounts.list({ tenantId: id }))[0]!.timezone).toBe('UTC')
  })

  it('a FREE-MAIL partner still earns commission on free-mail referrals (audit MED)', async () => {
    // The guard compared raw domains, so a reseller whose contact address is a gmail.com one lost
    // commission on every gmail.com referral — which for a small partner is most of them — silently,
    // with only a server-side log to say so. A shared public mailbox provider is not evidence of a
    // shared identity; a company domain is.
    const actor = { userId: '00000000-0000-0000-0000-0000000000f3' }
    const aff = await db.affiliates.create(actor, { name: 'Solo Reseller', email: 'reseller@gmail.com', code: 'FREEMAIL1' })
    await db.affiliates.update(actor, aff.id, { status: 'active' })

    const referred = (await (await signup({ name: 'Customer', email: 'customer@gmail.com', password: 'password12', ref: 'FREEMAIL1' })).json()) as { id: string }
    expect((await db.tenants.get(referred.id))!.referredByAffiliateId).toBe(aff.id)

    // …and the partner's OWN mailbox is still caught, in every form that DELIVERS to it. Without
    // canonicalisation the carve-out would hand them a zero-effort way to earn 20% of their own
    // subscription: `+anything` and dotted variants all land in the same inbox.
    for (const [i, self] of ['reseller@gmail.com', 'reseller+orbetra@gmail.com', 'res.eller@gmail.com'].entries()) {
      const r = await signup({ name: `Self${i}`, email: self, password: 'password12', ref: 'FREEMAIL1' })
      expect(r.status, self).toBe(201)
      const { id } = (await r.json()) as { id: string }
      expect((await db.tenants.get(id))!.referredByAffiliateId, self).toBeNull()
    }
  })
})