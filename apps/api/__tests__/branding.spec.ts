import { execFileSync } from 'node:child_process'
import { createServer } from 'node:http'
import { resolve } from 'node:path'
import { serve } from '@hono/node-server'
import { Redis } from 'ioredis'
import { GenericContainer, Wait, type StartedTestContainer } from 'testcontainers'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'

import { createDb, type Db } from '@orbetra/db'

import { seedUser } from '../../../packages/db/seed/users.js'
import { createApp } from '../src/app.js'
import { expectedTxt } from '../src/routes/tenantSelf.js'
import { mintTestToken, TEST_JWT_SECRET } from './helpers/auth.js'

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

let t1: string
let t2: string
let t1Token: string
let t2Token: string
// injected DNS resolver — tests set the record content per domain
const txtRecords = new Map<string, string[][]>()

const base = () => `http://127.0.0.1:${port}`
const req = (path: string, token: string, method = 'GET', bodyObj?: unknown, headers: Record<string, string> = {}) =>
  fetch(`${base()}${path}`, {
    method,
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json', ...headers },
    ...(bodyObj !== undefined ? { body: JSON.stringify(bodyObj) } : {}),
  })

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

  const s1 = await seedUser({ databaseUrl, email: 'a@t1.test', password: 'password12', role: 'tsp_admin', tenantName: 'T1' })
  const s2 = await seedUser({ databaseUrl, email: 'a@t2.test', password: 'password12', role: 'tsp_admin', tenantName: 'T2' })
  t1 = s1.tenantId
  t2 = s2.tenantId
  t1Token = await mintTestToken({ userId: s1.userId, tenantId: t1, role: 'tsp_admin' })
  t2Token = await mintTestToken({ userId: s2.userId, tenantId: t2, role: 'tsp_admin' })

  const app = createApp({
    redis, redisSub, db,
    jwtSecret: TEST_JWT_SECRET, jwtTtlS: 900, refreshTtlS: 3600, ticketTtlS: 30,
    // trustProxy mirrors production (compose pins TRUST_PROXY=1): /v1/branding only honours
    // X-Forwarded-Host when we are actually behind the proxy that sets it
    lockout: { maxFails: 100, windowS: 900 }, secureCookies: false, trustProxy: true,
    getRemoteAddr: () => '127.0.0.1',
    resolveTxt: (host) => {
      const rec = txtRecords.get(host)
      return rec ? Promise.resolve(rec) : Promise.reject(new Error('ENOTFOUND'))
    },
    askRateLimit: { max: 5, windowS: 60 },
    platformDomain: 'orbetra.test',
    edgeHostname: 'dash.orbetra.test',
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

beforeEach(async () => {
  await redis.flushall()
  txtRecords.clear()
})

describe('E03-5 tenant branding (self, scoped)', () => {
  it('PATCH then GET reflects the branding; a hex-invalid color is rejected', async () => {
    const ok = await req('/v1/tenant/branding', t1Token, 'PATCH', { primary: '#ff8800', productName: 'T1 Track' })
    expect(ok.status).toBe(200)
    const got = (await (await req('/v1/tenant/branding', t1Token)).json()) as { branding: { primary: string } }
    expect(got.branding.primary).toBe('#ff8800')
    // CSS-injection attempt via a non-hex color → 400
    expect((await req('/v1/tenant/branding', t1Token, 'PATCH', { primary: 'red;}body{display:none' })).status).toBe(400)
    // non-https logo → 400
    expect((await req('/v1/tenant/branding', t1Token, 'PATCH', { logoUrl: 'http://x/logo.png' })).status).toBe(400)
  })

  it('branding is per-tenant — T2 never sees T1 branding', async () => {
    await req('/v1/tenant/branding', t1Token, 'PATCH', { productName: 'ONLY T1' })
    const t2got = (await (await req('/v1/tenant/branding', t2Token)).json()) as { branding: Record<string, unknown> }
    expect(t2got.branding['productName']).toBeUndefined()
  })
})

describe('E03-5 domains + DNS verify', () => {
  it('add domain returns a TXT record; verify succeeds only when the TXT matches', async () => {
    const created = (await (await req('/v1/tenant/domains', t1Token, 'POST', { domain: 'fleet.t1.test' })).json()) as { id: string; txtToken: string; txtRecord: string; txtHost: string; txtValue: string }
    // the record we ASK for, described in the shape a DNS panel wants: a name and a value
    expect(created.txtHost).toBe('_orbetra-verify.fleet.t1.test')
    expect(created.txtValue).toBe(created.txtToken)
    // and the legacy apex string, still returned for existing consumers
    expect(created.txtRecord).toBe(expectedTxt(created.txtToken))

    // no TXT yet → 400 not verified
    expect((await req(`/v1/tenant/domains/${created.id}/verify`, t1Token, 'POST')).status).toBe(400)

    // publish the wrong token → still 400
    txtRecords.set('fleet.t1.test', [['orbetra-verify=wrong']])
    expect((await req(`/v1/tenant/domains/${created.id}/verify`, t1Token, 'POST')).status).toBe(400)

    // publish the right token → verified
    txtRecords.set('fleet.t1.test', [['orbetra-verify=' + created.txtToken]])
    const ok = await req(`/v1/tenant/domains/${created.id}/verify`, t1Token, 'POST')
    expect(ok.status).toBe(200)
    expect(((await ok.json()) as { verified: boolean }).verified).toBe(true)
  })

  /**
   * The record we now ASK for: a TXT on `_orbetra-verify.<domain>` carrying the bare token.
   *
   * The old location was a TXT on the domain itself, which cannot coexist with the CNAME the same
   * domain needs to reach us — RFC 1034 §3.6.2, enforced by Cloudflare and Route 53. A tenant who
   * added the CNAME first could not add the TXT at all.
   */
  it('verifies from the dedicated _orbetra-verify name, with the bare token as the value', async () => {
    const created = (await (await req('/v1/tenant/domains', t1Token, 'POST', { domain: 'sub.t1.test' })).json()) as { id: string; txtToken: string }

    // the token on the WRONG name (the domain itself, bare) is not a match either way
    txtRecords.set('sub.t1.test', [[created.txtToken]])
    expect((await req(`/v1/tenant/domains/${created.id}/verify`, t1Token, 'POST')).status).toBe(400)

    // the dedicated name with a wrong token → still refused
    txtRecords.set('_orbetra-verify.sub.t1.test', [['deadbeef']])
    expect((await req(`/v1/tenant/domains/${created.id}/verify`, t1Token, 'POST')).status).toBe(400)

    txtRecords.set('_orbetra-verify.sub.t1.test', [[created.txtToken]])
    const ok = await req(`/v1/tenant/domains/${created.id}/verify`, t1Token, 'POST')
    expect(ok.status).toBe(200)
    expect(((await ok.json()) as { verified: boolean }).verified).toBe(true)
  })

  it('still accepts the LEGACY apex form, so a setup already underway is not broken', async () => {
    const created = (await (await req('/v1/tenant/domains', t1Token, 'POST', { domain: 'legacy.t1.test' })).json()) as { id: string; txtToken: string }
    // nothing on the new name; only the old one published
    txtRecords.set('legacy.t1.test', [[expectedTxt(created.txtToken)]])
    expect((await req(`/v1/tenant/domains/${created.id}/verify`, t1Token, 'POST')).status).toBe(200)
  })

  it('joins a chunked TXT value before comparing — a long record arrives split', async () => {
    const created = (await (await req('/v1/tenant/domains', t1Token, 'POST', { domain: 'chunk.t1.test' })).json()) as { id: string; txtToken: string }
    const half = Math.ceil(created.txtToken.length / 2)
    txtRecords.set('_orbetra-verify.chunk.t1.test', [[created.txtToken.slice(0, half), created.txtToken.slice(half)]])
    expect((await req(`/v1/tenant/domains/${created.id}/verify`, t1Token, 'POST')).status).toBe(200)
  })

  it('a tenant cannot verify/delete ANOTHER tenant’s domain → 404', async () => {
    const created = (await (await req('/v1/tenant/domains', t1Token, 'POST', { domain: 'x.t1.test' })).json()) as { id: string }
    expect((await req(`/v1/tenant/domains/${created.id}/verify`, t2Token, 'POST')).status).toBe(404)
    expect((await req(`/v1/tenant/domains/${created.id}`, t2Token, 'DELETE')).status).toBe(404)
  })

  it('invalid domain string → 400', async () => {
    expect((await req('/v1/tenant/domains', t1Token, 'POST', { domain: 'http://not a host' })).status).toBe(400)
  })
})

/**
 * The zero-setup half of white-label: a tenant with no domain of their own claims a slug under OURS
 * and is live in a minute. There is no DNS proof to ask for — we hold the zone — so the slug rules
 * and the global partial-unique index ARE the entire ownership model.
 */
describe('platform subdomains (<slug>.orbetra.test)', () => {
  it('is VERIFIED on creation, with no TXT record to publish, and serves branding by Host', async () => {
    const res = await req('/v1/tenant/domains', t1Token, 'POST', { domain: 'acme.orbetra.test' })
    expect(res.status).toBe(201)
    const created = (await res.json()) as { id: string; verified: boolean; txtRecord: string | null }
    expect(created.verified).toBe(true)
    expect(created.txtRecord).toBeNull() // nothing for the tenant to publish

    // …and it is immediately usable end to end: Caddy will mint a cert for it,
    await req('/v1/tenant/branding', t1Token, 'PATCH', { productName: 'Acme Fleet', primary: '#ff8800' })
    const ask = await fetch(`http://127.0.0.1:${port}/v1/internal/caddy-ask?domain=acme.orbetra.test`)
    expect(ask.status).toBe(200)
    // and the pre-login page gets the tenant's brand from the Host alone
    const branding = await fetch(`http://127.0.0.1:${port}/v1/branding`, { headers: { 'x-forwarded-host': 'acme.orbetra.test' } })
    expect(((await branding.json()) as { productName: string }).productName).toBe('Acme Fleet')
  })

  it('refuses a RESERVED name — the slug check is the only thing guarding our own zone', async () => {
    for (const slug of ['dash', 'www', 'api', 'secure', 'login', 'billing', 'mail', 'hello']) {
      const res = await req('/v1/tenant/domains', t1Token, 'POST', { domain: `${slug}.orbetra.test` })
      expect(res.status, slug).toBe(400)
      expect(await res.text(), slug).toContain('reserved')
    }
  })

  it('refuses a bad slug shape and a second level, with a reason that says which', async () => {
    const bad = async (domain: string) => {
      const res = await req('/v1/tenant/domains', t1Token, 'POST', { domain })
      expect(res.status, domain).toBe(400)
      return res.text()
    }
    expect(await bad('ab.orbetra.test')).toContain('3–40') // too short
    expect(await bad(`${'a'.repeat(41)}.orbetra.test`)).toContain('3–40') // too long
    // (a leading/trailing dash never reaches the slug rule — domainCreateSchema's hostname
    // regex refuses it first, which is the right layer for a malformed label)
    expect(await bad('deep.nested.orbetra.test')).toContain('one level')
    // the platform domain ITSELF is not claimable
    expect(await bad('orbetra.test')).toContain('platform domain')
  })

  it('a slug another tenant already holds is a CONFLICT, not "already added"', async () => {
    expect((await req('/v1/tenant/domains', t1Token, 'POST', { domain: 'taken.orbetra.test' })).status).toBe(201)
    const res = await req('/v1/tenant/domains', t2Token, 'POST', { domain: 'taken.orbetra.test' })
    expect(res.status).toBe(409)
    expect(await res.text()).toContain('already taken')
  })

  it('an unclaimable name is refused OUTRIGHT rather than sent down the DNS-TXT path', async () => {
    // Routing `secure.orbetra.test` to the normal flow would tell the tenant to publish a TXT
    // record in a zone they cannot edit, then fail forever with "TXT record not found".
    const res = await req('/v1/tenant/domains', t1Token, 'POST', { domain: 'secure.orbetra.test' })
    expect(res.status).toBe(400)
    const list = (await (await req('/v1/tenant/domains', t1Token)).json()) as { domain: string }[]
    expect(list.some((d) => d.domain === 'secure.orbetra.test')).toBe(false) // nothing was created
  })

  it('a tenant OWN domain still requires DNS proof — the subdomain path must not leak into it', async () => {
    const created = (await (await req('/v1/tenant/domains', t1Token, 'POST', { domain: 'fleet.customer.test' })).json()) as
      { verified: boolean; txtRecord: string; dnsTarget: string }
    expect(created.verified).toBe(false)
    expect(created.txtRecord).toMatch(/^orbetra-verify=/)
    // …and it now says where to point the domain, the step that used to be documented nowhere
    expect(created.dnsTarget).toBe('dash.orbetra.test')
  })
})

describe('E03-5 public branding by Host + Caddy ask', () => {
  async function verifiedDomain(tenantToken: string, domain: string): Promise<void> {
    const created = (await (await req('/v1/tenant/domains', tenantToken, 'POST', { domain })).json()) as { id: string; txtToken: string }
    txtRecords.set(domain, [['orbetra-verify=' + created.txtToken]])
    await req(`/v1/tenant/domains/${created.id}/verify`, tenantToken, 'POST')
  }

  it('GET /v1/branding resolves by Host to the right tenant; unknown host → {}', async () => {
    await req('/v1/tenant/branding', t1Token, 'PATCH', { productName: 'T1 Brand', primary: '#111111' })
    await req('/v1/tenant/branding', t2Token, 'PATCH', { productName: 'T2 Brand', primary: '#222222' })
    await verifiedDomain(t1Token, 'app.t1.test')
    await verifiedDomain(t2Token, 'app.t2.test')

    const b1 = (await (await fetch(`${base()}/v1/branding`, { headers: { 'x-forwarded-host': 'app.t1.test' } })).json()) as { branding: { productName: string } }
    const b2 = (await (await fetch(`${base()}/v1/branding`, { headers: { 'x-forwarded-host': 'app.t2.test' } })).json()) as { branding: { productName: string } }
    expect(b1.branding.productName).toBe('T1 Brand')
    expect(b2.branding.productName).toBe('T2 Brand')
    const unknown = (await (await fetch(`${base()}/v1/branding`, { headers: { 'x-forwarded-host': 'nope.test' } })).json()) as Record<string, unknown>
    // `whiteLabel:false` and nothing else — the flag is the fact the client needs and this endpoint
    // used to withhold, so the web inferred it from "did any branding field arrive" and drew our
    // wordmark on a verified-but-unbranded tenant's login page
    expect(unknown).toEqual({ whiteLabel: false })
  })

  it('caddy-ask: 200 for a verified domain, 403 for unknown/unverified, 400 for a bad domain', async () => {
    await verifiedDomain(t1Token, 'live.t1.test')
    expect((await fetch(`${base()}/v1/internal/caddy-ask?domain=live.t1.test`)).status).toBe(200)
    expect((await fetch(`${base()}/v1/internal/caddy-ask?domain=evil.test`)).status).toBe(403)
    // an UNVERIFIED domain is still denied
    await req('/v1/tenant/domains', t1Token, 'POST', { domain: 'pending.t1.test' })
    expect((await fetch(`${base()}/v1/internal/caddy-ask?domain=pending.t1.test`)).status).toBe(403)
    expect((await fetch(`${base()}/v1/internal/caddy-ask?domain=not-a-host`)).status).toBe(400)
  })

  it('caddy-ask is rate-limited per domain (max 5 in the test) → 429', async () => {
    for (let i = 0; i < 5; i++) expect((await fetch(`${base()}/v1/internal/caddy-ask?domain=whatever.test`)).status).toBe(403)
    expect((await fetch(`${base()}/v1/internal/caddy-ask?domain=whatever.test`)).status).toBe(429)
    // a DIFFERENT domain has its own bucket — not throttled by the above
    expect((await fetch(`${base()}/v1/internal/caddy-ask?domain=other.test`)).status).toBe(403)
  })

  it('caddy-ask keeps answering when REDIS is down — a throttle blip must not expire a certificate', async () => {
    // Caddy mints a certificate iff this answers 200, so ANY non-200 reads as "deny". An unhandled
    // rejection from the rate limiter would therefore be a 500, and that tenant's certificate would
    // silently stop renewing. The DB is the authority here; the throttle is a guard rail.
    await verifiedDomain(t1Token, 'redisdown.t1.test')
    const brokenRedis = new Proxy(redis, {
      get: (t, prop, r) => (prop === 'eval' ? () => Promise.reject(new Error('OOM command not allowed')) : (Reflect.get(t, prop, r) as unknown)),
    })
    const app = createApp({
      redis: brokenRedis, redisSub, db,
      jwtSecret: TEST_JWT_SECRET, jwtTtlS: 900, refreshTtlS: 3600, ticketTtlS: 30,
      lockout: { maxFails: 100, windowS: 900 }, secureCookies: false, trustProxy: false,
      getRemoteAddr: () => '127.0.0.1',
      askRateLimit: { max: 5, windowS: 60 },
    })
    const srv = serve({ fetch: app.fetch, port: 0, createServer }) as ReturnType<typeof createServer>
    const p = await new Promise<number>((r) => srv.on('listening', () => r((srv.address() as { port: number }).port)))
    try {
      expect((await fetch(`http://127.0.0.1:${p}/v1/internal/caddy-ask?domain=redisdown.t1.test`)).status).toBe(200)
      // …and an unverified domain is still DENIED: failing the throttle open must not open the gate
      expect((await fetch(`http://127.0.0.1:${p}/v1/internal/caddy-ask?domain=evil.test`)).status).toBe(403)
    } finally {
      srv.closeAllConnections?.()
      await new Promise<void>((r) => srv.close(() => r()))
    }
  })

  it('public routes need NO auth (Caddy has no bearer)', async () => {
    expect((await fetch(`${base()}/v1/internal/caddy-ask?domain=x.test`)).status).not.toBe(401)
    expect((await fetch(`${base()}/v1/branding`, { headers: { 'x-forwarded-host': 'x.test' } })).status).toBe(200)
  })

  it('caddy-ask is INTERNAL: a request that came through the proxy is 404, not answered', async () => {
    // Caddy calls the ask DIRECTLY over the compose network, so it carries no proxy headers.
    // Anything arriving WITH them came from the internet — and this route is unauthenticated with a
    // throttle keyed on the REQUESTED DOMAIN, so a stranger sending 10/min for someone else's
    // white-label hostname makes it 429, which Caddy reads as "deny" and stops renewing that
    // tenant's certificate. The Caddyfile 404s /v1/internal/* at every host block; this is the
    // second lock, so a future host block that forgets it cannot silently re-open the door.
    await verifiedDomain(t1Token, 'proxied.t1.test')
    const proxied: Record<string, string>[] = [{ 'x-forwarded-for': '203.0.113.9' }, { 'x-forwarded-host': 'dash.orbetra.com' }]
    for (const h of proxied) {
      const res = await fetch(`${base()}/v1/internal/caddy-ask?domain=proxied.t1.test`, { headers: h })
      expect(res.status, JSON.stringify(h)).toBe(404) // never 200/403 — not even the oracle
    }
    // …and the direct call Caddy actually makes still works
    expect((await fetch(`${base()}/v1/internal/caddy-ask?domain=proxied.t1.test`)).status).toBe(200)
  })
})

describe('the manifest is branded by Host — the leak that outlives every other one', () => {
  it('serves the tenant name + logo on a tenant host, and the platform identity on ours', async () => {
    await req('/v1/tenant/branding', t1Token, 'PATCH', { productName: 'Acme Fleet', logoUrl: 'https://cdn.acme.test/logo.png', primary: '#ff8800' })
    const created = (await (await req('/v1/tenant/domains', t1Token, 'POST', { domain: 'app.acme.test' })).json()) as { id: string; txtToken: string }
    txtRecords.set('app.acme.test', [['orbetra-verify=' + created.txtToken]])
    await req(`/v1/tenant/domains/${created.id}/verify`, t1Token, 'POST')

    const tenant = (await (await fetch(`${base()}/v1/public/manifest.webmanifest`, { headers: { 'x-forwarded-host': 'app.acme.test' } })).json()) as
      { name: string; short_name: string; theme_color: string; icons: { src: string }[] }
    expect(tenant.name).toBe('Acme Fleet')
    expect(tenant.icons[0]!.src).toBe('https://cdn.acme.test/logo.png')
    expect(tenant.theme_color).toBe('#ff8800')
    expect(JSON.stringify(tenant)).not.toContain('Orbetra')

    const ours = (await (await fetch(`${base()}/v1/public/manifest.webmanifest`, { headers: { 'x-forwarded-host': 'nope.test' } })).json()) as { name: string }
    expect(ours.name).toBe('Orbetra')
  })

  it('a VERIFIED but UNBRANDED tenant still gets no platform identity anywhere', async () => {
    // the case that broke every client-side inference: the host resolves to a tenant, and there is
    // no branding to infer it from
    await db.tenants.updateBranding({ userId: '00000000-0000-0000-0000-0000000000ff' }, t2, {})
    const created = (await (await req('/v1/tenant/domains', t2Token, 'POST', { domain: 'bare.t2.test' })).json()) as { id: string; txtToken: string }
    txtRecords.set('bare.t2.test', [['orbetra-verify=' + created.txtToken]])
    await req(`/v1/tenant/domains/${created.id}/verify`, t2Token, 'POST')

    const m = (await (await fetch(`${base()}/v1/public/manifest.webmanifest`, { headers: { 'x-forwarded-host': 'bare.t2.test' } })).json()) as { name: string; icons: unknown[] }
    expect(m.name).toBe('bare.t2.test') // their host, not our name and not their legal name
    expect(m.icons).toEqual([])
    expect(JSON.stringify(m)).not.toContain('Orbetra')

    const b = (await (await fetch(`${base()}/v1/branding`, { headers: { 'x-forwarded-host': 'bare.t2.test' } })).json()) as { whiteLabel: boolean }
    expect(b.whiteLabel).toBe(true) // …and the SERVER says so, so the client never has to guess
  })
})

describe('E03-5 hardening (adversarial review)', () => {
  it('a pending squat does NOT block the real owner: both add, first to prove DNS wins (MED)', async () => {
    const domain = 'contested.test'
    // T2 squats it first (pending, no DNS control)
    const squat = (await (await req('/v1/tenant/domains', t2Token, 'POST', { domain })).json()) as { id: string; txtToken: string }
    // T1 (the real owner) can STILL add it — pending is unique per tenant, not globally
    const mine = (await req('/v1/tenant/domains', t1Token, 'POST', { domain }))
    expect(mine.status).toBe(201)
    const owner = (await mine.json()) as { id: string; txtToken: string }

    // both tokens are published on the (shared) domain's TXT; T1 verifies → wins the slot
    txtRecords.set(domain, [['orbetra-verify=' + owner.txtToken], ['orbetra-verify=' + squat.txtToken]])
    expect((await req(`/v1/tenant/domains/${owner.id}/verify`, t1Token, 'POST')).status).toBe(200)
    // the ask endpoint now maps the domain to T1
    expect((await fetch(`${base()}/v1/internal/caddy-ask?domain=${domain}`)).status).toBe(200)

    // T2's verify now loses to the partial-unique guard → 409 (not a silent takeover)
    expect((await req(`/v1/tenant/domains/${squat.id}/verify`, t2Token, 'POST')).status).toBe(409)
  })

  it('the same tenant adding a domain twice → 409 (per-tenant uniqueness)', async () => {
    expect((await req('/v1/tenant/domains', t1Token, 'POST', { domain: 'twice.t1.test' })).status).toBe(201)
    expect((await req('/v1/tenant/domains', t1Token, 'POST', { domain: 'twice.t1.test' })).status).toBe(409)
  })

  it('branding + domains are tenant-admin only: a viewer and an account_manager get 403', async () => {
    const viewer = await mintTestToken({ userId: 'v-user', tenantId: t1, role: 'viewer' })
    const mgr = await mintTestToken({ userId: 'm-user', tenantId: t1, role: 'account_manager', accountId: 'acc-x' })
    for (const tok of [viewer, mgr]) {
      expect((await req('/v1/tenant/branding', tok, 'PATCH', { productName: 'nope' })).status).toBe(403)
      expect((await req('/v1/tenant/domains', tok, 'POST', { domain: 'nope.test' })).status).toBe(403)
      expect((await req('/v1/tenant/domains', tok)).status).toBe(403)
    }
  })
})
