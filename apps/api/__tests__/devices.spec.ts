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
import { luhnValid, parseCsv } from '../src/routes/deviceImport.js'
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
  })

  it('duplicate IMEI → 409 (not a 500 from the unique constraint)', async () => {
    await authed('/v1/devices', 'POST', { accountId, profileId, imei: '356307042440222', name: 'A' })
    const dup = await authed('/v1/devices', 'POST', { accountId, profileId, imei: '356307042440222', name: 'B' })
    expect(dup.status).toBe(409)
  })

  it('cross-tenant IMEI clash → 409, NOT a 500 (imei is globally unique; review HIGH)', async () => {
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

  it('imports the optional SIM columns (simMsisdn/simIccid) — persisted on the device', async () => {
    const imei = validImei(35630704251000n)
    const csv = 'imei,name,profileKey,accountId,simMsisdn,simIccid\n' + `${imei},With SIM,fmb1xx,${accountId},+37060000000,8937060000000000001`
    const res = await authed('/v1/devices/import', 'POST', { csv })
    expect(res.status).toBe(201)
    expect(((await res.json()) as { created: number }).created).toBe(1)
    const list = (await (await authed('/v1/devices', 'GET')).json()) as { imei: string; simMsisdn: string | null }[]
    expect(list.find((d) => d.imei === imei)?.simMsisdn).toBe('+37060000000')
  })

  it('dry-run rejects a bad simMsisdn / simIccid (same rules as the manual add)', async () => {
    const badMsisdn = validImei(35630704252000n)
    const badIccid = validImei(35630704253000n)
    const csv =
      'imei,name,profileKey,accountId,simMsisdn,simIccid\n' +
      `${badMsisdn},Bad Msisdn,fmb1xx,${accountId},0037060000000,\n` + // no leading + → invalid E.164
      `${badIccid},Bad Iccid,fmb1xx,${accountId},,12345` // too short → invalid ICCID
    const dr = (await (await authed('/v1/devices/import/preview', 'POST', { csv })).json()) as { errors: { reason: string }[] }
    expect(dr.errors.some((e) => /simMsisdn/.test(e.reason))).toBe(true)
    expect(dr.errors.some((e) => /simIccid/.test(e.reason))).toBe(true)
  })
})

describe('E03-3 import unit helpers', () => {
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
