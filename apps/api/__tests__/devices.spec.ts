import { execFileSync } from 'node:child_process'
import { createServer } from 'node:http'
import { resolve } from 'node:path'
import { serve } from '@hono/node-server'
import { Redis } from 'ioredis'
import { GenericContainer, Wait, type StartedTestContainer } from 'testcontainers'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'

import { createDb, type Db } from '@orbetra/db'

import { seedProfiles } from '../../../packages/db/seed/profiles.js'
import { seedUser } from '../../../packages/db/seed/users.js'
import { createApp } from '../src/app.js'
import { reserveDeviceBudget, settleDeviceBudget } from '../src/routes/crud.js'
import { luhnValid, parseCsv } from '../src/routes/deviceImport.js'
import { tenantDevicesKey } from '../src/routes/deviceRegistry.js'
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

let tenantId: string
let accountId: string
let profileId: string
let token: string

const base = () => `http://127.0.0.1:${port}`
const authed = (path: string, method = 'GET', bodyObj?: unknown) =>
  fetch(`${base()}${path}`, {
    method,
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
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

  const seeded = await seedUser({ databaseUrl, email: 'dev-admin@x.test', password: 'password12', role: 'tsp_admin', tenantName: 'DevCo', accountName: 'Fleet' })
  tenantId = seeded.tenantId
  const accounts = await db.accounts.list({ tenantId })
  accountId = accounts[0]!.id
  const profiles = await seedProfiles(databaseUrl)
  profileId = profiles['fmb1xx']!
  token = await mintTestToken({ userId: seeded.userId, tenantId, role: 'tsp_admin' })

  const app = createApp({
    redis, redisSub, db,
    jwtSecret: TEST_JWT_SECRET, jwtTtlS: 900, refreshTtlS: 3600, ticketTtlS: 30,
    lockout: { maxFails: 100, windowS: 900 }, secureCookies: false, trustProxy: false,
    getRemoteAddr: () => '127.0.0.1',
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
  await db.devices.list({ tenantId }).then(async (ds) => {
    for (const d of ds) await db.devices.retire({ tenantId }, { userId: '00000000-0000-0000-0000-000000000000' }, d.id.toString())
  })
})

describe('the device-creation ceiling sanitizes its own knob', () => {
  // The knob can refuse every create on the platform, so the values it accepts matter as much as the
  // ceiling itself. These are the shapes an env var actually arrives in.
  const spentFor = async (t: string): Promise<number> => Number((await redis.get(`devcreate:rl:${t}`)) ?? 0)
  const reserveWith = async (limit: unknown, t: string): Promise<unknown> =>
    reserveDeviceBudget({ redis, deviceCreateLimit: limit } as unknown as Parameters<typeof reserveDeviceBudget>[0], t, 1)

  it('NaN from a typo falls back to the default instead of refusing every tenant', async () => {
    // `Number('abc')` and `Number('10_000')` — the literal form the default is written in — are NaN.
    // Unguarded, every comparison against NaN is false and nobody on the platform can add a device.
    const t = 'tenant-nan'
    await redis.del(`devcreate:rl:${t}`)
    expect(await reserveWith({ max: Number('10_000'), windowS: 3600 }, t)).toEqual({ reserved: 1 })
    expect(await spentFor(t)).toBe(1)
  })

  it('a fractional window falls back — EXPIRE rejects one, and the throw would unmeter the platform', async () => {
    // a throwing script is treated as `degraded`, i.e. fail-open: the ceiling silently absent
    const t = 'tenant-frac'
    await redis.del(`devcreate:rl:${t}`)
    expect(await reserveWith({ max: 5, windowS: 3600.5 }, t)).toEqual({ reserved: 1 })
    expect(await redis.ttl(`devcreate:rl:${t}`)).toBeGreaterThan(0)
  })

  it('max 0 is HONOURED as a freeze, not corrected away', async () => {
    // the one value at that end of the range with a real use: an operator stopping device creation
    // platform-wide. It is also what an empty env var produces, which is stated in the code.
    const t = 'tenant-freeze'
    await redis.del(`devcreate:rl:${t}`)
    const r = await reserveWith({ max: 0, windowS: 60 }, t)
    expect(r).toHaveProperty('retryAfterS')
    expect(await spentFor(t)).toBe(0) // …and the refusal still hands the reservation back
  })
})

describe('device creation is metered per TENANT (audit 2026-08-11 #2)', () => {
  it('a tenant that blows its hourly budget gets 429 — and its neighbour is untouched', async () => {
    // A resource guard, not an anti-squat measure: targeted squatting needs a few hundred specific
    // IMEIs, far under any ceiling a real fleet could live with. What this stops is one trial tenant
    // driving unbounded rows into `devices` from a loop, each taking an IMEI hold platform-wide.
    //
    // The neighbour assertion is the point of the test. A ceiling keyed globally instead of per
    // tenant would turn this guard into the very denial-of-onboarding it exists to bound: one
    // runaway integration and nobody else on the platform can add a device.
    const throttled: string[] = []
    const app = createApp({
      redis, redisSub, db,
      jwtSecret: TEST_JWT_SECRET, jwtTtlS: 900, refreshTtlS: 3600, ticketTtlS: 30,
      lockout: { maxFails: 100, windowS: 900 }, secureCookies: false, trustProxy: false,
      getRemoteAddr: () => '127.0.0.1',
      deviceCreateLimit: { max: 2, windowS: 60 },
      onDeviceCreateThrottled: (why) => throttled.push(why),
    })
    const server = serve({ fetch: app.fetch, port: 0, createServer }) as ReturnType<typeof createServer>
    const p = await new Promise<number>((r) => server.on('listening', () => r((server.address() as { port: number }).port)))
    const spent = async (): Promise<number> => Number((await redis.get(`devcreate:rl:${tenantId}`)) ?? 0)
    // drive the refund path directly: these are the two shapes a live request produces when the key
    // vanishes underneath it (expiry, or an operator DEL) and when more is handed back than is owed

    // Drive the PRODUCTION functions, not a copy of their Lua. An earlier version of this test
    // called `redis.eval(RL_REFUND_SCRIPT, …)` directly and therefore asserted a property of an
    // exported string that nothing proved production used: swapping both real call sites back to
    // `RL_ADD_SCRIPT` with a negative amount — the literal pre-fix defect — left it green.
    const budgetDeps = { redis, deviceCreateLimit: { max: 2, windowS: 60 } } as unknown as Parameters<typeof settleDeviceBudget>[0]
    const settle = (reserved: number, created: number): Promise<void> => settleDeviceBudget(budgetDeps, tenantId, reserved, created)
    const post = (tok: string, imei: string, acct: string) =>
      fetch(`http://127.0.0.1:${p}/v1/devices`, {
        method: 'POST',
        headers: { authorization: `Bearer ${tok}`, 'content-type': 'application/json' },
        body: JSON.stringify({ accountId: acct, profileId, imei, name: imei }),
      })
    try {
      // a REFUSED create is not billed either: this IMEI is held by another tenant, so it 409s and
      // the budget must be untouched — otherwise a bad CSV of foreign IMEIs costs a real onboarding
      const foreign = await seedUser({ databaseUrl, email: 'foreign@x.test', password: 'password12', role: 'tsp_admin', tenantName: 'Foreign Co', accountName: 'FF' })
      const foreignAccount = (await db.accounts.list({ tenantId: foreign.tenantId }))[0]!.id
      await db.devices.create({ tenantId: foreign.tenantId }, { userId: foreign.userId }, { accountId: foreignAccount, profileId, imei: '356307042441009', name: 'theirs' })
      expect((await post(token, '356307042441009', accountId)).status).toBe(409)
      // the reservation is taken atomically and handed straight back, so the key exists at zero.
      // Asserting the VALUE, not the key's absence: what matters is that a refused create costs the
      // tenant nothing, and the reserve-then-refund shape is what makes the ceiling race-free.
      expect(await spent()).toBe(0)

      expect((await post(token, '356307042441001', accountId)).status).toBe(201)
      expect((await post(token, '356307042441002', accountId)).status).toBe(201)
      const over = await post(token, '356307042441003', accountId)
      expect(over.status).toBe(429)
      // a throttled client needs a basis to back off. Asserted as a RANGE, not '60': Retry-After is
      // the key's remaining TTL, so an exact match would require four HTTP round trips with Postgres
      // writes to finish inside the first second — a flake waiting for a loaded CI box.
      const retry = Number(over.headers.get('retry-after'))
      expect(retry).toBeGreaterThan(0)
      expect(retry).toBeLessThanOrEqual(60)
      expect(throttled).toEqual(['limit'])

      // A REJECTED request must not deepen the hole it just reported. Charging on the way in meant
      // 9500 spent + two 1000-row imports that both 429 left the counter at 11500, so the tenant
      // could not add one device by hand for the rest of the hour — the guard punishing the
      // customer for hitting it. Check-then-charge: the 429 above cost nothing.
      expect(await spent()).toBe(2)
      expect((await post(token, '356307042441003', accountId)).status).toBe(429)
      expect(await spent()).toBe(2)

      // A REFUND MUST NOT RESURRECT THE COUNTER. `INCRBY -n` on a missing key creates it at -n, and
      // the window-stamping branch then gives it a fresh full hour — so a refund landing after the
      // key expired, or after on-call ran the `DEL devcreate:rl:<tenantId>` the runbook prescribes
      // mid-onboarding, handed the tenant its whole ceiling again plus n free creates. Measured at
      // -1000 with ttl=3600 on a real Redis before the fix.
      await redis.del(`devcreate:rl:${tenantId}`)
      await settle(1000, 0) // a 1000-row import settling after its window rolled, or after an operator DEL
      expect(await redis.get(`devcreate:rl:${tenantId}`)).toBeNull() // no key conjured
      expect(await spent()).toBe(0)

      // and a refund larger than what is on the counter clamps at zero rather than going negative,
      // without restarting the window
      await redis.del(`devcreate:rl:${tenantId}`)
      expect((await post(token, '356307042441007', accountId)).status).toBe(201)
      const ttlBefore = await redis.ttl(`devcreate:rl:${tenantId}`)
      await settle(5, 0) // more handed back than is owed
      expect(await spent()).toBe(0)
      expect(await redis.ttl(`devcreate:rl:${tenantId}`)).toBeLessThanOrEqual(ttlBefore)

      // CHARGE ACCOUNTING UNDER CONCURRENCY. Be exact about what this proves: it fails against the
      // GET-then-work-then-INCRBY shape that let five concurrent 100-row imports past a ceiling of 2
      // and create 500 devices, and it does NOT prove atomicity — instrumenting that shape showed
      // the ten requests here read 0,0,2,2,2,… because the preceding account lookup staggers them,
      // so an adjacent GET/INCRBY pair would still pass. Atomicity comes from the reservation being
      // a single Lua INCRBY; this test guards the accounting around it.
      await redis.del(`devcreate:rl:${tenantId}`)
      const burst = await Promise.all(
        Array.from({ length: 10 }, (_, i) => post(token, `35630704244200${i}`, accountId)),
      )
      expect(burst.filter((r) => r.status === 201)).toHaveLength(2)
      expect(burst.filter((r) => r.status === 429)).toHaveLength(8)
      expect(await spent()).toBe(2)

      // THE IMPORT PATH, which is where the measured defect lived and where nothing was asserted:
      // a rejected batch must cost nothing, and an applied batch must cost what it CREATED rather
      // than what was uploaded. Charging the upload was what left a tenant at 11500/10000 after two
      // refused imports and locked them out of the UI form for the hour.
      await redis.del(`devcreate:rl:${tenantId}`)
      const importCsv = ['imei,name,profileKey,accountId',
        `${validImei(35630704254000n)},Imp A,fmb1xx,${accountId}`,
        `${validImei(35630704255000n)},Imp B,fmb1xx,${accountId}`,
        `${validImei(35630704256000n)},Imp C,fmb1xx,${accountId}`].join('\n')
      const doImport = (tok: string) =>
        fetch(`http://127.0.0.1:${p}/v1/devices/import`, {
          method: 'POST',
          headers: { authorization: `Bearer ${tok}`, 'content-type': 'application/json' },
          body: JSON.stringify({ csv: importCsv }),
        })
      // 3 rows against a ceiling of 2: refused, and the refusal is free
      const tooBig = await doImport(token)
      expect(tooBig.status).toBe(429)
      const retryImport = Number(tooBig.headers.get('retry-after'))
      expect(retryImport).toBeGreaterThan(0)
      expect(retryImport).toBeLessThanOrEqual(60)
      expect(await spent()).toBe(0)
      // re-applying the SAME csv creates nothing the second time, so it must cost nothing either
      await redis.set(`devcreate:rl:${tenantId}`, '0', 'EX', 60)
      const app10 = createApp({
        redis, redisSub, db,
        jwtSecret: TEST_JWT_SECRET, jwtTtlS: 900, refreshTtlS: 3600, ticketTtlS: 30,
        lockout: { maxFails: 100, windowS: 900 }, secureCookies: false, trustProxy: false,
        getRemoteAddr: () => '127.0.0.1',
        deviceCreateLimit: { max: 10, windowS: 60 },
      })
      const s10 = serve({ fetch: app10.fetch, port: 0, createServer }) as ReturnType<typeof createServer>
      const p10 = await new Promise<number>((r) => s10.on('listening', () => r((s10.address() as { port: number }).port)))
      try {
        const send = () => fetch(`http://127.0.0.1:${p10}/v1/devices/import`, {
          method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
          body: JSON.stringify({ csv: importCsv }),
        })
        expect((await send()).status).toBe(201)
        expect(await spent()).toBe(3)
        expect((await send()).status).toBe(201) // all three are updates now
        expect(await spent()).toBe(3) // …and cost nothing
      } finally {
        s10.closeAllConnections?.()
        await new Promise<void>((r) => s10.close(() => r()))
      }

      await redis.del(`devcreate:rl:${tenantId}`)
      const other = await seedUser({ databaseUrl, email: 'neighbour@x.test', password: 'password12', role: 'tsp_admin', tenantName: 'Neighbour Co', accountName: 'NF' })
      const otherAccount = (await db.accounts.list({ tenantId: other.tenantId }))[0]!.id
      const otherToken = await mintTestToken({ userId: other.userId, tenantId: other.tenantId, role: 'tsp_admin' })
      expect((await post(otherToken, '356307042441004', otherAccount)).status).toBe(201)
    } finally {
      server.closeAllConnections?.()
      await new Promise<void>((r) => server.close(() => r()))
    }
  })
})

describe('E03-3 device CRUD + registry sync', () => {
  it('create → device row + registry:imei/device:tenant/device:account HSET (pipeline sees it)', async () => {
    const res = await authed('/v1/devices', 'POST', { accountId, profileId, imei: '356307042440111', name: 'Truck 1' })
    expect(res.status).toBe(201)
    const device = (await res.json()) as { id: string; imei: string }
    expect(device.imei).toBe('356307042440111')
    // the three registry hashes ingest + worker read
    expect(await redis.hget('registry:imei', '356307042440111')).toBe(device.id)
    expect(await redis.hget('device:tenant', device.id)).toBe(tenantId)
    expect(await redis.hget('device:account', device.id)).toBe(accountId)
    // …and the per-tenant index the map snapshot reads (audit MED: it used to scan the platform)
    expect(await redis.sismember(tenantDevicesKey(tenantId), device.id)).toBe(1)
  })

  it('duplicate IMEI → 409 (not a 500 from the unique constraint)', async () => {
    await authed('/v1/devices', 'POST', { accountId, profileId, imei: '356307042440222', name: 'A' })
    const dup = await authed('/v1/devices', 'POST', { accountId, profileId, imei: '356307042440222', name: 'B' })
    expect(dup.status).toBe(409)
  })

  it('cross-tenant IMEI clash → 409, NOT a 500 (another tenant holds it; review HIGH)', async () => {
    // seed a device under a DIFFERENT tenant directly, then try to create the same
    // IMEI in the caller's tenant — the global unique index must surface as 409
    const other = await seedUser({ databaseUrl, email: 'other@x.test', password: 'password12', role: 'tsp_admin', tenantName: 'OtherCo', accountName: 'OF' })
    const otherAccounts = await db.accounts.list({ tenantId: other.tenantId })
    await db.devices.create({ tenantId: other.tenantId }, { userId: other.userId }, { accountId: otherAccounts[0]!.id, profileId, imei: '356307042448888', name: 'theirs' })
    const res = await authed('/v1/devices', 'POST', { accountId, profileId, imei: '356307042448888', name: 'mine' })
    expect(res.status).toBe(409)
  })

  it('leading-zero IMEI preserved as string end to end', async () => {
    const res = await authed('/v1/devices', 'POST', { accountId, profileId, imei: '000000000000017', name: 'Z' })
    expect(res.status).toBe(201)
    const list = (await (await authed('/v1/devices')).json()) as { imei: string }[]
    expect(list.some((d) => d.imei === '000000000000017')).toBe(true)
  })

  it('AC[2]: retire → registry:imei entry removed (ingest lookup → null → next connect 0x00)', async () => {
    const device = (await (await authed('/v1/devices', 'POST', { accountId, profileId, imei: '356307042440333', name: 'R' })).json()) as { id: string }
    expect(await redis.hget('registry:imei', '356307042440333')).toBe(device.id)
    const del = await authed(`/v1/devices/${device.id}`, 'DELETE')
    expect(del.status).toBe(200)
    expect(await redis.hget('registry:imei', '356307042440333')).toBeNull()
    expect(await redis.hget('device:tenant', device.id)).toBeNull()
    // the index must shrink with it, or a retired device keeps appearing on the map
    expect(await redis.sismember(tenantDevicesKey(tenantId), device.id)).toBe(0)
  })

  it('a repeat DELETE cannot tear down the registry entry of the device that RECLAIMED the IMEI', async () => {
    // REGRESSION (audit review HIGH). `deactivateDevice` runs before `retire` and HDELs by IMEI, and
    // retire is idempotent — so a second DELETE on an already-retired device removed the mapping of
    // whatever LIVE device had since taken that IMEI. That device stays retiredAt=NULL and looks
    // active in the UI while ingest answers its handshake with 0x00 and quarantines it: no
    // positions, no trips, no alerts, indistinguishable from a device that simply went offline.
    const imei = '356307042440777'
    const first = (await (await authed('/v1/devices', 'POST', { accountId, profileId, imei, name: 'Old' })).json()) as { id: string }
    expect((await authed(`/v1/devices/${first.id}`, 'DELETE')).status).toBe(200)
    const second = (await (await authed('/v1/devices', 'POST', { accountId, profileId, imei, name: 'Replacement' })).json()) as { id: string }
    expect(await redis.hget('registry:imei', imei)).toBe(second.id)

    // the operator (or a script) deletes the retired device again
    expect((await authed(`/v1/devices/${first.id}`, 'DELETE')).status).toBe(200)
    expect(await redis.hget('registry:imei', imei)).toBe(second.id) // …and the LIVE device survives
  })

  it('bad BigInt id → 404, not 500', async () => {
    expect((await authed('/v1/devices/not-a-number')).status).toBe(404)
    expect((await authed('/v1/devices/999999999999')).status).toBe(404)
  })
})

describe('E03-3 CSV import', () => {
  const header = 'imei,name,profileKey,accountId\n'

  it('AC[1]: 1,000-row dry-run < 10 s with a per-row error report', async () => {
    const rows: string[] = []
    for (let i = 0; i < 1000; i++) {
      // most valid; sprinkle errors: bad checksum, unknown profile
      const imei = validImei(35630704245000n + BigInt(i))
      // flip the check digit by +5 mod 10 → guaranteed Luhn failure
      if (i % 100 === 7) rows.push(`${imei.slice(0, 14)}${(Number(imei[14]) + 5) % 10},Bad CS,fmb1xx,${accountId}`)
      else if (i % 100 === 8) rows.push(`${imei},Unknown Prof,nope,${accountId}`)
      else rows.push(`${imei},Dev ${i},fmb1xx,${accountId}`)
    }
    const csv = header + rows.join('\n')
    const t0 = Date.now()
    const res = await authed('/v1/devices/import/preview', 'POST', { csv })
    const elapsed = Date.now() - t0
    expect(res.status).toBe(200)
    expect(elapsed).toBeLessThan(10_000)
    const dr = (await res.json()) as { create: unknown[]; errors: { reason: string }[] }
    expect(dr.errors.length).toBeGreaterThanOrEqual(20) // ~10 bad checksum + ~10 unknown profile
    expect(dr.errors.some((e) => /Luhn|IMEI/.test(e.reason))).toBe(true)
    expect(dr.errors.some((e) => /unknown profile/.test(e.reason))).toBe(true)
    expect(dr.create.length).toBeGreaterThan(900)
  })

  it('dry-run flags in-file and in-db duplicates', async () => {
    const imei = validImei(35630704246000n)
    await authed('/v1/devices', 'POST', { accountId, profileId, imei, name: 'existing' })
    const dupInFile = validImei(35630704246001n)
    const csv = header + `${imei},dupdb,fmb1xx,${accountId}\n${dupInFile},a,fmb1xx,${accountId}\n${dupInFile},b,fmb1xx,${accountId}`
    const dr = (await (await authed('/v1/devices/import/preview', 'POST', { csv })).json()) as { update: unknown[]; errors: { reason: string }[] }
    expect(dr.update.length).toBe(1) // the in-db one is an update, not error
    expect(dr.errors.some((e) => /duplicate IMEI within the file/.test(e.reason))).toBe(true)
  })

  it('apply creates devices and syncs the registry', async () => {
    const imei = validImei(35630704247000n)
    const csv = header + `${imei},Imported,fmb1xx,${accountId}`
    const res = await authed('/v1/devices/import', 'POST', { csv })
    expect(res.status).toBe(201)
    const result = (await res.json()) as { created: number }
    expect(result.created).toBe(1)
    expect(await redis.hget('registry:imei', imei)).not.toBeNull()
  })

  it('imports the optional SIM column (simMsisdn) — persisted on the device', async () => {
    const imei = validImei(35630704251000n)
    const csv = 'imei,name,profileKey,accountId,simMsisdn\n' + `${imei},With SIM,fmb1xx,${accountId},+37060000000`
    const res = await authed('/v1/devices/import', 'POST', { csv })
    expect(res.status).toBe(201)
    expect(((await res.json()) as { created: number }).created).toBe(1)
    const list = (await (await authed('/v1/devices', 'GET')).json()) as { imei: string; simMsisdn: string | null }[]
    expect(list.find((d) => d.imei === imei)?.simMsisdn).toBe('+37060000000')
  })

  it('dry-run rejects a bad simMsisdn (same rules as the manual add)', async () => {
    const badMsisdn = validImei(35630704252000n)
    const csv = 'imei,name,profileKey,accountId,simMsisdn\n' + `${badMsisdn},Bad Msisdn,fmb1xx,${accountId},0037060000000` // no leading + → invalid E.164
    const dr = (await (await authed('/v1/devices/import/preview', 'POST', { csv })).json()) as { errors: { reason: string }[] }
    expect(dr.errors.some((e) => /simMsisdn/.test(e.reason))).toBe(true)
  })

  it('a simIccid column is ignored rather than rejected — old CSVs still import', async () => {
    // The field was removed 2026-08-20; a fleet's saved spreadsheet should not start failing for
    // carrying a column the platform stopped caring about.
    const imei = validImei(35630704254000n)
    const csv = 'imei,name,profileKey,accountId,simMsisdn,simIccid\n' + `${imei},Old CSV,fmb1xx,${accountId},+37060000001,8937060000000000001`
    const dr = (await (await authed('/v1/devices/import/preview', 'POST', { csv })).json()) as { errors: { reason: string }[] }
    expect(dr.errors).toHaveLength(0)
  })
})

describe('E03-3 import unit helpers', () => {
  it('CSV import validates each row with the SAME schema a manual add uses', async () => {
    // The dry run checked the CSV-specific shape (Luhn, profile key, SIM regexes) and nothing else,
    // so a bulk import could push values the API refuses one at a time — a 300-character name went
    // straight at the DB (audit MED). The failure is per ROW, with the field named.
    const csv = ['imei,name,profileKey,accountId', `356307042440908,${'x'.repeat(300)},fmb1xx,${accountId}`].join('\n')
    const res = await authed('/v1/devices/import/preview', 'POST', { csv })
    expect(res.status).toBe(200)
    const body = (await res.json()) as { create: unknown[]; errors: { row: number; reason: string }[] }
    expect(body.create).toHaveLength(0)
    expect(body.errors[0]!.row).toBe(2) // the CSV line, not a placeholder
    expect(body.errors[0]!.reason).toMatch(/name/)
  })

  it('an import row that fails at APPLY is reported per row, not thrown away with the batch', async () => {
    // Only a duplicate IMEI was caught per row; anything else rethrew and aborted the loop — the
    // devices already created stayed created (they are real) while the caller got a 500 and NO
    // report of which ones, leaving an operator with nothing to retry against.
    const dup = '356307042440916'
    await authed('/v1/devices', 'POST', { accountId, profileId, imei: dup, name: 'Existing' })
    // …in ANOTHER tenant, so the row is not classified as an update and reaches the create path
    const other = await seedUser({ databaseUrl, email: `imp-${Date.now()}@x.test`, password: 'password12', role: 'tsp_admin', tenantName: 'ImpCo', accountName: 'ImpFleet' })
    const otherAccounts = await db.accounts.list({ tenantId: other.tenantId })
    const otherToken = await mintTestToken({ userId: other.userId, tenantId: other.tenantId, role: 'tsp_admin' })
    const csv = ['imei,name,profileKey,accountId', `${dup},Clash,fmb1xx,${otherAccounts[0]!.id}`, `356307042440924,Fine,fmb1xx,${otherAccounts[0]!.id}`].join('\n')
    const res = await fetch(`${base()}/v1/devices/import`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${otherToken}` },
      body: JSON.stringify({ csv }),
    })
    expect(res.status).toBe(201)
    const body = (await res.json()) as { created: number; errors: { row: number; imei: string }[] }
    expect(body.created).toBe(1) // the good row still landed
    expect(body.errors).toHaveLength(1)
    expect(body.errors[0]!.imei).toBe(dup)
    expect(body.errors[0]!.row).toBe(2) // named, not 0
  })

  it('PATCH refuses a field it cannot change instead of answering 200 and doing nothing', async () => {
    // Non-strict, zod stripped the unknown key and the handler issued an empty update that returned
    // the unchanged row with 200. The two an operator actually tries are the expensive ones: an
    // IMEI is typed by hand at creation and no route can correct it — a mistyped one is then held
    // platform-wide against every other tenant while the real tracker is rejected into quarantine —
    // and a device created under the wrong sub-account cannot be moved. Both said "success".
    const created = await (await authed('/v1/devices', 'POST', { accountId, profileId, imei: '860000000000811', name: 'Strict' })).json() as { id: string; imei: string }
    for (const bad of [{ imei: '860000000000899' }, { accountId: '00000000-0000-0000-0000-0000000000ff' }, { tenantId: 'x' }]) {
      const res = await authed(`/v1/devices/${created.id}`, 'PATCH', bad)
      expect(res.status, JSON.stringify(bad)).toBe(400)
    }
    // …and the row is untouched
    const after = await (await authed(`/v1/devices/${created.id}`)).json() as { imei: string; accountId: string }
    expect(after.imei).toBe('860000000000811')
    expect(after.accountId).toBe(accountId)
    // a field it CAN change still works, and an empty patch is still a legitimate no-op
    expect((await authed(`/v1/devices/${created.id}`, 'PATCH', { name: 'Renamed' })).status).toBe(200)
    expect((await authed(`/v1/devices/${created.id}`, 'PATCH', {})).status).toBe(200)
  })

  it('luhnValid: accepts a valid IMEI, rejects a broken checksum / wrong length', () => {
    const good = validImei(35630704248000n)
    expect(luhnValid(good)).toBe(true)
    expect(luhnValid(good.slice(0, 14) + String((Number(good[14]) + 1) % 10))).toBe(false)
    expect(luhnValid('12345')).toBe(false)
  })

  it('parseCsv: quoted fields, commas in quotes, CRLF', () => {
    const rows = parseCsv('imei,name\r\n"123","Doe, John"\r\n"456","Simple"')
    expect(rows).toEqual([
      { imei: '123', name: 'Doe, John' },
      { imei: '456', name: 'Simple' },
    ])
  })
})

/** Build a Luhn-valid 15-digit IMEI from a 14-digit numeric base. Must match
 * luhnValid's doubling (odd 0-indexed positions of the full string; the check
 * digit sits at index 14, so body odd indices are the doubled ones). */
function validImei(base14: bigint): string {
  const body = base14.toString().padStart(14, '0').slice(0, 14)
  let sum = 0
  for (let i = 0; i < 14; i++) {
    let d = body.charCodeAt(i) - 48
    if (i % 2 === 1) {
      d *= 2
      if (d > 9) d -= 9
    }
    sum += d
  }
  const check = (10 - (sum % 10)) % 10
  return body + String(check)
}
