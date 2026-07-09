import pg from 'pg'
import { GenericContainer, Wait, type StartedTestContainer } from 'testcontainers'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { runReport, type DailyEngineHoursRow, type DailyGeofenceRow, type DailyMileageRow, type DailyOverspeedRow, type DailyStopsRow, type ReportScope } from '../src/reports.js'

/**
 * E06-1 report engine — correctness incl. the §7.7 account-TZ / DST requirement. The engine
 * reads only trips + events, so we create minimal tables directly (no Prisma-migrate cost)
 * and seed rows straddling the Europe/Warsaw 2026-10-25 fall-back (CEST +2 → CET +1) to prove
 * Postgres `AT TIME ZONE` buckets by the local calendar day, not UTC.
 */
const IMAGE = 'timescale/timescaledb-ha:pg16'
const T1 = '11111111-1111-1111-1111-111111111111'
const A1 = 'aaaaaaaa-1111-1111-1111-111111111111'
const A1B = 'aaaaaaaa-1111-1111-1111-1111111111bb' // a SECOND account under the same tenant T1
const T2 = '22222222-2222-2222-2222-222222222222'
const A2 = 'aaaaaaaa-2222-2222-2222-222222222222'
const scope1: ReportScope = { tenantId: T1, accountId: A1 }

let container: StartedTestContainer
let pool: pg.Pool

async function seedTrip(deviceId: number, startIso: string, endIso: string | null, distanceM: number, idleS = 0, scope = { t: T1, a: A1 }): Promise<void> {
  await pool.query(
    `INSERT INTO trips ("tenantId","accountId","deviceId",status,"startTime","endTime","distanceM","distanceSource","maxSpeed","idleS")
     VALUES ($1,$2,$3,'closed',$4,$5,$6,'gps',80,$7)`,
    [scope.t, scope.a, deviceId, startIso, endIso, distanceM, idleS],
  )
}
async function seedEvent(deviceId: number, kind: string, atIso: string, payload: object, scope = { t: T1, a: A1 }): Promise<void> {
  await pool.query(`INSERT INTO events ("tenantId","accountId","deviceId",kind,at,payload) VALUES ($1,$2,$3,$4,$5,$6)`, [
    scope.t,
    scope.a,
    deviceId,
    kind,
    atIso,
    JSON.stringify(payload),
  ])
}

beforeAll(async () => {
  container = await new GenericContainer(IMAGE)
    .withEnvironment({ POSTGRES_PASSWORD: 'test', POSTGRES_DB: 'reports' })
    .withExposedPorts(5432)
    .withWaitStrategy(Wait.forLogMessage(/database system is ready to accept connections/, 2))
    .withStartupTimeout(240_000)
    .start()
  const url = `postgresql://postgres:test@${container.getHost()}:${container.getMappedPort(5432)}/reports`
  pool = new pg.Pool({ connectionString: url })
  await pool.query(`CREATE TABLE trips (
    id bigserial PRIMARY KEY, "tenantId" uuid, "accountId" uuid, "deviceId" bigint, status text,
    "startTime" timestamptz, "endTime" timestamptz, "distanceM" int, "distanceSource" text, "maxSpeed" int, "idleS" int)`)
  await pool.query(`CREATE TABLE events (
    id bigserial PRIMARY KEY, "tenantId" uuid, "accountId" uuid, "deviceId" bigint, "ruleId" uuid, kind text, at timestamptz, payload jsonb)`)

  // DST straddle (Europe/Warsaw fall-back 2026-10-25): local days —
  //  C 2026-10-24T21:00Z → 23:00 CEST → 2026-10-24
  //  A 2026-10-24T23:30Z → 01:30 CEST → 2026-10-25
  //  B 2026-10-25T22:30Z → 23:30 CET  → 2026-10-25  (offset changed to +1)
  await seedTrip(1, '2026-10-24T21:00:00Z', '2026-10-24T21:30:00Z', 1000, 60) // C
  await seedTrip(1, '2026-10-24T23:30:00Z', '2026-10-25T00:00:00Z', 2000, 30) // A
  await seedTrip(1, '2026-10-25T22:30:00Z', '2026-10-25T23:00:00Z', 3000, 0) // B
  // isolation: a trip for tenant2/account2 must never appear in scope1's report
  await seedTrip(9, '2026-10-25T10:00:00Z', '2026-10-25T10:30:00Z', 9999, 0, { t: T2, a: A2 })
  // isolation within the tenant: a trip for a SIBLING account (T1/A1B) must not appear in A1's report
  await seedTrip(5, '2026-10-25T10:00:00Z', '2026-10-25T10:30:00Z', 7777, 0, { t: T1, a: A1B })

  await seedEvent(1, 'overspeed', '2026-10-25T08:00:00Z', { speedKmh: 95, limitKmh: 90 })
  await seedEvent(1, 'overspeed', '2026-10-25T09:00:00Z', { speedKmh: 110, limitKmh: 90 })
  await seedEvent(1, 'geofence', '2026-10-25T08:30:00Z', { transition: 'enter', name: 'Depot' })
  await seedEvent(1, 'geofence', '2026-10-25T18:30:00Z', { transition: 'exit', name: 'Depot' })
  await seedEvent(9, 'overspeed', '2026-10-25T08:00:00Z', { speedKmh: 200 }, { t: T2, a: A2 })
}, 240_000)

afterAll(async () => {
  await pool?.end()
  await container?.stop()
})

const params = (tz: string) => ({ from: '2026-10-24T00:00:00Z', to: '2026-10-27T00:00:00Z', timezone: tz })

