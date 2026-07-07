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
    expect(scopedWhere({ tenantId: 't1', accountId: 'a1' }, { nullableAccount: true })).toEqual({
      tenantId: 't1',
      accountId: { in: ['a1', null] },
    })
  })

  it('tenantId is ALWAYS present — no scope can omit the cross-tenant boundary', () => {
    for (const s of [{ tenantId: 't1' }, { tenantId: 't1', accountId: 'a1' }]) {
      expect(scopedWhere(s)).toHaveProperty('tenantId', 't1')
    }
  })
})
