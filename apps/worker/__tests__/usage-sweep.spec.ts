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
    expect(sql).toContain('server_time >=') // windows on RECEIVE time (catches buffered flush; audit P4)
    expect(sql).toContain('fix_time >=') // + a fix_time sanity clamp (chunk exclusion, garbage-clock reject)
  })

  it('windows server_time [now − 48 h, now + 1 h) and floors fix_time at server_since − 35 d buffer', async () => {
    const { pool, calls } = fakePool()
    await runUsageSweep(pool, NOW)
    // fix_time floor = now − lookback − buffer, so a buffered flush received in the window is caught
    expect(calls[0]!.params).toEqual([new Date(NOW - 48 * H), new Date(NOW + H), new Date(NOW - 48 * H - 35 * 24 * H), new Date(NOW + H)])
  })

  it('a custom lookback widens BOTH the server_time window AND the fix_time floor (month-close)', async () => {
    const { pool, calls } = fakePool()
    await runUsageSweep(pool, NOW, 60 * 24 * H)
    expect(calls[0]!.params[0]).toEqual(new Date(NOW - 60 * 24 * H)) // server_time lower bound widens
    expect(calls[0]!.params[2]).toEqual(new Date(NOW - 60 * 24 * H - 35 * 24 * H)) // fix_time floor widens too (regression guard)
  })
})