describe('E06-1 mileage report — account-TZ day bucketing (§7.7 DST)', () => {
  it('buckets by the Warsaw local day across the fall-back: 2026-10-25 gets 2 trips', async () => {
    const rows = (await runReport(pool, 'mileage', scope1, params('Europe/Warsaw'))).rows as DailyMileageRow[]
    const d25 = rows.find((r) => r.day === '2026-10-25')
    const d24 = rows.find((r) => r.day === '2026-10-24')
    expect(d25).toMatchObject({ trips: 2, distanceM: 5000 }) // A + B
    expect(d24).toMatchObject({ trips: 1, distanceM: 1000 }) // C
    expect(rows.every((r) => r.deviceId === '1')).toBe(true) // isolation: no device 9
  })

  it('UTC bucketing splits differently — proves the TZ conversion is real', async () => {
    const rows = (await runReport(pool, 'mileage', scope1, params('UTC'))).rows as DailyMileageRow[]
    // under UTC: C+A on 2026-10-24, B on 2026-10-25
    expect(rows.find((r) => r.day === '2026-10-24')).toMatchObject({ trips: 2, distanceM: 3000 })
    expect(rows.find((r) => r.day === '2026-10-25')).toMatchObject({ trips: 1, distanceM: 3000 })
  })

  it('an unknown timezone falls back to UTC instead of 500-ing', async () => {
    const rows = (await runReport(pool, 'mileage', scope1, params('Not/AZone'))).rows as DailyMileageRow[]
    expect(rows.find((r) => r.day === '2026-10-24')).toMatchObject({ trips: 2 }) // == UTC bucketing
  })
})

describe('E06-1 other report types', () => {
  it('overspeed counts events + max speed per local day (device-scoped, isolated)', async () => {
    const rows = (await runReport(pool, 'overspeed', scope1, params('Europe/Warsaw'))).rows as DailyOverspeedRow[]
    expect(rows).toEqual([{ day: '2026-10-25', deviceId: '1', count: 2, maxSpeedKmh: 110 }])
  })

  it('geofence counts enters/exits', async () => {
    const rows = (await runReport(pool, 'geofence', scope1, params('Europe/Warsaw'))).rows as DailyGeofenceRow[]
    expect(rows).toEqual([{ day: '2026-10-25', deviceId: '1', enters: 1, exits: 1 }])
  })

  it('engine_hours sums trip durations per day', async () => {
    const rows = (await runReport(pool, 'engine_hours', scope1, params('Europe/Warsaw'))).rows as DailyEngineHoursRow[]
    const d25 = rows.find((r) => r.day === '2026-10-25')
    expect(d25?.seconds).toBe(1800 + 1800) // A 30min + B 30min
  })

  it('trips report lists the account trips, newest first, with a local day', async () => {
    const rows = (await runReport(pool, 'trips', scope1, params('Europe/Warsaw'))).rows
    expect(rows).toHaveLength(3)
    expect((rows[0] as { day: string }).day).toBe('2026-10-25') // newest = trip B
  })

  it('a deviceId filter restricts to that device', async () => {
    const rows = (await runReport(pool, 'mileage', scope1, { ...params('UTC'), deviceId: '1' })).rows
    expect(rows.every((r) => (r as DailyMileageRow).deviceId === '1')).toBe(true)
    const none = (await runReport(pool, 'mileage', scope1, { ...params('UTC'), deviceId: '999' })).rows
    expect(none).toHaveLength(0)
  })

  it('garbage from/to/deviceId never throws (sanitized)', async () => {
    const rows = (await runReport(pool, 'mileage', scope1, { from: 'not-a-date', to: 'xyz', timezone: 'Europe/Warsaw', deviceId: 'DROP TABLE' })).rows
    expect(Array.isArray(rows)).toBe(true) // unbounded range, no device filter, no throw
  })

  it('stops report sums idle seconds + trips per day', async () => {
    const rows = (await runReport(pool, 'stops', scope1, params('Europe/Warsaw'))).rows as DailyStopsRow[]
    expect(rows.find((r) => r.day === '2026-10-25')).toMatchObject({ trips: 2, idleS: 30 }) // A 30 + B 0
    expect(rows.find((r) => r.day === '2026-10-24')).toMatchObject({ trips: 1, idleS: 60 }) // C
  })

  it('tenant/account isolation: scope2 sees only its own device-9 trip', async () => {
    const rows = (await runReport(pool, 'mileage', { tenantId: T2, accountId: A2 }, params('UTC'))).rows as DailyMileageRow[]
    expect(rows).toEqual([{ day: '2026-10-25', deviceId: '9', trips: 1, distanceM: 9999 }])
  })

  it('cross-account isolation WITHIN a tenant: A1 report excludes the sibling A1B trip', async () => {
    const a1 = (await runReport(pool, 'mileage', scope1, params('UTC'))).rows as DailyMileageRow[]
    expect(a1.some((r) => r.deviceId === '5')).toBe(false) // device 5 lives in A1B
    const a1b = (await runReport(pool, 'mileage', { tenantId: T1, accountId: A1B }, params('UTC'))).rows as DailyMileageRow[]
    expect(a1b).toEqual([{ day: '2026-10-25', deviceId: '5', trips: 1, distanceM: 7777 }])
  })

  it('a numeric-but-oversized deviceId is dropped, not a 500 (bigint overflow guard)', async () => {
    const rows = (await runReport(pool, 'mileage', scope1, { ...params('UTC'), deviceId: '9'.repeat(30) })).rows
    expect(Array.isArray(rows)).toBe(true) // filter dropped → whole-account result, no throw
    expect(rows.length).toBeGreaterThan(0)
  })
})
