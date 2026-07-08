import { execFileSync } from 'node:child_process'
import { resolve } from 'node:path'
import type { Pool } from 'pg'
import { GenericContainer, Wait, type StartedTestContainer } from 'testcontainers'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'

import { createPool } from '@orbetra/db'

import { recomputeTrips } from '../src/trip/recompute.js'

const IMAGE = 'timescale/timescaledb-ha:pg16'
const DB_PKG = resolve(import.meta.dirname, '../../../packages/db')

let container: StartedTestContainer
let pool: Pool

const DEV = 356_307_042_440_100n
const SCOPE = { tenantId: '11111111-1111-1111-1111-111111111111', accountId: '22222222-2222-2222-2222-222222222222' }
const T0 = new Date('2026-07-01T08:00:00Z')
const at = (sec: number) => new Date(T0.getTime() + sec * 1000)

beforeAll(async () => {
  container = await new GenericContainer(IMAGE)
    .withEnvironment({ POSTGRES_PASSWORD: 'test', POSTGRES_DB: 'orbetra' })
    .withExposedPorts(5432)
    .withWaitStrategy(Wait.forLogMessage(/database system is ready to accept connections/, 2))
    .withStartupTimeout(240_000)
    .start()
  const url = `postgresql://postgres:test@${container.getHost()}:${container.getMappedPort(5432)}/orbetra`
  execFileSync('pnpm', ['exec', 'prisma', 'migrate', 'deploy'], { cwd: DB_PKG, env: { ...process.env, DATABASE_URL: url }, encoding: 'utf8' })
  // positions hypertable lives in the numbered SQL layer
  execFileSync('pnpm', ['exec', 'tsx', 'sql/migrate.ts'], { cwd: DB_PKG, env: { ...process.env, DATABASE_URL: url }, encoding: 'utf8' })
  pool = createPool(url)
}, 300_000)

afterAll(async () => {
  await pool?.end()
  await container?.stop()
})

beforeEach(async () => {
  await pool.query('DELETE FROM positions')
  await pool.query('DELETE FROM trips')
})

let hash = 0
interface Pt { sec: number; lat: number; speed: number; ign: boolean | null; mov?: boolean | null; odo?: bigint | null; valid?: boolean }
async function insert(points: Pt[]): Promise<void> {
  for (const p of points) {
    await pool.query(
      `INSERT INTO positions (device_id, fix_time, server_time, lat, lon, speed, fix_valid, ignition, movement, odometer_m, rec_hash)
       VALUES ($1,$2,$2,$3,25.0,$4,$5,$6,$7,$8,$9)`,
      [DEV.toString(), at(p.sec), p.lat, p.speed, p.valid ?? true, p.ign, p.mov ?? null, p.odo ?? null, ++hash],
    )
  }
}

/** A drive→stop sequence that opens one trip and closes it (default-threshold friendly). */
function trip(fromSec: number, baseLat: number): Pt[] {
  const pts: Pt[] = []
  for (let i = 0; i < 12; i++) pts.push({ sec: fromSec + i * 10, lat: baseLat + i * 0.0002, speed: 8, ign: true, mov: true })
  pts.push({ sec: fromSec + 130, lat: baseLat + 11 * 0.0002, speed: 0, ign: false })
  pts.push({ sec: fromSec + 320, lat: baseLat + 11 * 0.0002, speed: 0, ign: false })
  return pts
}

type Snap = { status: string; start: string; end: string | null; distanceM: number; source: string; maxSpeed: number; idleS: number }
async function snapshot(): Promise<Snap[]> {
  const r = await pool.query('SELECT status, "startTime", "endTime", "distanceM", "distanceSource", "maxSpeed", "idleS" FROM trips WHERE "deviceId"=$1 ORDER BY "startTime"', [DEV.toString()])
  return r.rows.map((x) => {
    const row = x as Record<string, unknown>
    return {
      status: row['status'] as string,
      start: (row['startTime'] as Date).toISOString(),
      end: row['endTime'] === null ? null : (row['endTime'] as Date).toISOString(),
      distanceM: row['distanceM'] as number,
      source: row['distanceSource'] as string,
      maxSpeed: row['maxSpeed'] as number,
      idleS: row['idleS'] as number,
    }
  })
}

