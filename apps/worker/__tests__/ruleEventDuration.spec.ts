import { execFileSync } from 'node:child_process'
import { resolve } from 'node:path'
import type { Pool } from 'pg'
import { GenericContainer, Wait, type StartedTestContainer } from 'testcontainers'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { createPool } from '@orbetra/db'

import { extendRuleEvents, writeRuleEvents } from '../src/rules/writer.js'

/**
 * A breach that LASTS.
 *
 * A vehicle crossing a 90 limit and climbing to 155 used to leave one row saying 95 — the speed at
 * the instant it first crossed — and then, every cooldown window, another row with whatever the
 * speed happened to be at that moment. Five rows five minutes apart were one breach sliced by a
 * timer, and not one of them carried the worst moment or how long it went on.
 *
 * These assert the two things that are easy to get subtly wrong in SQL and impossible to see on a
 * screen: that a peak is never lowered, and that a duration is never shortened.
 */
const IMAGE = 'timescale/timescaledb-ha:pg16'
const DB_PKG = resolve(import.meta.dirname, '../../../packages/db')
let container: StartedTestContainer
let pool: Pool
const TEN = '11111111-1111-1111-1111-111111111111'
const ACC = '22222222-2222-2222-2222-222222222222'
const RULE = '33333333-3333-3333-3333-333333333333'
const T0 = new Date('2026-09-01T14:00:00Z')
const at = (min: number): Date => new Date(T0.getTime() + min * 60_000)

const open = async (deviceId: bigint, speed: number): Promise<void> => {
  await writeRuleEvents(pool, [
    { tenantId: TEN, accountId: ACC, deviceId, ruleId: RULE, kind: 'overspeed', at: T0, lat: 54.5, lon: 25.5, payload: { rule: 'r90', speedKmh: speed, limitKmh: 90 } },
  ])
}
const row = async (deviceId: bigint): Promise<{ at: Date; endedAt: Date | null; payload: Record<string, unknown> }> => {
  const r = await pool.query<{ at: Date; endedAt: Date | null; payload: Record<string, unknown> }>(
    'SELECT "at","endedAt",payload FROM events WHERE "deviceId"=$1 ORDER BY "at" DESC LIMIT 1',
    [deviceId.toString()],
  )
  return r.rows[0]!
}

beforeAll(async () => {
  container = await new GenericContainer(IMAGE)
    .withEnvironment({ POSTGRES_PASSWORD: 'test', POSTGRES_DB: 'orbetra' })
    .withExposedPorts(5432)
    .withWaitStrategy(Wait.forLogMessage(/database system is ready to accept connections/, 2))
    .withStartupTimeout(240_000)
    .start()
  const url = `postgresql://postgres:test@${container.getHost()}:${container.getMappedPort(5432)}/orbetra`
  execFileSync('pnpm', ['exec', 'prisma', 'migrate', 'deploy'], { cwd: DB_PKG, env: { ...process.env, DATABASE_URL: url }, encoding: 'utf8' })
  pool = createPool(url)
}, 300_000)

afterAll(async () => {
  await pool?.end()
  await container?.stop()
})

describe('extendRuleEvents — one breach, not five rows', () => {
  it('carries the PEAK and the duration the cooldown used to discard', async () => {
    const dev = 1001n
    await open(dev, 95) // first crossing — the only number the old behaviour ever kept
    for (const [min, kmh] of [[5, 105], [10, 155], [15, 120]] as const) {
      await extendRuleEvents(pool, [{ deviceId: dev, kind: 'overspeed', ruleId: RULE, at: at(min), payload: { speedKmh: kmh } }])
    }
    const r = await row(dev)
    expect(r.payload['speedKmh']).toBe(95) // the moment it started is preserved
    expect(Number(r.payload['maxSpeedKmh'])).toBe(155) // …and the moment that matters is now kept
    expect(r.endedAt?.toISOString()).toBe(at(15).toISOString())
    expect((r.endedAt!.getTime() - r.at.getTime()) / 60_000).toBe(15)
  })

  it('never LOWERS a peak — a slower moment inside the same breach is not the story', async () => {
    const dev = 1002n
    await open(dev, 100)
    await extendRuleEvents(pool, [{ deviceId: dev, kind: 'overspeed', ruleId: RULE, at: at(5), payload: { speedKmh: 150 } }])
    await extendRuleEvents(pool, [{ deviceId: dev, kind: 'overspeed', ruleId: RULE, at: at(10), payload: { speedKmh: 95 } }])
    expect(Number((await row(dev)).payload['maxSpeedKmh'])).toBe(150)
  })

  it('never SHORTENS a duration — a late-flushed batch arrives out of order', async () => {
    const dev = 1003n
    await open(dev, 100)
    await extendRuleEvents(pool, [{ deviceId: dev, kind: 'overspeed', ruleId: RULE, at: at(20), payload: { speedKmh: 110 } }])
    await extendRuleEvents(pool, [{ deviceId: dev, kind: 'overspeed', ruleId: RULE, at: at(8), payload: { speedKmh: 110 } }])
    expect((await row(dev)).endedAt?.toISOString()).toBe(at(20).toISOString())
  })

  it('refuses to attach today\'s breach to last week\'s row', async () => {
    const dev = 1004n
    await open(dev, 100)
    // far outside the extend window: this is a NEW breach, and silently absorbing it into an old
    // row would invent a duration of several days
    const n = await extendRuleEvents(pool, [{ deviceId: dev, kind: 'overspeed', ruleId: RULE, at: at(60 * 24 * 7), payload: { speedKmh: 200 } }])
    expect(n).toBe(0)
    const r = await row(dev)
    expect(r.endedAt).toBeNull()
    expect(r.payload['maxSpeedKmh']).toBeUndefined()
  })

  it('extends the newest matching row only, and never another device\'s', async () => {
    const a = 1005n
    const b = 1006n
    await open(a, 100)
    await open(b, 100)
    await extendRuleEvents(pool, [{ deviceId: a, kind: 'overspeed', ruleId: RULE, at: at(5), payload: { speedKmh: 130 } }])
    expect(Number((await row(a)).payload['maxSpeedKmh'])).toBe(130)
    expect((await row(b)).endedAt).toBeNull()
  })
})
