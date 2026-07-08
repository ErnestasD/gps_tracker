import { execFileSync } from 'node:child_process'
import { mkdtempSync, writeFileSync } from 'node:fs'
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
    expect(result.applied).toEqual(['001_positions.sql', '002_daily_device_stats.sql'])

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
    expect(result.skipped).toEqual(['001_positions.sql', '002_daily_device_stats.sql'])
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

  it('geofences.geom is a PostGIS geography column (raw accessors ready)', async () => {
    const cols = await q<{ udt_name: string }>(
      `SELECT udt_name FROM information_schema.columns WHERE table_name='geofences' AND column_name='geom'`,
    )
    expect(cols[0]?.udt_name).toBe('geography')
  })
})
