import { execFileSync } from 'node:child_process'
import { createServer } from 'node:http'
import { resolve } from 'node:path'
import { serve } from '@hono/node-server'
import { Redis } from 'ioredis'
import { GenericContainer, Wait, type StartedTestContainer } from 'testcontainers'
import { afterEach, afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'

import { createDb, createPool, type Db, type Pool } from '@orbetra/db'
import { MAX_BRAND_ASSET_BYTES } from '@orbetra/shared'

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
let pool: Pool
let databaseUrl: string
let port: number
let httpServer: ReturnType<typeof createServer>

let t1: string
let t2: string
let t1Token: string
let t2Token: string
/**
 * A fake SES identity gateway (ADR-036). Records every call, so a test can assert not merely the
 * response but WHICH identity we asked AWS about — the routes are thin wrappers around three calls
 * and getting the wrong domain to the right call is the mistake worth catching.
 */
const sesState = {
  calls: [] as { op: string; domain: string }[],
  status: 'pending' as 'pending' | 'verified' | 'failed',
  failWith: null as string | null,
}
const fakeSes = {
  create: (domain: string) => {
    sesState.calls.push({ op: 'create', domain })
    if (sesState.failWith !== null) return Promise.reject(new Error(sesState.failWith))
    return Promise.resolve({ dkimTokens: ['tok1', 'tok2', 'tok3'], status: sesState.status })
  },
  get: (domain: string) => {
    sesState.calls.push({ op: 'get', domain })
    if (sesState.failWith !== null) return Promise.reject(new Error(sesState.failWith))
    return Promise.resolve({ dkimTokens: ['tok1', 'tok2', 'tok3'], status: sesState.status })
  },
  remove: (domain: string) => {
    sesState.calls.push({ op: 'remove', domain })
    return Promise.resolve()
  },
}

// injected DNS resolver — tests set the record content per domain
const txtRecords = new Map<string, string[][]>()
const cnameRecords = new Map<string, string[]>()
const addressRecords = new Map<string, string[]>()

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
  pool = createPool(databaseUrl)

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
    resolveCname: (host) => {
      const rec = cnameRecords.get(host)
      return rec ? Promise.resolve(rec) : Promise.reject(new Error('ENOTFOUND'))
    },
    resolveAddress: (host) => {
      const rec = addressRecords.get(host)
      return rec ? Promise.resolve(rec) : Promise.reject(new Error('ENOTFOUND'))
    },
    askRateLimit: { max: 5, windowS: 60 },
    mapToken: () => Promise.resolve({ token: 'tk.temp', expiresAt: '2026-09-06T11:00:00.000Z' }),
    platformDomain: 'orbetra.test',
    edgeHostname: 'dash.orbetra.test',
    ses: fakeSes,
  })
  httpServer = serve({ fetch: app.fetch, port: 0, createServer }) as ReturnType<typeof createServer>
  port = await new Promise<number>((r) => httpServer.on('listening', () => r((httpServer.address() as { port: number }).port)))
}, 300_000)

afterAll(async () => {
  httpServer?.closeAllConnections?.()
  await new Promise<void>((r) => httpServer.close(() => r()))
  await pool.end()
  await db.$disconnect()
  await redis.quit()
  await redisSub.quit()
  await Promise.all([pg.stop(), redisC.stop()])
})

beforeEach(async () => {
  await redis.flushall()
  txtRecords.clear()
  cnameRecords.clear()
  addressRecords.clear()
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

  it('the DEPLOYMENT config rides only to a tenant-wide admin, never to a viewer', async () => {
    // READ_POLICY.branding is every role on purpose ("viewers see the theme"), and AppShell fetches
    // this on mount for EVERY authenticated page — so `dash.orbetra.test` and `orbetra.test` were
    // delivered into a reseller's end customer's browser on every login (audit W-9). Nothing renders
    // them there, but they are in the response, and an `orb_live_` key reaches the same endpoint.
    const admin = (await (await req('/v1/tenant/branding', t1Token)).json()) as Record<string, unknown>
    expect(admin['dnsTarget']).toBe('dash.orbetra.test')
    expect(admin['platformDomain']).toBe('orbetra.test')

    const viewerToken = await mintTestToken({ userId: '00000000-0000-0000-0000-0000000000ab', tenantId: t1, role: 'viewer' })
    const viewer = (await (await req('/v1/tenant/branding', viewerToken)).json()) as Record<string, unknown>
    expect(viewer['branding']).toBeDefined() // they still get the theme, which is the point of the route
    expect(viewer['dnsTarget']).toBeUndefined()
    expect(viewer['dnsAddresses']).toBeUndefined()
    expect(viewer['platformDomain']).toBeUndefined()
    expect(JSON.stringify(viewer)).not.toMatch(/orbetra/i)
  })

  it('…and not to an ACCOUNT-PINNED admin either — the setup steps are tenant-wide', async () => {
    const pinned = await mintTestToken({ userId: '00000000-0000-0000-0000-0000000000ac', tenantId: t1, accountId: '00000000-0000-0000-0000-0000000000ad', role: 'tsp_admin' })
    const got = (await (await req('/v1/tenant/branding', pinned)).json()) as Record<string, unknown>
    expect(got['branding']).toBeDefined()
    expect(got['dnsTarget']).toBeUndefined()
  })

  it('branding is per-tenant — T2 never sees T1 branding', async () => {
    await req('/v1/tenant/branding', t1Token, 'PATCH', { productName: 'ONLY T1' })
    const t2got = (await (await req('/v1/tenant/branding', t2Token)).json()) as { branding: Record<string, unknown> }
    expect(t2got.branding['productName']).toBeUndefined()
  })
})

/**
 * The token a browser session uses for map tiles.
 *
 * The bundled one is URL-restricted to our own hosts, so on a white-label tenant's domain every
 * tile came back 403 and the map was a black rectangle under a working interface.
 */
describe('map token', () => {
  it('hands a signed-in user a short-lived token', async () => {
    const res = await req('/v1/map/token', t1Token)
    expect(res.status).toBe(200)
    expect((await res.json()) as { token: string }).toEqual({ token: 'tk.temp', expiresAt: '2026-09-06T11:00:00.000Z' })
  })

  it('refuses a caller with no valid session — it is cheap, but it is ours to spend', async () => {
    expect((await req('/v1/map/token', 'not-a-token')).status).toBe(401)
  })
})

