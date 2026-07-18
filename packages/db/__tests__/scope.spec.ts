import { describe, expect, it } from 'vitest'

import { scopedWhere } from '../src/scope.js'

describe('scopedWhere (E03-2 — the tenant boundary)', () => {
  it('tenant-wide scope constrains tenantId only (sees all accounts)', () => {
    expect(scopedWhere({ tenantId: 't1' })).toEqual({ tenantId: 't1' })
  })

  it('account scope constrains accountId by equality (non-null model)', () => {
    expect(scopedWhere({ tenantId: 't1', accountId: 'a1' })).toEqual({ tenantId: 't1', accountId: 'a1' })
  })

  it('nullable-account model: account user also sees tenant-shared (null) rows', () => {
    // OR form (own account OR null), not `{ in: ['a1', null] }` — Prisma rejects a null
    // inside `in` at runtime (500), so this must stay an OR so account-scoped reads of
    // nullableAccount entities (webhooks/api_keys/webhook_deliveries) actually work.
    expect(scopedWhere({ tenantId: 't1', accountId: 'a1' }, { nullableAccount: true })).toEqual({
      tenantId: 't1',
      OR: [{ accountId: 'a1' }, { accountId: null }],
    })
  })

  it('tenantId is ALWAYS present — no scope can omit the cross-tenant boundary', () => {
    for (const s of [{ tenantId: 't1' }, { tenantId: 't1', accountId: 'a1' }]) {
      expect(scopedWhere(s)).toHaveProperty('tenantId', 't1')
    }
  })
})
