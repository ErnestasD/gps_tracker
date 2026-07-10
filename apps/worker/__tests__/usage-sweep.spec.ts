import type { Pool } from 'pg'
import { describe, expect, it, vi } from 'vitest'

import { runUsageSweep } from '../src/jobs/usageWorker.js'

const H = 3_600_000
const NOW = Date.parse('2026-07-10T10:00:00Z')

function fakePool(rowCount = 3) {
  const calls: { sql: string; params: unknown[] }[] = []
  const query = vi.fn((sql: string, params: unknown[]) => {
    calls.push({ sql, params })
    return Promise.resolve({ rows: [], rowCount })
  })
  return { pool: { query } as unknown as Pool, calls }
}

describe('E07-4 runUsageSweep (statement shape — behavior is proven in usage-sweep-db.spec)', () => {
  it('is ONE INSERT…SELECT from positions joined to devices, ON CONFLICT (deviceId,day)', async () => {
    const { pool, calls } = fakePool()
    const n = await runUsageSweep(pool, NOW)
    expect(n).toBe(3) // rowCount passthrough
    expect(calls).toHaveLength(1)
    const sql = calls[0]!.sql
    expect(sql).toContain('INSERT INTO usage_daily')
    expect(sql).toContain('FROM positions')
    expect(sql).toContain('JOIN devices')
    expect(sql).toContain('ON CONFLICT ("deviceId",day) DO NOTHING')
    expect(sql).toContain(`(fix_time AT TIME ZONE 'UTC')::date`) // UTC billing day, in Postgres
  })

  it('bounds the window: [now − 48 h, now + 1 h) by default', async () => {
    const { pool, calls } = fakePool()
    await runUsageSweep(pool, NOW)
    expect(calls[0]!.params).toEqual([new Date(NOW - 48 * H), new Date(NOW + H)])
  })

  it('a custom lookback widens the window (month-close reconciliation path)', async () => {
    const { pool, calls } = fakePool()
    await runUsageSweep(pool, NOW, 35 * 24 * H)
    expect(calls[0]!.params[0]).toEqual(new Date(NOW - 35 * 24 * H))
  })
})
