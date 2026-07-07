import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

import { ROLES, roleSchema } from '../src/roles.js'

describe('roles contract', () => {
  it('mirrors the Prisma Role enum exactly (order-insensitive, set-equal)', () => {
    const schema = readFileSync(
      resolve(import.meta.dirname, '../../db/prisma/schema.prisma'),
      'utf8',
    )
    const match = /enum Role \{([^}]+)\}/.exec(schema)
    expect(match).not.toBeNull()
    const prismaRoles = match![1]!
      .split('\n')
      .map((l) => l.trim())
      .filter((l) => l !== '' && !l.startsWith('//'))
    expect([...prismaRoles].sort()).toEqual([...ROLES].sort())
  })

  it('roleSchema accepts each role and rejects unknowns', () => {
    for (const r of ROLES) expect(roleSchema.parse(r)).toBe(r)
    expect(roleSchema.safeParse('admin').success).toBe(false)
    expect(roleSchema.safeParse('').success).toBe(false)
  })
})