describe('E04-2 trip recompute (idempotent, §6.4)', () => {
  it('idempotency: recompute twice over the same positions == recompute once', async () => {
    await insert([...trip(0, 54.0), ...trip(700, 55.0)])
    const first = await recomputeTrips(pool, DEV, at(-10), at(1100), SCOPE)
    const snapA = await snapshot()
    const second = await recomputeTrips(pool, DEV, at(-10), at(1100), SCOPE)
    const snapB = await snapshot()

    expect(snapA.length).toBe(2) // two closed trips
    expect(snapB).toEqual(snapA) // byte-identical trips (ids differ, content does not)
    expect(second.created).toBe(first.created)
    // the second run deleted exactly what the first created (no accumulation)
    expect(second.deleted).toBe(first.created)
  })

  it('property: N different windows each converge (2× == 1×) and never duplicate trips', async () => {
    await insert([...trip(0, 54.0), ...trip(700, 55.0)])
    for (const [lo, hi] of [[-10, 1100], [0, 400], [650, 1100], [300, 800]] as const) {
      await recomputeTrips(pool, DEV, at(lo), at(hi), SCOPE)
      const once = await snapshot()
      await recomputeTrips(pool, DEV, at(lo), at(hi), SCOPE)
      expect(await snapshot()).toEqual(once)
      // regardless of window, the full history always resolves to exactly two trips
      expect((await snapshot()).length).toBe(2)
    }
  })

  it('late fix: a record extending a closed trip is reconciled (delete-overlap + replay)', async () => {
    await insert(trip(0, 54.0))
    await recomputeTrips(pool, DEV, at(-10), at(400), SCOPE)
    const before = (await snapshot())[0]!
    // a buffered late fix arrives mid-drive that the streaming engine would have dropped
    await insert([{ sec: 60, lat: 54.05, speed: 40, ign: true, mov: true }]) // a big detour
    await recomputeTrips(pool, DEV, at(-10), at(400), SCOPE)
    const after = (await snapshot())[0]!
    expect(after.distanceM).toBeGreaterThan(before.distanceM) // the detour is now counted
    expect((await snapshot()).length).toBe(1) // still one trip, not duplicated
  })

  it('I5: invalid fixes in positions never change the recomputed distance', async () => {
    await insert(trip(0, 54.0))
    await recomputeTrips(pool, DEV, at(-10), at(400), SCOPE)
    const clean = (await snapshot())[0]!.distanceM
    // inject §3.4 invalid fixes (sat=0 ⇒ fix_valid=false) incl. a teleport
    await insert([
      { sec: 55, lat: 0, speed: 0, ign: true, valid: false },
      { sec: 65, lat: 54.5, speed: 0, ign: true, valid: false },
    ])
    await recomputeTrips(pool, DEV, at(-10), at(400), SCOPE)
    expect((await snapshot())[0]!.distanceM).toBe(clean)
  })

  it('neighbour in the margin: recomputing one trip never deletes/corrupts a nearby trip (review HIGH)', async () => {
    await insert([...trip(0, 54.0), ...trip(400, 55.0)]) // B starts 270 s after A ends — inside the read margin
    await recomputeTrips(pool, DEV, at(-10), at(1100), SCOPE)
    const both = await snapshot()
    expect(both).toHaveLength(2)
    const bBefore = both[1]!
    // recompute ONLY A's window — B's positions fall inside A's read margin but B must survive intact
    await recomputeTrips(pool, DEV, at(-10), at(200), SCOPE)
    const after = await snapshot()
    expect(after).toHaveLength(2) // B not lost
    expect(after[1]!).toEqual(bBefore) // B byte-identical, not a bisected 'open' fragment
    expect(after[1]!.status).toBe('closed')
  })

  it('live-edge safety: recompute never deletes an open (live) trip row (review HIGH)', async () => {
    await insert(trip(0, 54.0))
    // a live streaming open row the persister still owns
    await pool.query(`INSERT INTO trips ("tenantId","accountId","deviceId","status","startTime","startLat","startLon") VALUES ($1,$2,$3,'open',$4,54.9,25)`, [SCOPE.tenantId, SCOPE.accountId, DEV.toString(), at(50)])
    await recomputeTrips(pool, DEV, at(-10), at(400), SCOPE)
    const rows = await pool.query(`SELECT count(*)::int AS n FROM trips WHERE "deviceId"=$1 AND status='open'`, [DEV.toString()])
    expect((rows.rows[0] as { n: number }).n).toBe(1) // the open row survived recompute
  })

  it('window expansion: a mid-trip window expands to the existing trip and never bisects it', async () => {
    await insert(trip(0, 54.0))
    await recomputeTrips(pool, DEV, at(-10), at(400), SCOPE) // trip now exists
    const full = (await snapshot())[0]!
    // a later reconcile whose window [50,80] lands INSIDE the trip must expand to its
    // boundaries (via the overlap query) and reproduce the whole trip, not a fragment
    const res = await recomputeTrips(pool, DEV, at(50), at(80), SCOPE)
    const snap = await snapshot()
    expect(snap.length).toBe(1)
    expect(snap[0]!.status).toBe('closed')
    expect(snap[0]!).toEqual(full) // identical to the full-window computation
    expect(res.created).toBe(1)
  })
})
