import { execFileSync } from 'node:child_process'
import { createServer } from 'node:http'
import { resolve } from 'node:path'
import { serve } from '@hono/node-server'
import { Redis } from 'ioredis'
import { GenericContainer, Wait, type StartedTestContainer } from 'testcontainers'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { createDb, createPool, type Db, type Pool } from '@orbetra/db'

import { seedProfiles } from '../../../packages/db/seed/profiles.js'
import { seedUser } from '../../../packages/db/seed/users.js'
import { createApp } from '../src/app.js'
import { mintTestToken, TEST_JWT_SECRET } from './helpers/auth.js'

const PG_IMAGE = 'timescale/timescaledb-ha:pg16'
const DB_PKG = resolve(import.meta.dirname, '../../../packages/db')

let pg: StartedTestContainer
let redisC: StartedTestContainer
let redis: Redis
let db: Db
let pool: Pool
let port: number
let httpServer: ReturnType<typeof createServer>
let t1Token: string
let t2Token: string
let viewerToken: string
let deviceId: string
let retiredId: string
/** A model whose wiki page has NO CAN block — the `supported:false` case. */
let noCanDeviceId: string

const base = () => `http://127.0.0.1:${port}`
const req = (path: string, token: string, method = 'GET', bodyObj?: unknown) =>
  fetch(`${base()}${path}`, { method, headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, ...(bodyObj !== undefined ? { body: JSON.stringify(bodyObj) } : {}) })

beforeAll(async () => {
  ;[pg, redisC] = await Promise.all([
    new GenericContainer(PG_IMAGE).withEnvironment({ POSTGRES_PASSWORD: 'test', POSTGRES_DB: 'orbetra' }).withExposedPorts(5432).withWaitStrategy(Wait.forLogMessage(/database system is ready to accept connections/, 2)).withStartupTimeout(240_000).start(),
    new GenericContainer('redis:7-alpine').withExposedPorts(6379).withWaitStrategy(Wait.forLogMessage(/Ready to accept connections/)).start(),
  ])
  const databaseUrl = `postgresql://postgres:test@${pg.getHost()}:${pg.getMappedPort(5432)}/orbetra`
  execFileSync('pnpm', ['exec', 'prisma', 'migrate', 'deploy'], { cwd: DB_PKG, env: { ...process.env, DATABASE_URL: databaseUrl } })
  redis = new Redis(redisC.getMappedPort(6379), redisC.getHost(), { maxRetriesPerRequest: null })
  db = createDb(databaseUrl)
  pool = createPool(databaseUrl)
  await seedProfiles(databaseUrl)
  const s1 = await seedUser({ databaseUrl, email: 'a@c1.test', password: 'password12', role: 'tsp_admin', tenantName: 'C1', accountName: 'Fleet' })
  const s2 = await seedUser({ databaseUrl, email: 'a@c2.test', password: 'password12', role: 'tsp_admin', tenantName: 'C2' })
  const acct1 = (await db.accounts.list({ tenantId: s1.tenantId }))[0]!.id
  const scope1 = { tenantId: s1.tenantId, accountId: acct1 }
  // NAME the model: this spec asserts the onboarding sheet's SMS text, whose password prefix is
  // per-platform (FMB two spaces, FT one). `list()[0]` is alphabetically first — atc700, an FT
  // model — so the expectation tracked catalogue ordering rather than a decision.
  const profile = (await db.profiles.list()).find((p) => p.key === 'fmb120')!
  const dev = await db.devices.create(scope1, { userId: s1.userId }, { imei: '356307042440010', name: 'Truck', profileId: profile.id, accountId: acct1 })
  deviceId = dev.id.toString()
  const rdev = await db.devices.create(scope1, { userId: s1.userId }, { imei: '356307042440011', name: 'Old', profileId: profile.id, accountId: acct1 })
  retiredId = rdev.id.toString()
  await db.devices.retire(scope1, { userId: s1.userId }, retiredId)
  // ATC700's parameter page carries no CAN block at all (66 of the 105 models we hold pages for
  // do not) — a device the CAN panel must answer "not supported" for, not "everything is off".
  const noCanProfile = (await db.profiles.list()).find((p) => p.key === 'atc700')!
  const noCanDev = await db.devices.create(scope1, { userId: s1.userId }, { imei: '356307042440012', name: 'Asset', profileId: noCanProfile.id, accountId: acct1 })
  noCanDeviceId = noCanDev.id.toString()

  t1Token = await mintTestToken({ userId: s1.userId, tenantId: s1.tenantId, role: 'tsp_admin' })
  t2Token = await mintTestToken({ userId: s2.userId, tenantId: s2.tenantId, role: 'tsp_admin' })
  viewerToken = await mintTestToken({ userId: '00000000-0000-0000-0000-0000000000cc', tenantId: s1.tenantId, accountId: acct1, role: 'viewer' })

  const app = createApp({ redis, redisSub: redis, db, pool, onboarding: { host: 'orbetra.com', port: 5027 }, jwtSecret: TEST_JWT_SECRET, jwtTtlS: 900, refreshTtlS: 3600, ticketTtlS: 30, lockout: { maxFails: 100, windowS: 900 }, secureCookies: false, trustProxy: false, getRemoteAddr: () => '127.0.0.1' })
  httpServer = serve({ fetch: app.fetch, port: 0, createServer }) as ReturnType<typeof createServer>
  port = await new Promise<number>((r) => httpServer.on('listening', () => r((httpServer.address() as { port: number }).port)))
}, 300_000)

