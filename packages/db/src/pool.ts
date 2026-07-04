import pg from 'pg'

/**
 * pg Pool factory — the ONLY entry to the raw-SQL side (positions hypertable).
 * Prisma never touches positions (CLAUDE.md rule 1 / ADR-003 boundary);
 * scoped repositories (E03-2) will own the relational side.
 */
export function createPool(databaseUrl: string, max = 10): pg.Pool {
  return new pg.Pool({ connectionString: databaseUrl, max })
}
