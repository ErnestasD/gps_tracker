import { execFileSync } from 'node:child_process'
import { copyFileSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import pg from 'pg'
import { GenericContainer, Wait, type StartedTestContainer } from 'testcontainers'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { migrate } from '../sql/migrate.js'

const PKG_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const IMAGE = 'timescale/timescaledb-ha:pg16'

let container: StartedTestContainer
let url: string

beforeAll(async () => {
  container = await new GenericContainer(IMAGE)
    .withEnvironment({ POSTGRES_PASSWORD: 'test', POSTGRES_DB: 'orbetra' })
    .withExposedPorts(5432)
    .withWaitStrategy(Wait.forLogMessage(/database system is ready to accept connections/, 2))
    .withStartupTimeout(240_000)
    .start()
  url = `postgresql://postgres:test@${container.getHost()}:${container.getMappedPort(5432)}/orbetra`
}, 240_000)

afterAll(async () => {
  await container?.stop()
})

const q = async <T extends pg.QueryResultRow>(sql: string, params?: unknown[]): Promise<T[]> => {
  const c = new pg.Client({ connectionString: url })
  await c.connect()
  try {
    return (await c.query<T>(sql, params as never)).rows
  } finally {
    await c.end()
  }
}

function prismaDeploy(): string {
  return execFileSync('pnpm', ['exec', 'prisma', 'migrate', 'deploy'], {
    cwd: PKG_DIR,
    env: { ...process.env, DATABASE_URL: url },
    encoding: 'utf8',
  })
}

describe('E01-3 migrations (prisma deploy + raw SQL runner)', () => {
  it('applies from empty DB: 17 relational tables + hypertable + policies + cagg', async () => {
    prismaDeploy()
    const result = await migrate(url)
    expect(result.applied).toEqual([
      '001_positions.sql', '002_daily_device_stats.sql', '003_positions_server_time_brin.sql',
      // 004 repairs rows written before the null-island guard: a device reported 0/0 with 37
      // satellites, so §3.4's `fix_valid := satellites > 0` called it a valid fix, and the public
      // share link would have parked a customer's marker in the Gulf of Guinea.
      '004_null_island_fix_valid.sql',
    ])

    const tables = await q<{ table_name: string }>(
      `SELECT table_name FROM information_schema.tables WHERE table_schema='public'`,
    )
    const names = tables.map((t) => t.table_name)
    for (const t of ['tenants', 'accounts', 'users', 'devices', 'positions', 'geofences', 'audit_log']) {
      expect(names, t).toContain(t)
    }

    const hyper = await q<{ hypertable_name: string }>(
      `SELECT hypertable_name FROM timescaledb_information.hypertables`,
    )
    expect(hyper.map((h) => h.hypertable_name)).toContain('positions')

    // the usage-sweep BRIN index on server_time (003, audit P4) — windows the billable-day sweep on
    // ingest RECEIVE time so a buffered offline device's flush is not under-billed
    const idx = await q<{ indexname: string }>(
      `SELECT indexname FROM pg_indexes WHERE tablename='positions' AND indexname='positions_server_time_brin'`,
    )
    expect(idx.map((i) => i.indexname)).toContain('positions_server_time_brin')

    const jobs = await q<{ proc_name: string }>(
      `SELECT proc_name FROM timescaledb_information.jobs`,
    )
    const procs = jobs.map((j) => j.proc_name)
    expect(procs).toContain('policy_compression')
    expect(procs).toContain('policy_retention')
    expect(procs).toContain('policy_refresh_continuous_aggregate')

    const caggs = await q<{ view_name: string }>(
      `SELECT view_name FROM timescaledb_information.continuous_aggregates`,
    )
    expect(caggs.map((c) => c.view_name)).toContain('daily_device_stats')

    // §6.3 values, not just existence — R8-2/R8-3/ADR-007 hinge on these exact numbers
    const cfg = await q<{ proc_name: string; config: Record<string, string> }>(
      `SELECT proc_name, config FROM timescaledb_information.jobs WHERE proc_name LIKE 'policy_%'`,
    )
    const byProc = Object.fromEntries(cfg.map((j) => [j.proc_name, j.config]))
    expect(byProc['policy_compression']?.['compress_after']).toMatch(/14 day/)
    expect(byProc['policy_retention']?.['drop_after']).toMatch(/1 year 1 mon|13 mon/) // PG renders interval '13 months' as '1 year 1 mon'
    expect(byProc['policy_refresh_continuous_aggregate']?.['start_offset']).toMatch(/3 day/)
    expect(byProc['policy_refresh_continuous_aggregate']?.['end_offset']).toMatch(/01:00:00/)

    const dim = await q<{ time_interval: string }>(
      `SELECT time_interval::text FROM timescaledb_information.dimensions WHERE hypertable_name='positions'`,
    )
    expect(dim[0]?.time_interval).toMatch(/1 day/)
  }, 120_000)

  it('is idempotent: second run applies nothing, zero diff', async () => {
    const out = prismaDeploy()
    expect(out).toMatch(/No pending migrations|already in sync/i)
    const result = await migrate(url)
    expect(result.applied).toEqual([])
    expect(result.skipped).toEqual([
      '001_positions.sql', '002_daily_device_stats.sql', '003_positions_server_time_brin.sql',
      '004_null_island_fix_valid.sql',
    ])
  }, 60_000)

  it('refuses to run when an applied file was edited (append-only, rule 11)', async () => {
    await q(`CREATE DATABASE checksum_test`)
    const url2 = url.replace('/orbetra', '/checksum_test')
    const dir = mkdtempSync(path.join(tmpdir(), 'orbetra-sql-'))
    const file = path.join(dir, '001_thing.sql')
    writeFileSync(file, 'CREATE TABLE thing (id int);\n')
    await migrate(url2, dir)
    writeFileSync(file, 'CREATE TABLE thing (id int, extra text);\n')
    await expect(migrate(url2, dir)).rejects.toThrow(/immutable/)
  }, 60_000)

  /**
   * 004 is a DATA repair, and the only assertions on it were that its filename appears in
   * `applied` and later in `skipped`. That is shape, not behaviour: `lat = 0 OR lon = 0` — a
   * one-character slip that would invalidate every fix on the Greenwich meridian and the equator —
   * keeps those assertions green, and so does `14 hours`, and so does dropping the whole UPDATE.
   *
   * Run 001-003 on a clean database, plant the four shapes that matter, then let 004 land.
   */
  it('004 flips ONLY an exact 0/0 inside the window — meridian, equator and old rows survive', async () => {
    await q(`CREATE DATABASE nullisland_test`)
    const url2 = url.replace(/\/orbetra$/, '/nullisland_test')
    const q2 = async <T extends pg.QueryResultRow>(sql: string): Promise<T[]> => {
      const c = new pg.Client({ connectionString: url2 })
      await c.connect()
      try { return (await c.query<T>(sql)).rows } finally { await c.end() }
    }

    // 001-003 only: copied verbatim so their checksums still match when the real dir runs after
    const partial = mkdtempSync(path.join(tmpdir(), 'orbetra-sql-partial-'))
    for (const f of ['001_positions.sql', '002_daily_device_stats.sql', '003_positions_server_time_brin.sql']) {
      copyFileSync(path.join(PKG_DIR, 'sql', f), path.join(partial, f))
    }
    await migrate(url2, partial)

    await q2(`INSERT INTO positions (device_id, fix_time, lat, lon, satellites, fix_valid, rec_hash) VALUES
      (1, now() - interval '1 hour',  0,        0,        37, true,  1),   -- the incident: must flip
      (2, now() - interval '1 hour',  0,        0,        0,   false, 2),  -- already false: untouched
      (3, now() - interval '1 hour', 51.4778,   0,        12,  true,  3),  -- Greenwich meridian: REAL
      (4, now() - interval '1 hour',  0,       25.2797,   12,  true,  4),  -- equator: REAL
      (5, now() - interval '30 days', 0,        0,        37, true,  5)`)  // outside the window

    const applied = await migrate(url2)
    expect(applied.applied).toContain('004_null_island_fix_valid.sql')

    const rows = await q2<{ device_id: string; fix_valid: boolean }>(
      `SELECT device_id, fix_valid FROM positions ORDER BY device_id`,
    )
    const byId = Object.fromEntries(rows.map((r) => [String(r.device_id), r.fix_valid]))
    expect(byId['1']).toBe(false) // repaired
    expect(byId['2']).toBe(false) // was already false
    expect(byId['3']).toBe(true)  // lon = 0 alone is a place — Greenwich
    expect(byId['4']).toBe(true)  // lat = 0 alone is a place — the equator
    expect(byId['5']).toBe(true)  // outside 14 days: deliberately NOT repaired, and counted instead
  }, 240_000)

  it('geofences.geom is a PostGIS geography column (raw accessors ready)', async () => {
    const cols = await q<{ udt_name: string }>(
      `SELECT udt_name FROM information_schema.columns WHERE table_name='geofences' AND column_name='geom'`,
    )
    expect(cols[0]?.udt_name).toBe('geography')
  })
})
