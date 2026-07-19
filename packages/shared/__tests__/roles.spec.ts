import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

import { ROLES, roleSchema, canManageUser, canGrantRole } from '../src/roles.js'

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

  describe('canManageUser tier guard (audit HIGH: user-mutation privilege escalation)', () => {
    it('refuses a caller acting on a PEER or HIGHER tier', () => {
      expect(canManageUser('tsp_admin', 'platform_admin')).toBe(false) // the takeover vector
      expect(canManageUser('tsp_admin', 'tsp_admin')).toBe(false) // peer
      expect(canManageUser('account_manager', 'tsp_admin')).toBe(false)
      expect(canManageUser('account_manager', 'account_manager')).toBe(false)
      expect(canManageUser('viewer', 'viewer')).toBe(false)
    })
    it('allows a caller acting on a STRICTLY lower tier', () => {
      expect(canManageUser('tsp_admin', 'account_manager')).toBe(true)
      expect(canManageUser('tsp_admin', 'viewer')).toBe(true)
      expect(canManageUser('account_manager', 'viewer')).toBe(true)
    })
    it('platform_admin may manage anyone, including a peer platform_admin', () => {
      for (const r of ROLES) expect(canManageUser('platform_admin', r)).toBe(true)
    })
    it('is stricter than canGrantRole for a same-tier target (the exact bypass)', () => {
      // canGrantRole('tsp_admin','viewer') is true (demote), so the OLD PATCH would have run;
      // canManageUser still blocks acting on a platform_admin target regardless of the new role.
      expect(canGrantRole('tsp_admin', 'viewer')).toBe(true)
      expect(canManageUser('tsp_admin', 'platform_admin')).toBe(false)
    })
  })
})
