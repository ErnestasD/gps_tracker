import { gunzipSync } from 'node:zlib'
import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import pg from 'pg'
import { GenericContainer, Wait, type StartedTestContainer } from 'testcontainers'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { migrate } from '../../../packages/db/sql/migrate.js'
import { runExport } from '../src/jobs/gdprExportWorker.js'

/**
 * E08-4 account export against real pg: one NDJSON.gz with every section, scoped strictly
 * to the job's tenant+account; users NEVER carry passwordHash, webhooks NEVER carry secret;
 * positions stream completely (keyset pages). The job row is driven to done+sizeBytes.
 */
const IMAGE = 'timescale/timescaledb-ha:pg16'
const T1 = '00000000-0000-0000-0000-0000000000b1'
const A1 = '00000000-0000-0000-0000-0000000000c1'
const A2 = '00000000-0000-0000-0000-0000000000c2'
const JOB = '00000000-0000-0000-0000-0000000000e1'

let container: StartedTestContainer
let pool: pg.Pool
let exportDir: string

beforeAll(async () => {
  container = await new GenericContainer(IMAGE)
    .withEnvironment({ POSTGRES_PASSWORD: 'test', POSTGRES_DB: 'exp' })
    .withExposedPorts(5432)
    .withWaitStrategy(Wait.forLogMessage(/database system is ready to accept connections/, 2))
    .withStartupTimeout(240_000)
    .start()
  const url = `postgresql://postgres:test@${container.getHost()}:${container.getMappedPort(5432)}/exp`
  await migrate(url)
  pool = new pg.Pool({ connectionString: url })
  exportDir = mkdtempSync(join(tmpdir(), 'orbetra-export-'))

  await pool.query(`CREATE EXTENSION IF NOT EXISTS postgis`)
  await pool.query(`CREATE TABLE accounts (id uuid PRIMARY KEY, "tenantId" uuid, name text, timezone text, "createdAt" timestamptz DEFAULT now())`)
  await pool.query(`CREATE TABLE users (id uuid DEFAULT gen_random_uuid() PRIMARY KEY, "tenantId" uuid, "accountId" uuid, email text, role text, locale text, "passwordHash" text, "createdAt" timestamptz DEFAULT now())`)
  await pool.query(`CREATE TABLE devices (id bigint PRIMARY KEY, "tenantId" uuid, "accountId" uuid, imei text, name text, plate text, "groupName" text, "odometerSource" text DEFAULT 'auto', "retiredAt" timestamptz, "createdAt" timestamptz DEFAULT now())`)
  await pool.query(`CREATE TABLE trips (id bigserial PRIMARY KEY, "tenantId" uuid, "accountId" uuid, "deviceId" bigint, status text, "startTime" timestamptz, "endTime" timestamptz, "startLat" float, "startLon" float, "endLat" float, "endLon" float, "distanceM" int DEFAULT 0, "distanceSource" text DEFAULT 'gps', "maxSpeed" int DEFAULT 0, "idleS" int DEFAULT 0)`)
  await pool.query(`CREATE TABLE events (id bigserial PRIMARY KEY, "tenantId" uuid, "accountId" uuid, "deviceId" bigint, "ruleId" uuid, kind text, at timestamptz, lat float, lon float, payload jsonb DEFAULT '{}', "acknowledgedAt" timestamptz)`)
  await pool.query(`CREATE TABLE commands (id uuid DEFAULT gen_random_uuid() PRIMARY KEY, "tenantId" uuid, "accountId" uuid, "deviceId" bigint, text text, status text, response text, "createdAt" timestamptz DEFAULT now(), "sentAt" timestamptz)`)
  await pool.query(`CREATE TABLE geofences (id uuid DEFAULT gen_random_uuid() PRIMARY KEY, "tenantId" uuid, "accountId" uuid, name text, color text, kind text, geom geography(Polygon,4326), "createdAt" timestamptz DEFAULT now())`)
  await pool.query(`CREATE TABLE rules (id uuid DEFAULT gen_random_uuid() PRIMARY KEY, "tenantId" uuid, "accountId" uuid, kind text, name text, config jsonb DEFAULT '{}', scope jsonb DEFAULT '{}', "cooldownS" int DEFAULT 300, enabled bool DEFAULT true, "createdAt" timestamptz DEFAULT now())`)
  await pool.query(`CREATE TABLE webhooks (id uuid DEFAULT gen_random_uuid() PRIMARY KEY, "tenantId" uuid, "accountId" uuid, url text, secret text, events text[] DEFAULT '{}', enabled bool DEFAULT true, "createdAt" timestamptz DEFAULT now())`)
  await pool.query(`CREATE TABLE export_jobs (id uuid PRIMARY KEY, "tenantId" uuid, "accountId" uuid, status text DEFAULT 'pending', path text, "sizeBytes" bigint, error text, "createdAt" timestamptz DEFAULT now(), "expiresAt" timestamptz)`)

  await pool.query(`INSERT INTO accounts VALUES ($1, $2, 'Fleet One', 'Europe/Vilnius')`, [A1, T1])
  await pool.query(`INSERT INTO accounts VALUES ($1, $2, 'Fleet Two', 'UTC')`, [A2, T1])
  await pool.query(`INSERT INTO users ("tenantId","accountId",email,role,locale,"passwordHash") VALUES ($1,$2,'u@a1.test','viewer','lt','SUPER-SECRET-HASH')`, [T1, A1])
  await pool.query(`INSERT INTO devices (id,"tenantId","accountId",imei,name) VALUES (7,$1,$2,'356307042440040','Van'), (8,$1,$3,'356307042440041','OtherAcct')`, [T1, A1, A2])
  await pool.query(`INSERT INTO trips ("tenantId","accountId","deviceId",status,"startTime") VALUES ($1,$2,7,'closed',now())`, [T1, A1])
  await pool.query(`INSERT INTO events ("tenantId","accountId","deviceId",kind,at) VALUES ($1,$2,7,'panic',now())`, [T1, A1])
  await pool.query(`INSERT INTO commands ("tenantId","accountId","deviceId",text,status) VALUES ($1,$2,7,'getinfo','acked')`, [T1, A1])
  // OTHER-account rows in every paged table — the scoping filter must exclude them all
  await pool.query(`INSERT INTO trips ("tenantId","accountId","deviceId",status,"startTime") VALUES ($1,$2,8,'closed',now())`, [T1, A2])
  await pool.query(`INSERT INTO events ("tenantId","accountId","deviceId",kind,at) VALUES ($1,$2,8,'panic',now())`, [T1, A2])
  await pool.query(`INSERT INTO commands ("tenantId","accountId","deviceId",text,status) VALUES ($1,$2,8,'getver','acked')`, [T1, A2])
  await pool.query(`INSERT INTO geofences ("tenantId","accountId",name,color,kind,geom) VALUES ($1,$2,'Depot','#fff','polygon', ST_GeogFromText('POLYGON((25.2 54.6,25.3 54.6,25.3 54.7,25.2 54.6))'))`, [T1, A1])
  await pool.query(`INSERT INTO rules ("tenantId","accountId",kind,name) VALUES ($1,$2,'panic','Panic rule')`, [T1, A1])
  await pool.query(`INSERT INTO webhooks ("tenantId","accountId",url,secret) VALUES ($1,$2,'https://example.test/hook','THE-HMAC-SECRET')`, [T1, A1])
  // 12_500 positions for device 7 → proves >1 keyset page (10k page size)
  const values: string[] = []
  for (let i = 0; i < 12_500; i++) values.push(`(7, TIMESTAMPTZ '2026-06-01' + interval '${i} seconds', 54.7, 25.3, true, ${i + 1})`)
  await pool.query(`INSERT INTO positions (device_id, fix_time, lat, lon, fix_valid, rec_hash) VALUES ${values.join(',')}`)
  await pool.query(`INSERT INTO positions (device_id, fix_time, lat, lon, fix_valid, rec_hash) VALUES (8, '2026-06-01', 54.7, 25.3, true, 999999)`)
  await pool.query(`INSERT INTO export_jobs (id,"tenantId","accountId","expiresAt") VALUES ($1,$2,$3, now() + interval '7 days')`, [JOB, T1, A1])
}, 300_000)