describe('E03-5 domains + DNS verify', () => {
  /**
   * Domains created by the DNS-diagnosis tests, removed after each one.
   *
   * The per-tenant cap is 25 and each diagnosis needs its own name; without cleanup they fill the
   * quota and the LATER tests — duplicates, squatting — fail on a limit they are not about. A test
   * that breaks its neighbours is worse than no test.
   */
  const afterEachCleanup: string[] = []
  afterEach(async () => {
    for (const id of afterEachCleanup.splice(0)) await req(`/v1/tenant/domains/${id}`, t1Token, 'DELETE')
  })

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
    afterEachCleanup.push(created.id)

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
    afterEachCleanup.push(created.id)
    // nothing on the new name; only the old one published
    txtRecords.set('legacy.t1.test', [[expectedTxt(created.txtToken)]])
    expect((await req(`/v1/tenant/domains/${created.id}/verify`, t1Token, 'POST')).status).toBe(200)
  })

  it('joins a chunked TXT value before comparing — a long record arrives split', async () => {
    const created = (await (await req('/v1/tenant/domains', t1Token, 'POST', { domain: 'chunk.t1.test' })).json()) as { id: string; txtToken: string }
    afterEachCleanup.push(created.id)
    const half = Math.ceil(created.txtToken.length / 2)
    txtRecords.set('_orbetra-verify.chunk.t1.test', [[created.txtToken.slice(0, half), created.txtToken.slice(half)]])
    expect((await req(`/v1/tenant/domains/${created.id}/verify`, t1Token, 'POST')).status).toBe(200)
  })

  /**
   * Each record reported separately.
   *
   * One button with two outcomes could not distinguish "proved ownership, goes nowhere" from
   * "finished" — and the first is what a tenant gets when the CNAME they added was silently
   * dropped by the zone for colliding with an existing A/MX/TXT (RFC 1034 §3.6.2). It is the
   * founder's own domain, right now.
   */
  it('hands the edge ADDRESSES to the panel — an apex can be pointed at nothing else', async () => {
    // A zone root always carries SOA and NS, so a CNAME is invalid there by construction. Without
    // an address the panel can only offer a record the customer's own domain cannot accept.
    addressRecords.set('dash.orbetra.test', ['185.80.129.33'])
    const b = (await (await req('/v1/tenant/branding', t1Token)).json()) as { dnsTarget: string | null; dnsAddresses: string[] }
    expect(b.dnsTarget).toBe('dash.orbetra.test')
    expect(b.dnsAddresses).toEqual(['185.80.129.33'])
  })

  it('gives an empty address list rather than failing when the edge host does not resolve', async () => {
    const b = (await (await req('/v1/tenant/branding', t1Token)).json()) as { dnsAddresses: string[] }
    expect(b.dnsAddresses).toEqual([])
  })

  it('reports the TXT and the ROUTE separately, so a half-configured domain says which half', async () => {
    const created = (await (await req('/v1/tenant/domains', t1Token, 'POST', { domain: 'half.t1.test' })).json()) as { id: string; txtToken: string }
    afterEachCleanup.push(created.id)

    const dnsOf = async () =>
      (await (await req(`/v1/tenant/domains/${created.id}/dns`, t1Token)).json()) as {
        txt: { ok: boolean; found: string[] }
        route: { ok: boolean; found: string[]; expected: string | null; reason: string | null }
      }

    // nothing published at all
    let d = await dnsOf()
    expect(d.txt.ok).toBe(false)
    expect(d.route.ok).toBe(false)
    expect(d.route.expected).toBe('dash.orbetra.test')

    // ownership proved, routing absent — the state a verified badge used to hide
    txtRecords.set('_orbetra-verify.half.t1.test', [[created.txtToken]])
    d = await dnsOf()
    expect(d.txt.ok).toBe(true)
    expect(d.route.ok).toBe(false)

    // pointed at somebody ELSE: `found` must say where it goes, or the reader cannot act
    addressRecords.set('half.t1.test', ['185.80.128.45'])
    addressRecords.set('dash.orbetra.test', ['185.80.129.33'])
    d = await dnsOf()
    expect(d.route.ok).toBe(false)
    expect(d.route.found).toContain('185.80.128.45')
    /**
     * And WHY. A name already answering with an address cannot also hold a CNAME, so telling the
     * reader only "not found" sends them to re-add the record the zone will drop again — which is
     * the loop the founder was in.
     */
    expect(d.route.reason).toBe('occupied')

    // the CNAME lands → both halves green
    cnameRecords.set('half.t1.test', ['dash.orbetra.test.'])
    d = await dnsOf()
    expect(d.route.ok).toBe(true)
  })

  /**
   * The failure that looks like success.
   *
   * A panel following zone-file rules treats a name without a trailing dot as relative, so a
   * pasted `fleet.dokigo.lt` in a `dokigo.lt` zone is filed at `fleet.dokigo.lt.dokigo.lt`. The
   * record list shows it looking perfect and the browser says the site does not exist. It is the
   * most common way this setup fails and the least visible.
   */
  /**
   * A verification record IS published, carrying a token from an earlier attempt.
   *
   * Removing and re-adding a domain mints a new token, which silently invalidates the record the
   * customer already published — and it still sits in their zone under the right name, looking
   * exactly right. "Not found" is the cruellest possible answer: they are staring at the record it
   * says is missing. The founder hit this four times in one afternoon.
   */
  it('says a published token is STALE rather than missing', async () => {
    const created = (await (await req('/v1/tenant/domains', t1Token, 'POST', { domain: 'stale.t1.test' })).json()) as { id: string }
    afterEachCleanup.push(created.id)
    txtRecords.set('_orbetra-verify.stale.t1.test', [['0000000000000000000000000000dead']])
    const d = (await (await req(`/v1/tenant/domains/${created.id}/dns`, t1Token)).json()) as { txt: { ok: boolean; reason: string | null } }
    expect(d.txt.ok).toBe(false)
    expect(d.txt.reason).toBe('stale')
  })

  it('does not call an ordinary apex TXT stale — SPF and DMARC are not failed attempts at ours', async () => {
    const created = (await (await req('/v1/tenant/domains', t1Token, 'POST', { domain: 'spf.t1.test' })).json()) as { id: string }
    afterEachCleanup.push(created.id)
    txtRecords.set('spf.t1.test', [['v=spf1 a mx ~all'], ['v=DMARC1; p=none;']])
    const d = (await (await req(`/v1/tenant/domains/${created.id}/dns`, t1Token)).json()) as { txt: { reason: string | null } }
    expect(d.txt.reason).toBe('absent')
  })

  it('calls the LEGACY apex form stale when it carries an old token — it is ours by its prefix', async () => {
    const created = (await (await req('/v1/tenant/domains', t1Token, 'POST', { domain: 'old.t1.test' })).json()) as { id: string }
    afterEachCleanup.push(created.id)
    txtRecords.set('old.t1.test', [['orbetra-verify=0000000000000000000000000000dead'], ['v=spf1 ~all']])
    const d = (await (await req(`/v1/tenant/domains/${created.id}/dns`, t1Token)).json()) as { txt: { reason: string | null } }
    expect(d.txt.reason).toBe('stale')
  })

  it('spots a name the provider doubled, and says so instead of "not found"', async () => {
    const created = (await (await req('/v1/tenant/domains', t1Token, 'POST', { domain: 'fleet.dbl.t1.test' })).json()) as { id: string }
    afterEachCleanup.push(created.id)
    cnameRecords.set('fleet.dbl.t1.test.dbl.t1.test', ['dash.orbetra.test.'])
    const d = (await (await req(`/v1/tenant/domains/${created.id}/dns`, t1Token)).json()) as { route: { ok: boolean; reason: string | null } }
    expect(d.route.ok).toBe(false)
    expect(d.route.reason).toBe('doubled')
  })

  it('does not cry "doubled" at a CNAME under a doubled name pointing somewhere ELSE', async () => {
    // only OUR edge under a doubled name is proof; anything else is somebody's unrelated record
    const created = (await (await req('/v1/tenant/domains', t1Token, 'POST', { domain: 'fleet.other.t1.test' })).json()) as { id: string }
    afterEachCleanup.push(created.id)
    cnameRecords.set('fleet.other.t1.test.other.t1.test', ['unrelated.example.'])
    const d = (await (await req(`/v1/tenant/domains/${created.id}/dns`, t1Token)).json()) as { route: { reason: string | null } }
    expect(d.route.reason).not.toBe('doubled')
  })

  it('calls a name with nothing published ABSENT, not occupied', async () => {
    const created = (await (await req('/v1/tenant/domains', t1Token, 'POST', { domain: 'empty.t1.test' })).json()) as { id: string }
    afterEachCleanup.push(created.id)
    const d = (await (await req(`/v1/tenant/domains/${created.id}/dns`, t1Token)).json()) as { route: { reason: string | null; found: string[] } }
    expect(d.route.reason).toBe('absent')
    expect(d.route.found).toEqual([])
  })

  it('calls a CNAME pointing at the WRONG host elsewhere, not occupied — the record does exist', async () => {
    const created = (await (await req('/v1/tenant/domains', t1Token, 'POST', { domain: 'wrong.t1.test' })).json()) as { id: string }
    afterEachCleanup.push(created.id)
    cnameRecords.set('wrong.t1.test', ['some-other-platform.example.'])
    const d = (await (await req(`/v1/tenant/domains/${created.id}/dns`, t1Token)).json()) as { route: { reason: string | null; found: string[] } }
    expect(d.route.reason).toBe('elsewhere')
    expect(d.route.found).toContain('some-other-platform.example')
  })

  it('counts an ADDRESS matching the edge host as reaching us — an apex cannot hold a CNAME', () => {
    // ALIAS/ANAME flattening publishes an A, not a CNAME. Insisting on a CNAME would mark every
    // correctly-configured domain root as broken.
    return (async () => {
      const created = (await (await req('/v1/tenant/domains', t1Token, 'POST', { domain: 'apex.t1.test' })).json()) as { id: string }
    afterEachCleanup.push(created.id)
      addressRecords.set('dash.orbetra.test', ['203.0.113.7'])
      addressRecords.set('apex.t1.test', ['203.0.113.7'])
      const d = (await (await req(`/v1/tenant/domains/${created.id}/dns`, t1Token)).json()) as { route: { ok: boolean } }
      expect(d.route.ok).toBe(true)
    })()
  })

  it('another tenant cannot read a domain’s DNS state → 404', async () => {
    const created = (await (await req('/v1/tenant/domains', t1Token, 'POST', { domain: 'peek.t1.test' })).json()) as { id: string }
    afterEachCleanup.push(created.id)
    expect((await req(`/v1/tenant/domains/${created.id}/dns`, t2Token)).status).toBe(404)
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
    mapToken: () => Promise.resolve({ token: 'tk.temp', expiresAt: '2026-09-06T11:00:00.000Z' }),
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

/**
 * Uploaded brand images (W10).
 *
 * The whole feature exists to answer one question — where do the bytes live so that a reseller's
 * customer never sees our domain — so most of these assert the ABSENCE of something rather than the
 * presence of it.
 */
describe('W10 uploaded brand assets', () => {
  /** A PNG with real IHDR dimensions. The route reads these bytes, so a stub would prove nothing. */
  const png = (w: number, h: number): Buffer => {
    const b = Buffer.alloc(24)
    b.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0)
    b.set([0, 0, 0, 13], 8)
    b.write('IHDR', 12, 'ascii')
    b.writeUInt32BE(w, 16)
    b.writeUInt32BE(h, 20)
    return b
  }
  const SVG = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16"><rect width="16" height="16" fill="#123456"/></svg>'
  const upload = (token: string, slot: string, mime: string, bytes: Buffer | string) =>
    req(`/v1/tenant/branding/asset/${slot}`, token, 'POST', { mime, data: Buffer.from(bytes).toString('base64') })
  /** Tenant fixtures persist across this file, so assertions are per-SLOT, never "no assets at all". */
  const assetsOf = async (token: string): Promise<{ slot: string; path: string }[]> =>
    ((await (await req('/v1/tenant/branding', token)).json()) as { assets: { slot: string; path: string }[] }).assets
  const verified = async (token: string, domain: string): Promise<void> => {
    const created = (await (await req('/v1/tenant/domains', token, 'POST', { domain })).json()) as { id: string; txtToken: string }
    txtRecords.set(domain, [['orbetra-verify=' + created.txtToken]])
    await req(`/v1/tenant/domains/${created.id}/verify`, token, 'POST')
  }

  it('stores the file, points branding at it, and serves the SAME bytes back', async () => {
    const bytes = png(192, 192)
    const res = await upload(t1Token, 'favicon', 'image/png', bytes)
    expect(res.status).toBe(201)
    const { branding, asset } = (await res.json()) as { branding: { faviconUrl: string }; asset: { path: string; width: number; height: number; sizeBytes: number } }

    expect(branding.faviconUrl).toBe(asset.path)
    expect(asset.path).toMatch(/^\/v1\/public\/brand\/[0-9a-f]{32}\.png$/)
    expect([asset.width, asset.height, asset.sizeBytes]).toEqual([192, 192, bytes.length])

    const served = await fetch(`${base()}${asset.path}`)
    expect(served.status).toBe(200)
    expect(served.headers.get('content-type')).toBe('image/png')
    expect(Buffer.from(await served.arrayBuffer()).equals(bytes)).toBe(true)
  })

  it('the served path is RELATIVE and names no host of ours — the point of the whole design', async () => {
    const { asset, branding } = (await (await upload(t1Token, 'logo', 'image/png', png(200, 50))).json()) as { asset: { path: string }; branding: unknown }
    expect(asset.path.startsWith('/')).toBe(true)
    expect(JSON.stringify(branding)).not.toContain('orbetra')
    expect(JSON.stringify(branding)).not.toMatch(/https?:\/\//)
  })

  it('resolves on ANY host — a tenant domain, an unknown one, and our own dashboard', async () => {
    const { asset } = (await (await upload(t1Token, 'logo', 'image/png', png(64, 64))).json()) as { asset: { path: string } }
    await verified(t2Token, 'other.t2.test')
    // Host-independence is deliberate: a route that resolved by Host could not serve the dashboard,
    // where a reseller admin edits their own brand. The sandbox CSP is what makes it safe.
    for (const host of ['app.t1.test', 'other.t2.test', 'dash.orbetra.test']) {
      const r = await fetch(`${base()}${asset.path}`, { headers: { 'x-forwarded-host': host } })
      expect(r.status, host).toBe(200)
    }
  })

  it('is cacheable forever because the URL is the content hash, and a new file gets a new URL', async () => {
    const first = (await (await upload(t1Token, 'logo', 'image/png', png(100, 20))).json()) as { asset: { path: string } }
    const second = (await (await upload(t1Token, 'logo', 'image/png', png(101, 20))).json()) as { asset: { path: string } }
    expect(second.asset.path).not.toBe(first.asset.path)

    const r = await fetch(`${base()}${second.asset.path}`)
    expect(r.headers.get('cache-control')).toBe('public, max-age=31536000, immutable')
    // No Vary: unlike /v1/branding and the manifest, this body does not depend on the Host.
    expect(r.headers.get('vary')).toBeNull()
    // …but a MISS is not cacheable: deleting and re-uploading the same file reproduces the digest,
    // so a held 404 would hide the restored image.
    const miss = await fetch(`${base()}/v1/public/brand/${'9'.repeat(32)}.png`)
    expect(miss.status).toBe(404)
    expect(miss.headers.get('cache-control')).toBe('no-store')
  })

  it('an SVG is served sandboxed, which is what stops it running script in a tenant origin', async () => {
    const { asset } = (await (await upload(t1Token, 'logo', 'image/svg+xml', SVG)).json()) as { asset: { path: string } }
    const r = await fetch(`${base()}${asset.path}`)
    expect(r.headers.get('content-type')).toBe('image/svg+xml')
    const csp = r.headers.get('content-security-policy') ?? ''
    expect(csp).toContain('sandbox')
    expect(csp).toContain("default-src 'none'")
    expect(csp).not.toContain('allow-scripts')
  })

  it('is loadable cross-origin — a mail client fetching the logo is not same-origin', async () => {
    const { asset } = (await (await upload(t1Token, 'logo', 'image/png', png(32, 32))).json()) as { asset: { path: string } }
    expect((await fetch(`${base()}${asset.path}`)).headers.get('cross-origin-resource-policy')).toBe('cross-origin')
    // …and every other route keeps the strict value.
    expect((await fetch(`${base()}/v1/branding`)).headers.get('cross-origin-resource-policy')).toBe('same-origin')
  })

  it('refuses hostile and malformed uploads, by reason', async () => {
    const cases: [string, string, Buffer | string, string][] = [
      ['a script-bearing SVG', 'image/svg+xml', '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>', 'script'],
      ['an event handler', 'image/svg+xml', '<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"/>', 'event_handler'],
      ['SVG markup declared as PNG', 'image/png', SVG, 'mime_mismatch'],
      ['PNG bytes declared as SVG', 'image/svg+xml', png(8, 8), 'not_svg'],
      ['an absurd pixel count in a tiny file', 'image/png', png(20_000, 20_000), 'too_many_pixels'],
    ]
    for (const [label, mime, bytes, reason] of cases) {
      const r = await upload(t1Token, 'logo', mime, bytes)
      expect(r.status, label).toBe(400)
      expect(JSON.stringify(await r.json()), label).toContain(reason)
    }
    // over the byte cap
    const huge = Buffer.concat([png(8, 8), Buffer.alloc(512 * 1024)])
    expect((await upload(t1Token, 'logo', 'image/png', huge)).status).toBe(400)
  })

  it('accepts a file at EXACTLY the cap — three limits have to line up for that to work', async () => {
    // 512 KB of bytes is 699 052 base64 chars, which must clear the schema's 700 000 cap AND the
    // 1 MB global body limit. Any of the three moving independently turns a legal upload into an
    // unexplained 400 or 413, and only the boundary shows it.
    const atCap = Buffer.concat([png(64, 64), Buffer.alloc(MAX_BRAND_ASSET_BYTES - 24)])
    expect(atCap.length).toBe(MAX_BRAND_ASSET_BYTES)
    expect((await upload(t1Token, 'logo', 'image/png', atCap)).status).toBe(201)
    const overByOne = Buffer.concat([atCap, Buffer.alloc(1)])
    expect((await upload(t1Token, 'logo', 'image/png', overByOne)).status).toBe(400)
    // an unknown slot is not a resource we have
    expect((await upload(t1Token, 'banner', 'image/png', png(8, 8))).status).toBe(404)
  })

  it('never serves bytes under a mime they are not — the extension must match what was stored', async () => {
    const { asset } = (await (await upload(t1Token, 'logo', 'image/png', png(24, 24))).json()) as { asset: { path: string } }
    // same hash, wrong extension: without this an uploader could pick the Content-Type after the fact
    expect((await fetch(`${base()}${asset.path.replace(/\.png$/, '.svg')}`)).status).toBe(404)
    expect((await fetch(`${base()}/v1/public/brand/${'0'.repeat(32)}.png`)).status).toBe(404)
    expect((await fetch(`${base()}/v1/public/brand/not-a-hash.png`)).status).toBe(404)
  })

  it('REGRESSION: a save after an upload must not wipe it — the response carries the merged brand', async () => {
    // PATCH replaces the whole jsonb from the form's state. The upload response returns the FULL
    // merged branding precisely so the page can reseat its form before the user's next Save; a
    // client that saved a stale form would erase the image it had just uploaded, and succeed.
    await req('/v1/tenant/branding', t1Token, 'PATCH', { productName: 'Keep Me', primary: '#abcdef' })
    const { branding } = (await (await upload(t1Token, 'logo', 'image/png', png(40, 40))).json()) as { branding: Record<string, string> }
    expect(branding.productName).toBe('Keep Me') // the upload merged, it did not replace
    expect(branding.primary).toBe('#abcdef')

    const saved = await req('/v1/tenant/branding', t1Token, 'PATCH', branding)
    expect(saved.status).toBe(200)
    const after = (await (await req('/v1/tenant/branding', t1Token)).json()) as { branding: Record<string, string> }
    expect(after.branding.logoUrl).toBe(branding.logoUrl)
  })

  it('removal clears the branding key, but only while it still points at that file', async () => {
    const { asset } = (await (await upload(t1Token, 'logo', 'image/png', png(48, 48))).json()) as { asset: { path: string } }
    // the tenant then types their own URL over the upload
    await req('/v1/tenant/branding', t1Token, 'PATCH', { logoUrl: 'https://cdn.t1.test/own.png' })
    expect((await req('/v1/tenant/branding/asset/logo', t1Token, 'DELETE')).status).toBe(200)
    const kept = (await (await req('/v1/tenant/branding', t1Token)).json()) as { branding: { logoUrl?: string } }
    expect(kept.branding.logoUrl).toBe('https://cdn.t1.test/own.png') // tidying up the file is not a request to drop their URL
    expect((await assetsOf(t1Token)).some((a) => a.slot === 'logo')).toBe(false)
    expect((await fetch(`${base()}${asset.path}`)).status).toBe(404)

    // …and when branding DOES still point at it, the key goes too, rather than leaving a dead image
    const again = (await (await upload(t1Token, 'logo', 'image/png', png(50, 50))).json()) as { branding: { logoUrl: string } }
    expect(again.branding.logoUrl).toMatch(/^\/v1\/public\/brand\//)
    await req('/v1/tenant/branding/asset/logo', t1Token, 'DELETE')
    const gone = (await (await req('/v1/tenant/branding', t1Token)).json()) as { branding: { logoUrl?: string } }
    expect(gone.branding.logoUrl).toBeUndefined()
    expect((await req('/v1/tenant/branding/asset/logo', t1Token, 'DELETE')).status).toBe(404)
  })

  it('gives the manifest a real icon declaration, which is what makes the PWA installable', async () => {
    await verified(t1Token, 'pwa.t1.test')
    const { asset } = (await (await upload(t1Token, 'favicon', 'image/png', png(192, 192))).json()) as { asset: { path: string } }
    const m = (await (await fetch(`${base()}/v1/public/manifest.webmanifest`, { headers: { 'x-forwarded-host': 'pwa.t1.test' } })).json()) as
      { icons: { src: string; sizes: string; type: string }[] }
    // before this, an icon could only ever be declared `sizes: 'any'` — a guess Chrome will not
    // accept as install-worthy. An uploaded file is the one case where we KNOW.
    expect(m.icons[0]).toEqual({ src: asset.path, sizes: '192x192', type: 'image/png' })
    expect(JSON.stringify(m)).not.toContain('orbetra')
  })

  it('one tenant cannot upload into another, and a viewer cannot upload at all', async () => {
    const before = await assetsOf(t2Token)
    const { asset } = (await (await upload(t1Token, 'logo', 'image/png', png(60, 60))).json()) as { asset: { path: string } }
    const after = await assetsOf(t2Token)
    expect(after).toEqual(before) // T1's upload is invisible in T2's own settings
    expect(after.some((a) => a.path === asset.path)).toBe(false)

    const viewer = await mintTestToken({ userId: '00000000-0000-0000-0000-0000000000aa', tenantId: t1, role: 'viewer' })
    expect((await upload(viewer, 'logo', 'image/png', png(8, 8))).status).toBe(403)
    expect((await req('/v1/tenant/branding/asset/logo', viewer, 'DELETE')).status).toBe(403)
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

/**
 * Readiness gating (plan W2) — a reseller may not create an AUDIENCE before their customers have
 * somewhere to arrive. The founder's framing: a TSP account is set up only once the customer has
 * finished configuring it, and until this existed a half-configured one served customers while the
 * platform quietly supplied the missing halves from its own identity.
 */
describe('W2 readiness gates the first action that creates an audience', () => {
  const verified = async (token: string, domain: string): Promise<void> => {
    const created = (await (await req('/v1/tenant/domains', token, 'POST', { domain })).json()) as { id: string; txtToken: string }
    txtRecords.set(domain, [['orbetra-verify=' + created.txtToken]])
    await req(`/v1/tenant/domains/${created.id}/verify`, token, 'POST')
  }

  it('a reseller with no verified host cannot create a sub-account, and is told why', async () => {
    const s = await seedUser({ databaseUrl, email: 'ready-a@t.test', password: 'password12', role: 'tsp_admin', tenantName: 'NotReady' })
    const token = await mintTestToken({ userId: s.userId, tenantId: s.tenantId, role: 'tsp_admin' })

    const r = (await (await req('/v1/tenant/readiness', token)).json()) as { mode: string; ready: boolean; hardBlockers: string[] }
    expect(r).toMatchObject({ mode: 'unconfigured', ready: false, hardBlockers: ['no_verified_domain'] })

    const res = await req('/v1/accounts', token, 'POST', { name: 'First customer' })
    expect(res.status).toBe(403)
    // the refusal NAMES what is missing — a bare 403 would leave the operator guessing
    expect(JSON.stringify(await res.json())).toContain('no_verified_domain')

    // …and the same for a seat, which carries no entitlement of its own — so the 403 here can ONLY
    // be readiness, and the body has to say so or the assertion would accept any refusal at all
    const seat = await req('/v1/users', token, 'POST', { email: 'x@t.test', password: 'password12', role: 'viewer', accountId: null })
    expect(seat.status).toBe(403)
    expect(JSON.stringify(await seat.json())).toContain('no_verified_domain')
  })

  it('verifying a host unlocks it — the gate is the configuration, not a flag someone flips', async () => {
    const s = await seedUser({ databaseUrl, email: 'ready-b@t.test', password: 'password12', role: 'tsp_admin', tenantName: 'GetsReady' })
    const token = await mintTestToken({ userId: s.userId, tenantId: s.tenantId, role: 'tsp_admin' })
    expect((await req('/v1/accounts', token, 'POST', { name: 'Too early' })).status).toBe(403)

    await verified(token, 'fleet.getsready.test')

    const r = (await (await req('/v1/tenant/readiness', token)).json()) as { mode: string; ready: boolean }
    expect(r).toMatchObject({ mode: 'own_domain', ready: true })
    expect((await req('/v1/accounts', token, 'POST', { name: 'Now fine' })).status).toBe(201)
  })

  it('★ a platform_admin is never gated — our own operators are not a reseller', async () => {
    // Our own tenant is a tsp_* row with no verified domain, so without the role exemption the gate
    // would refuse OUR operators the moment they created a user. What readiness protects — a
    // reseller's customers seeing our brand — cannot happen when we ARE the brand.
    const s = await seedUser({ databaseUrl, email: 'ready-d@t.test', password: 'password12', role: 'tsp_admin', tenantName: 'PlatformSide' })
    const pa = await mintTestToken({ userId: s.userId, tenantId: s.tenantId, role: 'platform_admin' })
    const tspToken = await mintTestToken({ userId: s.userId, tenantId: s.tenantId, role: 'tsp_admin' })

    // same unready tenant, two roles: the reseller is refused, our operator is not
    expect((await req('/v1/accounts', tspToken, 'POST', { name: 'Blocked' })).status).toBe(403)
    const asPlatform = await req('/v1/accounts', pa, 'POST', { name: 'Allowed' })
    expect(asPlatform.status).toBe(201)
  })

  it('★ a DIRECT customer is never gated — our brand is the correct brand for them', async () => {
    // Without the entitlement check this would lock paying Direct customers out of creating accounts,
    // which is a far worse outcome than the leak it guards against.
    const s = await seedUser({ databaseUrl, email: 'ready-c@t.test', password: 'password12', role: 'tsp_admin', tenantName: 'DirectCo', plan: 'direct_10' })
    const token = await mintTestToken({ userId: s.userId, tenantId: s.tenantId, role: 'tsp_admin' })

    const r = (await (await req('/v1/tenant/readiness', token)).json()) as { mode: string; ready: boolean }
    expect(r).toMatchObject({ mode: 'not_white_label', ready: true })

    // Asserted on /v1/users, NOT /v1/accounts. A Direct plan has no `subAccounts` entitlement, so a
    // create there is refused by the plan gate BEFORE requireReady ever runs — an assertion on it
    // passes with the exemption removed and therefore proves nothing. A seat carries no entitlement,
    // which makes it the only route where a Direct tenant actually meets the readiness gate. This
    // tenant has no verified domain either, so a 201 can only mean the exemption held.
    const seat = await req('/v1/users', token, 'POST', { email: 'direct-seat@t.test', password: 'password12', role: 'viewer', accountId: null })
    expect(seat.status).toBe(201)
  })

  it('a seat cannot be re-pointed at a new person, so PATCH needs no gate of its own', async () => {
    // The obvious escape from a POST-only gate: every tsp_* tenant owns at least its own admin seat,
    // so PATCHing that seat's address would hand the workspace to a human who has never seen it.
    // It is closed by the SCHEMA — userUpdateSchema has no `email` — not by a check, which is why
    // this asserts the shape rather than a 403. If `email` is ever added there, this test fails and
    // the gate goes in with it.
    const s = await seedUser({ databaseUrl, email: 'ready-e@t.test', password: 'password12', role: 'tsp_admin', tenantName: 'PatchEscape' })
    const token = await mintTestToken({ userId: s.userId, tenantId: s.tenantId, role: 'tsp_admin' })

    await req(`/v1/users/${s.userId}`, token, 'PATCH', { email: 'somebody-else@t.test' })
    const after = (await (await req(`/v1/users/${s.userId}`, token)).json()) as { email: string }
    expect(after.email).toBe('ready-e@t.test')
  })

  it('★ only the reseller may read their own setup state', async () => {
    // The answer describes the RESELLER's configuration — "no verified domain", "on ours your
    // customers see our hostname" — in sentences that only parse if you know a platform exists
    // behind the product. An account-scoped reader is their customer's staff.
    const s = await seedUser({ databaseUrl, email: 'ready-f@t.test', password: 'password12', role: 'tsp_admin', tenantName: 'WhoAsks', accountName: 'Cust' })
    const admin = await mintTestToken({ userId: s.userId, tenantId: s.tenantId, role: 'tsp_admin' })
    expect((await req('/v1/tenant/readiness', admin)).status).toBe(200)

    for (const tok of [
      await mintTestToken({ userId: 'v1', tenantId: s.tenantId, role: 'viewer' }),
      await mintTestToken({ userId: 'm1', tenantId: s.tenantId, role: 'account_manager', accountId: 'acc-x' }),
      await mintTestToken({ userId: 'a1', tenantId: s.tenantId, role: 'tsp_admin', accountId: 'acc-x' }),
    ]) {
      expect((await req('/v1/tenant/readiness', tok)).status).toBe(403)
    }
  })

  it('★ an account-scoped caller hears the refusal, never the reseller’s reasons', async () => {
    // An admin PINNED to one account administers that customer, not the workspace — in a reseller's
    // tenant that is the customer's own administrator. They meet the gate (creating users is a
    // tenant-admin action, and the pin does not change the role), and what they must not receive is
    // the blocker list: that is a fact about the RESELLER's setup, one layer above anything they are
    // supposed to know exists.
    const s = await seedUser({ databaseUrl, email: 'ready-g@t.test', password: 'password12', role: 'tsp_admin', tenantName: 'QuietRefusal', accountName: 'Cust' })
    const acct = (await db.accounts.list({ tenantId: s.tenantId }))[0]!
    const pinned = await mintTestToken({ userId: 'm2', tenantId: s.tenantId, role: 'tsp_admin', accountId: acct.id })

    const res = await req('/v1/users', pinned, 'POST', { email: 'seat@t.test', password: 'password12', role: 'viewer', accountId: acct.id })
    expect(res.status).toBe(403)
    const bodyText = JSON.stringify(await res.json())
    expect(bodyText).toContain('not_ready')
    // …the reason is withheld: the unpinned reseller above gets it, this reader does not
    expect(bodyText).not.toContain('no_verified_domain')
  })
})

/**
 * The tenant's own sending identity (ADR-036, audit W-3).
 *
 * The last vendor-named line in a reseller's mail. Everything inside the message was already theirs
 * — logo, colours, links, display name — while `From:` read `hello@orbetra.com` on every activation,
 * every reset and every alert, because MAIL_FROM is one process-wide value every tenant borrowed.
 *
 * Read against a REAL Postgres, and every assertion about which rows count as verified lives here
 * rather than against a fake, because the send path's predicate is the whole safety property.
 */
describe('W3 tenant sending domain', () => {
  /** the address the SEND path would use — the same query the worker runs (notify/senderAddress.ts) */
  const sendsAs = async (tenantId: string): Promise<string | null> => {
    const r = await pool.query<{ address: string }>(
      `SELECT mailbox || '@' || domain AS address FROM tenant_sending_domains
        WHERE "tenantId" = $1 AND "verifiedAt" IS NOT NULL LIMIT 1`,
      [tenantId],
    )
    return r.rows[0]?.address ?? null
  }
  /** create the row, then publish the ownership TXT the tenant is told to add */
  const setup = async (token: string, domain: string, mailbox: string) => {
    const created = (await (await req('/v1/tenant/sending-domain', token, 'POST', { domain, mailbox })).json()) as { ownershipRecord: { name: string; value: string } }
    txtRecords.set(created.ownershipRecord.name, [[created.ownershipRecord.value]])
    return created
  }

  beforeEach(async () => {
    sesState.calls = []
    sesState.status = 'pending'
    sesState.failWith = null
    txtRecords.clear()
    // one row per tenant, and several of these tests deliberately create one for T2 — without this
    // a later test reads a neighbour's leftovers and the isolation assertion passes or fails by
    // execution order rather than by anything the code does
    await pool.query('DELETE FROM tenant_sending_domains')
  })

  it('starts empty, and reports whether the platform can do this at all', async () => {
    // `configured` rides on the LOAD so the card can say the feature is unavailable before asking a
    // reseller to fill in a domain — learning it from a 503 on submit wastes their time
    const res = await req('/v1/tenant/sending-domain', t1Token)
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ configured: true, identity: null })
  })

  it('★ creating one asks SES for NOTHING — it hands back an ownership record first', async () => {
    // SES answers about a DOMAIN and never about who asked, so nothing is created in our account
    // until this tenant has proved the zone is theirs. Otherwise a tenant could pre-register (or
    // squat) identities for domains they do not control.
    const res = await req('/v1/tenant/sending-domain', t1Token, 'POST', { domain: 'klientas.lt', mailbox: 'alertai' })
    expect(res.status).toBe(201)
    const body = (await res.json()) as { address: string; status: string; ownershipRecord: { name: string; value: string }; dkimRecords: unknown[] }
    expect(body.address).toBe('alertai@klientas.lt')
    expect(body.ownershipRecord.name).toBe('_orbetra-verify.klientas.lt')
    expect(body.ownershipRecord.value).toMatch(/^[0-9a-f]{32}$/)
    expect(body.dkimRecords).toEqual([]) // no selectors yet — SES has not been asked
    expect(sesState.calls).toEqual([])
  })

  it('★ verify refuses while the ownership record is absent, and still asks SES nothing', async () => {
    await req('/v1/tenant/sending-domain', t1Token, 'POST', { domain: 'klientas.lt', mailbox: 'alertai' })
    const res = await req('/v1/tenant/sending-domain/verify', t1Token, 'POST')
    expect(res.status).toBe(400)
    expect(sesState.calls).toEqual([])
    expect(await sendsAs(t1)).toBeNull()
  })

  it('ownership proved ⇒ the identity is created and the three DKIM records appear', async () => {
    await setup(t1Token, 'klientas.lt', 'alertai')
    const res = await req('/v1/tenant/sending-domain/verify', t1Token, 'POST')
    const body = (await res.json()) as { status: string; dkimRecords: { name: string; value: string }[] }
    expect(body.status).toBe('pending')
    // the name carries the TENANT's domain, the target carries ours — the half people transpose
    expect(body.dkimRecords).toEqual([
      { name: 'tok1._domainkey.klientas.lt', value: 'tok1.dkim.amazonses.com' },
      { name: 'tok2._domainkey.klientas.lt', value: 'tok2.dkim.amazonses.com' },
      { name: 'tok3._domainkey.klientas.lt', value: 'tok3.dkim.amazonses.com' },
    ])
    expect(sesState.calls).toEqual([{ op: 'create', domain: 'klientas.lt' }])
  })

  it('★ a PENDING identity does not change what the tenant sends as', async () => {
    // sending as a domain whose DKIM records are not published fails DMARC and lands the customer's
    // alerts in spam. Unverified must never become unsent.
    await setup(t1Token, 'klientas.lt', 'alertai')
    await req('/v1/tenant/sending-domain/verify', t1Token, 'POST')
    expect(await sendsAs(t1)).toBeNull()
  })

  it('★ once SES reports SUCCESS, the send path picks the address up', async () => {
    await setup(t1Token, 'klientas.lt', 'alertai')
    await req('/v1/tenant/sending-domain/verify', t1Token, 'POST') // creates the identity
    sesState.status = 'verified'
    const body = (await (await req('/v1/tenant/sending-domain/verify', t1Token, 'POST')).json()) as { status: string; verifiedAt: string | null }
    expect(body.status).toBe('verified')
    expect(body.verifiedAt).not.toBeNull()
    expect(await sendsAs(t1)).toBe('alertai@klientas.lt')
  })

  it('★★ another tenant cannot adopt a domain this one verified, even though SES says it is verified', async () => {
    // THE hole this flow exists to close. SES answers about the domain: for T2 asking about T1's
    // domain the answer is "verified", and a first cut of this feature took that as permission —
    // two HTTP calls to send DKIM-signed, DMARC-aligned mail as somebody else's company, to any
    // free-text recipient list. T2 controls no DNS in that zone, so the ownership check refuses.
    await setup(t1Token, 'klientas.lt', 'alertai')
    await req('/v1/tenant/sending-domain/verify', t1Token, 'POST')
    sesState.status = 'verified'
    await req('/v1/tenant/sending-domain/verify', t1Token, 'POST')
    expect(await sendsAs(t1)).toBe('alertai@klientas.lt')

    await req('/v1/tenant/sending-domain', t2Token, 'POST', { domain: 'klientas.lt', mailbox: 'billing' })
    const stolen = await req('/v1/tenant/sending-domain/verify', t2Token, 'POST')
    expect(stolen.status).toBe(400) // no ownership TXT for T2's token
    expect(await sendsAs(t2)).toBeNull()
    expect(await sendsAs(t1)).toBe('alertai@klientas.lt') // …and T1 is untouched
  })

  it('★ our own domain is never a tenant to send from', async () => {
    // MAIL_FROM is a verified identity in this same SES account, so without this a reseller could
    // claim it and send as `security@<our domain>`
    const res = await req('/v1/tenant/sending-domain', t1Token, 'POST', { domain: 'acme.orbetra.test', mailbox: 'security' })
    expect(res.status).toBe(400)
    expect(sesState.calls).toEqual([])
  })

  it('★ replacing the domain drops the old verification AND the abandoned identity', async () => {
    await setup(t1Token, 'klientas.lt', 'alertai')
    await req('/v1/tenant/sending-domain/verify', t1Token, 'POST')
    sesState.status = 'verified'
    await req('/v1/tenant/sending-domain/verify', t1Token, 'POST')
    expect(await sendsAs(t1)).toBe('alertai@klientas.lt')
    sesState.calls = []

    await req('/v1/tenant/sending-domain', t1Token, 'POST', { domain: 'kitas.lt', mailbox: 'info' })
    // the new domain has proved nothing yet…
    expect(await sendsAs(t1)).toBeNull()
    // …and the identity nobody references now is torn down rather than left to consume the account's
    // quota (10 000, and this route has no cap of its own)
    expect(sesState.calls).toEqual([{ op: 'remove', domain: 'klientas.lt' }])
  })

  it('deleting stops the sending immediately, and asks SES to drop the identity', async () => {
    await setup(t1Token, 'klientas.lt', 'alertai')
    await req('/v1/tenant/sending-domain/verify', t1Token, 'POST')
    sesState.status = 'verified'
    await req('/v1/tenant/sending-domain/verify', t1Token, 'POST')
    sesState.calls = []

    expect((await req('/v1/tenant/sending-domain', t1Token, 'DELETE')).status).toBe(200)
    expect(await sendsAs(t1)).toBeNull()
    expect(sesState.calls).toEqual([{ op: 'remove', domain: 'klientas.lt' }])
    expect((await req('/v1/tenant/sending-domain', t1Token, 'DELETE')).status).toBe(404)
  })

  it('★ a delete does NOT tear down an identity another tenant still stands on', async () => {
    // only VERIFIED rows are globally exclusive, so two tenants can hold pending rows for one
    // domain. Removing the shared identity would stop the OTHER tenant's mail — "unverified becomes
    // unsent", arriving from a third party.
    await setup(t1Token, 'klientas.lt', 'alertai')
    await req('/v1/tenant/sending-domain/verify', t1Token, 'POST') // T1 creates the identity
    await req('/v1/tenant/sending-domain', t2Token, 'POST', { domain: 'klientas.lt', mailbox: 'billing' })
    await pool.query(`UPDATE tenant_sending_domains SET "sesIdentity" = 'klientas.lt' WHERE "tenantId" = $1`, [t2])
    sesState.calls = []

    expect((await req('/v1/tenant/sending-domain', t1Token, 'DELETE')).status).toBe(200)
    expect(sesState.calls).toEqual([]) // T2 still references it
  })

  it('an AWS fault is 502, never a 400 blaming the hostname the tenant typed', async () => {
    // a broken IAM policy and an AWS outage are OURS; telling the reseller to check their domain
    // sends them to re-type something that was never the problem
    await setup(t1Token, 'klientas.lt', 'alertai')
    sesState.failWith = 'AccessDeniedException'
    expect((await req('/v1/tenant/sending-domain/verify', t1Token, 'POST')).status).toBe(502)
  })

  it('rejects a mailbox that could add a header line, and normalises case rather than refusing it', async () => {
    for (const mailbox of ['a b', 'a@b', 'a"b', 'a\nb', '', '.leading', 'trailing.']) {
      const res = await req('/v1/tenant/sending-domain', t1Token, 'POST', { domain: 'klientas.lt', mailbox })
      expect(res.status, JSON.stringify(mailbox)).toBe(400)
    }
    // DNS and mailbox names are case-insensitive; an API client typing capitals gets a working row,
    // not a bare 400 from a rule the route relaxes two lines later
    const ok = await req('/v1/tenant/sending-domain', t1Token, 'POST', { domain: 'Klientas.LT', mailbox: 'Alertai' })
    expect(ok.status).toBe(201)
    expect(((await ok.json()) as { address: string }).address).toBe('alertai@klientas.lt')
  })

  it('★ one tenant cannot read or change another tenant sending identity', async () => {
    await setup(t1Token, 'klientas.lt', 'alertai')
    expect(((await (await req('/v1/tenant/sending-domain', t2Token)).json()) as { identity: unknown }).identity).toBeNull()
    expect((await req('/v1/tenant/sending-domain', t2Token, 'DELETE')).status).toBe(404)
    const mine = (await (await req('/v1/tenant/sending-domain', t1Token)).json()) as { identity: { domain: string } }
    expect(mine.identity.domain).toBe('klientas.lt')
  })

  it('is admin-only, and tenant-wide on every one of the four routes', async () => {
    const viewer = await mintTestToken({ userId: 'v-sd', tenantId: t1, role: 'viewer' })
    const pinned = await mintTestToken({ userId: 'p-sd', tenantId: t1, role: 'tsp_admin', accountId: 'acc-x' })
    expect((await req('/v1/tenant/sending-domain', viewer)).status).toBe(403)
    for (const [method, body] of [['GET', undefined], ['POST', { domain: 'x.lt', mailbox: 'a' }], ['DELETE', undefined]] as const) {
      expect((await req('/v1/tenant/sending-domain', pinned, method, body)).status, method).toBe(403)
    }
    expect((await req('/v1/tenant/sending-domain/verify', pinned, 'POST')).status).toBe(403)
  })
})
