import pg from 'pg'

/**
 * pg Pool factory — the ONLY entry to the raw-SQL side (positions hypertable).
 * Prisma never touches positions (CLAUDE.md rule 1 / ADR-003 boundary);
 * scoped repositories (E03-2) own the relational side.
 *
 * THREE THINGS THIS POOL MUST NOT DO AGAIN (audit MED #30):
 *
 *  1. **Queue an acquire forever.** With no `connectionTimeoutMillis`, node-postgres pushes a
 *     pending acquire onto a queue with NO timer (`pg-pool/index.js`: the timeout branch is only
 *     taken when the option is set). The worker's single pool is shared by 16 shard consumers AND
 *     12 BullMQ workers — 30+ potential concurrent acquirers against a default max of 10 — so under
 *     load `writePositions` simply waits, with no error, no log and no metric. The operator sees
 *     `pipeline_lag_ms` climbing and ingest's backpressure pausing sockets, with nothing pointing at
 *     the pool. A bounded acquire turns that into a loud, retryable failure.
 *  2. **Run a statement forever.** No `statement_timeout` meant one pathological query — the
 *     fleet-wide 48 h `SELECT DISTINCT … FROM positions`, a 400-day per-device scan, a bulk GDPR
 *     erase — pinned a client with no self-healing. Combined with (1) that is how a pool of 10
 *     stops the pipeline: ingest has already ACKed the device (so the tracker dropped its buffer)
 *     while `raw:<shard>` walks toward its `MAXLEN ~100_000` trim, i.e. permanent loss of positions
 *     the device was told were safe.
 *  3. **Be invisible.** `waitingCount` is exported so saturation is a graph, not a guess.
 *
 * Defaults are deliberately generous — the point is a ceiling that turns an unbounded stall into an
 * error, not a tight SLA. Both are env-tunable per app.
 */
export interface PoolOptions {
  /** connections (env `PG_POOL_MAX`). The worker needs more than the API: it serves 16 shard
   *  consumers plus a dozen job workers from one pool. */
  max?: number
  /** ms to wait for a free connection before failing the acquire (env `PG_ACQUIRE_TIMEOUT_MS`). */
  acquireTimeoutMs?: number
  /** server-side `statement_timeout` in ms (env `PG_STATEMENT_TIMEOUT_MS`); 0 disables it. */
  statementTimeoutMs?: number
}

export const DEFAULT_POOL_MAX = 10
export const DEFAULT_ACQUIRE_TIMEOUT_MS = 10_000
/** 2 minutes: far above any healthy query here, far below "forever". The longest legitimate
 *  statements are the usage sweep's fleet-wide DISTINCT and the GDPR erase; if either exceeds this
 *  it is already failing, and a job that throws retries with a metric instead of pinning a client. */
export const DEFAULT_STATEMENT_TIMEOUT_MS = 120_000

/** Read pool settings from env, clamped. Invalid/absent values fall back to the defaults. */
export function poolOptionsFromEnv(env: NodeJS.ProcessEnv = process.env, defaults: PoolOptions = {}): Required<PoolOptions> {
  const num = (raw: string | undefined, fallback: number, lo: number, hi: number): number => {
    // EMPTY is absent, not zero. `Number('')` is 0 — finite, so it would pass the guard and then be
    // clamped to the FLOOR, i.e. the most dangerous legal value: pool max 1, acquire timeout 100 ms,
    // statement timeout off. And empty is exactly what this repo's compose produces: every optional
    // var is written `VAR: ${VAR:-}`, so an operator following the file's own idiom would have
    // dropped the worker to a single connection shared by 16 shard consumers.
    const trimmed = raw?.trim()
    if (trimmed === undefined || trimmed === '') return fallback
    const n = Number(trimmed)
    if (!Number.isFinite(n)) return fallback
    return Math.min(hi, Math.max(lo, Math.trunc(n)))
  }
  return {
    max: num(env['PG_POOL_MAX'], defaults.max ?? DEFAULT_POOL_MAX, 1, 200),
    acquireTimeoutMs: num(env['PG_ACQUIRE_TIMEOUT_MS'], defaults.acquireTimeoutMs ?? DEFAULT_ACQUIRE_TIMEOUT_MS, 100, 120_000),
    // 0 is meaningful (Postgres: no limit) and must survive the clamp, so the floor is 0
    statementTimeoutMs: num(env['PG_STATEMENT_TIMEOUT_MS'], defaults.statementTimeoutMs ?? DEFAULT_STATEMENT_TIMEOUT_MS, 0, 3_600_000),
  }
}

export function createPool(databaseUrl: string, opts: PoolOptions | number = {}): pg.Pool {
  // a bare number stays valid — this was `createPool(url, max)` before the options object
  const o = typeof opts === 'number' ? { max: opts } : opts
  const max = o.max ?? DEFAULT_POOL_MAX
  const acquireTimeoutMs = o.acquireTimeoutMs ?? DEFAULT_ACQUIRE_TIMEOUT_MS
  const statementTimeoutMs = o.statementTimeoutMs ?? DEFAULT_STATEMENT_TIMEOUT_MS
  const pool = new pg.Pool({
    connectionString: databaseUrl,
    max,
    connectionTimeoutMillis: acquireTimeoutMs,
    // node-postgres' FIRST-CLASS field, not `options: '-c statement_timeout=…'`. Both work, but pg
    // merges the parsed connection string OVER the config object, so a `?options=` already present
    // in DATABASE_URL (a timezone, an application_name) would replace ours wholesale and silently
    // switch the timeout back off — the entire fix evaporating with nothing to see. `statement_timeout`
    // has no such collision. It is applied per connection at startup, including to clients the pool
    // opens later to replace a retired one, so no fresh client's first query runs unbounded.
    // 0 ⇒ omit (Postgres default: no limit).
    ...(statementTimeoutMs > 0 ? { statement_timeout: statementTimeoutMs } : {}),
  })
  // node-postgres emits 'error' on behalf of IDLE clients (a backend restart/failover or a network
  // reset killing a pooled idle connection). With NO listener that unhandled 'error' crashes the
  // whole process — both apps/api and apps/worker build their pool here, so one transient PG blip
  // would take the REST API and the ingest-pipeline consumer down together (review MED). Log + let
  // the pool retire the dead client; the next acquire opens a fresh one.
  pool.on('error', (err) => {
    console.error('pg pool idle-client error', err instanceof Error ? err.message : String(err))
  })
  return pool
}

/** Live saturation of a pool, for a Prometheus collector. `waiting > 0` sustained ⇒ the pool is the
 *  bottleneck, which is exactly what nothing could see before. */
export function poolStats(pool: pg.Pool): { total: number; idle: number; waiting: number } {
  return { total: pool.totalCount, idle: pool.idleCount, waiting: pool.waitingCount }
}