afterAll(async () => {
  await pool?.end()
  await container?.stop()
})

describe('E08-4 runExport (real pg)', () => {
  it('writes a complete, scoped NDJSON.gz and marks the job done', async () => {
    const r = await runExport(pool, exportDir, JOB)
    expect(r.bytes).toBeGreaterThan(0)

    const job = (await pool.query<{ status: string; path: string; sizeBytes: string }>(`SELECT status, path, "sizeBytes" FROM export_jobs WHERE id=$1`, [JOB])).rows[0]!
    expect(job.status).toBe('done')
    expect(Number(job.sizeBytes)).toBe(r.bytes)

    const lines = gunzipSync(readFileSync(job.path)).toString('utf8').trim().split('\n').map((l) => JSON.parse(l) as { type: string; data: Record<string, unknown> })
    const byType = (t: string) => lines.filter((l) => l.type === t)

    expect(byType('meta')).toHaveLength(1)
    expect(byType('account')).toHaveLength(1)
    expect(byType('user')).toHaveLength(1)
    expect(byType('device')).toHaveLength(1) // ONLY the A1 device — A2's is out of scope
    expect(byType('trip')).toHaveLength(1) // A2's trip excluded (accountId scoping)
    expect(byType('event')).toHaveLength(1) // A2's event excluded
    expect(byType('command')).toHaveLength(1) // A2's command excluded ('getver' never appears)
    expect(byType('command')[0]!.data['text']).toBe('getinfo')
    expect(byType('geofence')).toHaveLength(1)
    expect(byType('rule')).toHaveLength(1)
    expect(byType('webhook')).toHaveLength(1)
    expect(byType('position')).toHaveLength(12_500) // full history across keyset pages, device 8 excluded

    // the two most dangerous columns NEVER appear anywhere in the file
    const raw = gunzipSync(readFileSync(job.path)).toString('utf8')
    expect(raw).not.toContain('SUPER-SECRET-HASH')
    expect(raw).not.toContain('THE-HMAC-SECRET')
    expect(byType('geofence')[0]!.data['geometry']).toContain('Polygon')
  })

  it('throws on an unknown job id (BullMQ retries; status untouched)', async () => {
    await expect(runExport(pool, exportDir, '00000000-0000-0000-0000-00000000dead')).rejects.toThrow(/not found/)
  })
})
