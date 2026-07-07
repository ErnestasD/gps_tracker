import { readFileSync, readdirSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

import { UNSCOPED_AUTH_METHODS } from '@orbetra/db'

const REPO_ROOT = resolve(import.meta.dirname, '../..')
const ROOTS = ['apps', 'packages', 'tools', 'tests']
const SKIP = new Set(['node_modules', 'dist', '.turbo', 'coverage', '.prisma'])

function walk(dir: string, out: string[]): void {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (SKIP.has(entry.name)) continue
    const full = join(dir, entry.name)
    if (entry.isDirectory()) walk(full, out)
    else if (/\.(ts|tsx)$/.test(entry.name)) out.push(full)
  }
}

/**
 * Lint-proof-as-test (E03-2 AC[4], committed): @prisma/client may be imported
 * ONLY inside packages/db (the scoped-repository layer, CLAUDE.md rule 2). A hard
 * test complements the eslint ban so a mis-configured eslint can't let a leak
 * through silently. Walks the WORKING TREE, so uncommitted files are covered too.
 */
describe('E03-2 AC[4]: Prisma confined to packages/db', () => {
  it('no @prisma/client import lives outside packages/db', () => {
    const files: string[] = []
    for (const root of ROOTS) walk(join(REPO_ROOT, root), files)
    const dbDir = join(REPO_ROOT, 'packages', 'db')
    const offenders = files
      .filter((f) => !f.startsWith(dbDir))
      .filter((f) => /from ['"]@prisma\/client['"]|require\(['"]@prisma\/client['"]\)/.test(readFileSync(f, 'utf8')))
      .map((f) => f.slice(REPO_ROOT.length + 1))
    expect(offenders, 'these files import @prisma/client outside packages/db').toEqual([])
  })

  it('the auth-method exemption list is the documented single source (no silent growth)', () => {
    // guards against E03-2+ code quietly adding unscoped methods without an ADR
    expect(UNSCOPED_AUTH_METHODS).toEqual(['users.findByEmailAllTenants', 'users.findByIdForAuth', 'refreshTokens.*'])
  })
})