afterAll(async () => {
  httpServer?.closeAllConnections?.()
  await new Promise<void>((r) => httpServer.close(() => r()))
  await pool.end(); await db.$disconnect(); await redis.quit(); await Promise.all([pg.stop(), redisC.stop()])
})

describe('E08-2 Codec-12 commands API', () => {
  it('queues a command → 201, and pushes it to the ingest transport queue + active set', async () => {
    const res = await req(`/v1/devices/${deviceId}/commands`, t1Token, 'POST', { text: 'getinfo' })
    expect(res.status).toBe(201)
    const cmd = (await res.json()) as { id: string; status: string; text: string }
    expect(cmd).toMatchObject({ status: 'queued', text: 'getinfo' })
    const pending = await redis.lrange(`cmd:pending:${deviceId}`, 0, -1)
    expect(pending.map((p) => JSON.parse(p) as { id: string }).some((p) => p.id === cmd.id)).toBe(true)
    expect(await redis.sismember('cmd:active', deviceId)).toBe(1)
    // and it is retrievable, scoped
    expect((await req(`/v1/commands/${cmd.id}`, t1Token)).status).toBe(200)
  })

  it('a retired device cannot be commanded (400)', async () => {
    expect((await req(`/v1/devices/${retiredId}/commands`, t1Token, 'POST', { text: 'getinfo' })).status).toBe(400)
  })

  it('isolation: another tenant cannot command the device (404), nor read its command', async () => {
    expect((await req(`/v1/devices/${deviceId}/commands`, t2Token, 'POST', { text: 'getinfo' })).status).toBe(404)
    const mine = (await (await req(`/v1/devices/${deviceId}/commands`, t1Token, 'POST', { text: 'getver' })).json()) as { id: string }
    expect((await req(`/v1/commands/${mine.id}`, t2Token)).status).toBe(404)
  })

  it('a viewer cannot send commands (403 — hardware control is a write)', async () => {
    expect((await req(`/v1/devices/${deviceId}/commands`, viewerToken, 'POST', { text: 'getinfo' })).status).toBe(403)
    // but a viewer CAN read the command list/status
    expect((await req(`/v1/devices/${deviceId}/commands`, viewerToken)).status).toBe(200)
  })

  it('rejects an empty command body (400)', async () => {
    expect((await req(`/v1/devices/${deviceId}/commands`, t1Token, 'POST', { text: '' })).status).toBe(400)
  })

  it('onboarding sheet: server SMS points at the configured host, APN appended when passed (V1-nice)', async () => {
    const sheet = (await (await req(`/v1/devices/${deviceId}/onboarding?apn=internet`, viewerToken)).json()) as { smsServer: string; smsApn: string | null; steps: string[] }
    expect(sheet.smsServer).toBe('  setparam 2004:orbetra.com;2005:5027;2006:0') // 2006:0 = protocol TCP (2003 is the APN password)
    expect(sheet.smsApn).toBe('  setparam 2001:internet')
    expect(sheet.steps.length).toBeGreaterThan(0)
    // no apn → no APN SMS
    const noApn = (await (await req(`/v1/devices/${deviceId}/onboarding`, viewerToken)).json()) as { smsApn: string | null }
    expect(noApn.smsApn).toBeNull()
    // an APN carrying an SMS separator is rejected end-to-end (review HIGH — injection)
    const evil = (await (await req(`/v1/devices/${deviceId}/onboarding?apn=x;2004:evil.com`, viewerToken)).json()) as { smsApn: string | null }
    expect(evil.smsApn).toBeNull()
    // cross-tenant device → 404
    expect((await req(`/v1/devices/${deviceId}/onboarding`, t2Token)).status).toBe(404)
  })
})

