import { createHash } from 'node:crypto'
import { readdirSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

import pg from 'pg'

/**
 * Tiny raw-SQL migrator for the Timescale/PostGIS side (PROJECT_PLAN §5).
 * Prisma owns relational tables; numbered files here own hypertable DDL.
 * - lexical order, one transaction per file (unless `-- migrate:no-transaction`)
 * - schema_migrations(name, checksum): applied files are immutable — a changed
 *   checksum ABORTS the run (append-only enforcement, CLAUDE.md rule 11)
 */
const SQL_DIR = path.dirname(fileURLToPath(import.meta.url))

export interface MigrateResult {
  applied: string[]
  skipped: string[]
}

export async function migrate(databaseUrl: string, dir: string = SQL_DIR): Promise<MigrateResult> {
  const client = new pg.Client({ connectionString: databaseUrl })
  await client.connect()
  const result: MigrateResult = { applied: [], skipped: [] }
  try {
    await client.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
      name text PRIMARY KEY, checksum text NOT NULL, applied_at timestamptz NOT NULL DEFAULT now()
    )`)

    const files = readdirSync(dir)
      .filter((f) => /^\d+_.+\.sql$/.test(f))
      .sort((a, b) => parseInt(a, 10) - parseInt(b, 10) || a.localeCompare(b))

    for (const file of files) {
      const sql = readFileSync(path.join(dir, file), 'utf8')
      const checksum = createHash('sha256').update(sql).digest('hex')
      const prior = await client.query<{ checksum: string }>(
        'SELECT checksum FROM schema_migrations WHERE name = $1',
        [file],
      )
      if (prior.rows.length > 0) {
        if (prior.rows[0]!.checksum !== checksum) {
          throw new Error(
            `${file} was already applied with a different checksum — applied migrations are immutable (append a new numbered file instead)`,
          )
        }
        result.skipped.push(file)
        continue
      }

      const noTx = sql.includes('-- migrate:no-transaction')
      if (noTx) {
        // RECOVERY NOTE: a crash between the DDL and the bookkeeping INSERT leaves the
        // object created but unrecorded; the rerun then fails on "already exists".
        // Manual fix: verify the object matches the file, then INSERT the row into
        // schema_migrations by hand. Kept simple deliberately — only caggs live here.
        await client.query(sql)
        await client.query('INSERT INTO schema_migrations (name, checksum) VALUES ($1, $2)', [
          file,
          checksum,
        ])
      } else {
        await client.query('BEGIN')
        try {
          await client.query(sql)
          await client.query('INSERT INTO schema_migrations (name, checksum) VALUES ($1, $2)', [
            file,
            checksum,
          ])
          await client.query('COMMIT')
        } catch (err) {
          await client.query('ROLLBACK')
          throw err
        }
      }
      result.applied.push(file)
    }
  } finally {
    await client.end()
  }
  return result
}

// CLI: DATABASE_URL=... tsx packages/db/sql/migrate.ts
if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const url = process.env['DATABASE_URL']
  if (!url) {
    console.error('DATABASE_URL is required')
    process.exit(2)
  }
  migrate(url)
    .then((r) => {
      console.log(`applied: ${r.applied.join(', ') || '(none)'}; skipped: ${r.skipped.length}`)
    })
    .catch((err: unknown) => {
      console.error(err instanceof Error ? err.message : err)
      process.exit(1)
    })
}
