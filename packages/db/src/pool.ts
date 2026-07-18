import pg from 'pg'

/**
 * pg Pool factory — the ONLY entry to the raw-SQL side (positions hypertable).
 * Prisma never touches positions (CLAUDE.md rule 1 / ADR-003 boundary);
 * scoped repositories (E03-2) will own the relational side.
 */
export function createPool(databaseUrl: string, max = 10): pg.Pool {
  const pool = new pg.Pool({ connectionString: databaseUrl, max })
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