/**
 * Tracking settings — the customer-facing face of setparam.
 *
 * The properties worth defending: a value the device never confirmed is never presented as its
 * state, a change is 202 (queued) and not 200 (saved), and every write is followed by the getparam
 * that will tell us whether it took. On 2026-08-18 a setparam was accepted, queued, delivered and
 * had no effect at all — reporting that as success is the failure this route is shaped around.
 */
describe('device tracking settings', () => {
  it('GET lists what this model can be set to, and admits it knows no current values yet', async () => {
    const res = await req(`/v1/devices/${deviceId}/settings`, t1Token)
    expect(res.status).toBe(200)
    const body = (await res.json()) as {
      available: { key: string; min: number; max: number; factory: number; profile: string }[]
      current: Record<string, { value: number | null; checkedAt: string | null; requested: number | null; state: string | null }>
      profile: string
    }
    const send = body.available.find((s) => s.key === 'movingSendPeriod')!
    expect(send.min).toBe(2) // never 0 — that means "do not send"
    expect(send.max).toBe(120)
    expect(send.factory).toBe(120)
    // nothing has been read off the device, so nothing is claimed about it
    expect(body.current['movingSendPeriod']).toEqual({ value: null, checkedAt: null, requested: null, state: null })
    // and the UI is told which network profile these apply to
    expect(body.profile).toBe('home')
  })

  it('POST queues ONE setparam with every change, then the getparam that verifies it', async () => {
    const res = await req(`/v1/devices/${deviceId}/settings`, t1Token, 'POST', {
      changes: { movingSendPeriod: 30, movingByDistance: 50 },
    })
    // 202, not 200: the tracker has not seen this yet, and a parked device connects on its own
    // schedule — a command sat queued for an hour on the day this was designed.
    expect(res.status).toBe(202)
    const body = (await res.json()) as { queued: boolean; commandId: string; verifyCommandId: string; text: string }
    expect(body.queued).toBe(true)
    expect(body.text).toMatch(/^setparam /)
    expect(body.text).toContain('10055:30')
    expect(body.text).toContain('10051:50')

    // both commands exist, and the verification is queued AFTER the write — the pending list is FIFO
    const queued = await redis.lrange(`cmd:pending:${deviceId}`, 0, -1)
    const texts = queued.map((j) => (JSON.parse(j) as { text: string }).text)
    const setAt = texts.findIndex((t) => t.startsWith('setparam 10055:30'))
    const getAt = texts.findIndex((t) => t.startsWith('getparam'))
    expect(setAt).toBeGreaterThanOrEqual(0)
    expect(getAt).toBeGreaterThan(setAt)
  })

  it('the queued write is reported as WAITING, never as the device’s state', async () => {
    const res = await req(`/v1/devices/${deviceId}/settings`, t1Token)
    const body = (await res.json()) as { current: Record<string, { value: number | null; requested: number | null; state: string | null }> }
    expect(body.current['movingSendPeriod']!.requested).toBe(30)
    expect(body.current['movingSendPeriod']!.state).toBe('waiting')
    expect(body.current['movingSendPeriod']!.value).toBeNull() // the tracker still has not answered
  })

  it('a NEW write drops a queued one for the same parameter — the last instruction wins', async () => {
    /**
     * Live proof, 2026-08-18: a settings command queued at 14:17 was corrected at 14:53 by another
     * route, and when the parked tracker finally connected at 14:54 the STALE command drained and
     * re-applied the value that had just been undone. The vehicle went silent for five hours and
     * the platform reported no fault at all. Commands wait for hours on a parked vehicle — long
     * enough for the customer to change their mind twice.
     */
    await redis.del(`cmd:pending:${deviceId}`)
    const first = await req(`/v1/devices/${deviceId}/settings`, t1Token, 'POST', { changes: { movingSendPeriod: 10 } })
    expect(first.status).toBe(202)
    const firstId = ((await first.json()) as { commandId: string }).commandId

    const second = await req(`/v1/devices/${deviceId}/settings`, t1Token, 'POST', { changes: { movingSendPeriod: 60 } })
    expect(second.status).toBe(202)

    const texts = (await redis.lrange(`cmd:pending:${deviceId}`, 0, -1)).map((j) => (JSON.parse(j) as { text: string }).text)
    const writes = texts.filter((t) => t.startsWith('setparam'))
    expect(writes, 'the superseded write must be gone from the queue').toEqual(['setparam 10055:60'])

    // …and its row must not sit "waiting" for 24 h either
    const row = (await (await req(`/v1/commands/${firstId}`, t1Token)).json()) as { status: string }
    expect(row.status).toBe('expired')
  })

  it('leaves a queued write for a DIFFERENT parameter alone', async () => {
    await redis.del(`cmd:pending:${deviceId}`)
    await req(`/v1/devices/${deviceId}/settings`, t1Token, 'POST', { changes: { movingByDistance: 50 } })
    await req(`/v1/devices/${deviceId}/settings`, t1Token, 'POST', { changes: { movingSendPeriod: 60 } })
    const texts = (await redis.lrange(`cmd:pending:${deviceId}`, 0, -1)).map((j) => (JSON.parse(j) as { text: string }).text)
    expect(texts.filter((t) => t.startsWith('setparam')).sort()).toEqual(['setparam 10051:50', 'setparam 10055:60'])
  })

  it('refuses a value outside what the model accepts, and names the bound', async () => {
    for (const [key, value] of [['movingSendPeriod', 0], ['movingSendPeriod', 121], ['movingByDistance', 5]] as const) {
      const res = await req(`/v1/devices/${deviceId}/settings`, t1Token, 'POST', { changes: { [key]: value } })
      expect(res.status, `${key}=${value}`).toBe(400)
      expect((await res.json() as { detail?: string }).detail).toMatch(/must be an integer between/)
    }
  })

  it('refuses an unknown setting rather than silently ignoring it', async () => {
    const res = await req(`/v1/devices/${deviceId}/settings`, t1Token, 'POST', { changes: { serverHost: 1 } })
    expect(res.status).toBe(400)
    expect((await res.json() as { detail?: string }).detail).toMatch(/unknown setting/)
  })

  it('rejects the whole request when ANY change is invalid — no partial application', async () => {
    const before = await redis.llen(`cmd:pending:${deviceId}`)
    const res = await req(`/v1/devices/${deviceId}/settings`, t1Token, 'POST', {
      changes: { movingSendPeriod: 30, movingByDistance: 999999 },
    })
    expect(res.status).toBe(400)
    // the valid half must not have been queued: a half-applied settings change is worse than none
    expect(await redis.llen(`cmd:pending:${deviceId}`)).toBe(before)
  })

  it('refuses a non-integer and an empty change set', async () => {
    for (const changes of [{ movingSendPeriod: 2.5 }, {}]) {
      const res = await req(`/v1/devices/${deviceId}/settings`, t1Token, 'POST', { changes })
      expect(res.status, JSON.stringify(changes)).toBe(400)
    }
  })

  it('a retired device is refused, and another tenant’s device is a 404 either way', async () => {
    expect((await req(`/v1/devices/${retiredId}/settings`, t1Token, 'POST', { changes: { movingSendPeriod: 30 } })).status).toBe(400)
    expect((await req(`/v1/devices/${deviceId}/settings`, t2Token)).status).toBe(404)
    expect((await req(`/v1/devices/${deviceId}/settings`, t2Token, 'POST', { changes: { movingSendPeriod: 30 } })).status).toBe(404)
  })

  it('a viewer may look but not write — changing tracking density is a write', async () => {
    expect((await req(`/v1/devices/${deviceId}/settings`, viewerToken)).status).toBe(200)
    expect((await req(`/v1/devices/${deviceId}/settings`, viewerToken, 'POST', { changes: { movingSendPeriod: 30 } })).status).toBe(403)
  })
})

/**
 * CAN element priorities — the reason a wired-up vehicle still shows six parameters.
 *
 * Every CAN element ships with its priority parameter at 0 ("do not send"), so a customer with a
 * working bus sees exactly what a customer with no bus sees, and nothing on the screen tells them
 * which of those two they are. The route's job is to name the elements the MODEL has, report what
 * the DEVICE last said about them, and queue a change with the same guarantees as a settings write.
 * https://wiki.teltonika-gps.com/view/FMC150_Parameter_list (LVCAN section)
 */
describe('device CAN element priorities', () => {
  it('GET lists the model\u2019s elements, all off, and says nothing has been read off the device', async () => {
    const res = await req(`/v1/devices/${deviceId}/can`, t1Token)
    expect(res.status).toBe(200)
    const body = (await res.json()) as {
      supported: boolean
      elements: { param: string; name: string; enabled: boolean; priority: number; checkedAt: string | null }[]
    }
    expect(body.supported).toBe(true)
    expect(body.elements.length).toBeGreaterThan(50)
    const speed = body.elements.find((e) => e.param === '45100')!
    expect(speed.name).toBe('Vehicle Speed')
    // 0 is what the element ships as — but `checkedAt` is null, so a client can tell that from
    // "the device told us 0". This is the whole premise of the feature.
    expect(speed).toMatchObject({ enabled: false, priority: 0, checkedAt: null })
  })

  it('a model with no CAN block answers supported:false \u2014 not an empty list that reads as "all off"', async () => {
    const res = await req(`/v1/devices/${noCanDeviceId}/can`, t1Token)
    expect(res.status).toBe(200)
    const body = (await res.json()) as { supported: boolean; elements: unknown[]; reason: string }
    expect(body.supported).toBe(false)
    expect(body.elements).toEqual([])
    // "buy a different tracker" and "click the toggles" are opposite actions; say which one it is
    expect(body.reason).toMatch(/no CAN parameter list/i)
    // …and a write is refused rather than sent to a device that has no such parameter
    const write = await req(`/v1/devices/${noCanDeviceId}/can`, t1Token, 'POST', { changes: { '45100': 2 } })
    expect(write.status).toBe(400)
  })

  it('POST queues ONE setparam with every change, then the getparam that verifies it', async () => {
    await redis.del(`cmd:pending:${deviceId}`)
    const res = await req(`/v1/devices/${deviceId}/can`, t1Token, 'POST', { changes: { '45100': 2, '45140': 1 } })
    expect(res.status).toBe(202) // the tracker has not seen this yet
    const body = (await res.json()) as { queued: boolean; commandId: string; verifyCommandId: string; text: string }
    expect(body.queued).toBe(true)
    expect(body.text).toBe('setparam 45100:2;45140:1')
    expect(body.commandId).not.toBe(body.verifyCommandId)

    const texts = (await redis.lrange(`cmd:pending:${deviceId}`, 0, -1)).map((j) => (JSON.parse(j) as { text: string }).text)
    const setAt = texts.findIndex((t) => t.startsWith('setparam 45100:2'))
    const getAt = texts.findIndex((t) => t.startsWith('getparam 45100'))
    expect(setAt).toBeGreaterThanOrEqual(0)
    expect(getAt).toBeGreaterThan(setAt) // FIFO: the write drains before its verification
    expect(await redis.sismember('cmd:active', deviceId)).toBe(1)
  })

  it('the queued change is visible before the device answers, so a toggle does not snap back', async () => {
    const body = (await (await req(`/v1/devices/${deviceId}/can`, t1Token)).json()) as {
      elements: { param: string; priority: number; requested: number | null; state: string | null }[]
    }
    const speed = body.elements.find((e) => e.param === '45100')!
    expect(speed.requested).toBe(2)
    expect(speed.state).toBe('waiting')
    expect(speed.priority).toBe(0) // the tracker still has not confirmed anything
  })

  it('a NEW write drops a queued one for the same element \u2014 the last instruction wins', async () => {
    await redis.del(`cmd:pending:${deviceId}`)
    const first = await req(`/v1/devices/${deviceId}/can`, t1Token, 'POST', { changes: { '45100': 1 } })
    const firstId = ((await first.json()) as { commandId: string }).commandId
    expect((await req(`/v1/devices/${deviceId}/can`, t1Token, 'POST', { changes: { '45100': 3 } })).status).toBe(202)

    const texts = (await redis.lrange(`cmd:pending:${deviceId}`, 0, -1)).map((j) => (JSON.parse(j) as { text: string }).text)
    expect(texts.filter((t) => t.startsWith('setparam'))).toEqual(['setparam 45100:3'])
    // …and the superseded row must not sit "waiting" for 24 h either
    expect(((await (await req(`/v1/commands/${firstId}`, t1Token)).json()) as { status: string }).status).toBe('expired')
  })

  it('refuses a parameter this model does not carry, rather than sending it to the device', async () => {
    const before = await redis.llen(`cmd:pending:${deviceId}`)
    for (const param of ['45101', '99999', '10055']) {
      // 45101 is the OPERAND id inside 45100's own six-id block — adjacent, and not ours to write
      const res = await req(`/v1/devices/${deviceId}/can`, t1Token, 'POST', { changes: { [param]: 2 } })
      expect(res.status, param).toBe(400)
      expect((await res.json() as { detail?: string }).detail).toMatch(/unknown CAN element/)
    }
    expect(await redis.llen(`cmd:pending:${deviceId}`)).toBe(before)
  })

  it('refuses a priority outside 0..3, and names the bound', async () => {
    for (const value of [-1, 4, 255]) {
      const res = await req(`/v1/devices/${deviceId}/can`, t1Token, 'POST', { changes: { '45100': value } })
      expect(res.status, String(value)).toBe(400)
      expect((await res.json() as { detail?: string }).detail).toMatch(/priority must be an integer between 0 and 3/)
    }
    // a non-integer and an empty change set never reach the model check
    for (const changes of [{ '45100': 1.5 }, {}, { notAnId: 2 }]) {
      expect((await req(`/v1/devices/${deviceId}/can`, t1Token, 'POST', { changes })).status, JSON.stringify(changes)).toBe(400)
    }
  })

  it('rejects the whole request when ANY change is invalid \u2014 no partial application', async () => {
    const before = await redis.llen(`cmd:pending:${deviceId}`)
    const res = await req(`/v1/devices/${deviceId}/can`, t1Token, 'POST', { changes: { '45100': 2, '45140': 9 } })
    expect(res.status).toBe(400)
    expect(await redis.llen(`cmd:pending:${deviceId}`)).toBe(before)
  })

  it('refuses to build a command longer than we send anywhere else', async () => {
    // 83 elements in one setparam would overrun the 512 characters this repo caps a command at;
    // the caller splits the request rather than getting a truncated command the device half-applies
    const all = (await (await req(`/v1/devices/${deviceId}/can`, t1Token)).json()) as { elements: { param: string }[] }
    const changes = Object.fromEntries(all.elements.map((e) => [e.param, 1]))
    const res = await req(`/v1/devices/${deviceId}/can`, t1Token, 'POST', { changes })
    expect(res.status).toBe(400)
    expect((await res.json() as { detail?: string }).detail).toMatch(/too many elements/)
    // …but a batch that fits is accepted
    const half = Object.fromEntries(all.elements.slice(0, 40).map((e) => [e.param, 1]))
    expect((await req(`/v1/devices/${deviceId}/can`, t1Token, 'POST', { changes: half })).status).toBe(202)
  })

  it('a retired device is refused, another tenant sees 404, and a viewer may look but not write', async () => {
    expect((await req(`/v1/devices/${retiredId}/can`, t1Token, 'POST', { changes: { '45100': 2 } })).status).toBe(400)
    expect((await req(`/v1/devices/${deviceId}/can`, t2Token)).status).toBe(404)
    expect((await req(`/v1/devices/${deviceId}/can`, t2Token, 'POST', { changes: { '45100': 2 } })).status).toBe(404)
    expect((await req(`/v1/devices/${deviceId}/can`, viewerToken)).status).toBe(200)
    expect((await req(`/v1/devices/${deviceId}/can`, viewerToken, 'POST', { changes: { '45100': 2 } })).status).toBe(403)
  })
})
