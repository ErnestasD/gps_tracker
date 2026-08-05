import { describe, expect, it } from 'vitest'

import { dbErrorHttp } from '../src/errors.js'

/**
 * dbErrorHttp — duck-typed Prisma-error → HTTP status map (the API's app.onError safety net).
 * Proves a malformed-UUID P2023 (the systemic 500 across item routes) becomes 404, a unique
 * clash 409, and anything non-Prisma stays null (→ generic 500).
 */
describe('dbErrorHttp', () => {
  it('maps P2023 (malformed uuid) and P2025 (not found) to 404', () => {
    expect(dbErrorHttp({ code: 'P2023' })).toEqual({ status: 404, title: 'Not Found' })
    expect(dbErrorHttp({ code: 'P2025' })).toEqual({ status: 404, title: 'Not Found' })
  })
  it('maps P2002 (unique constraint) to 409', () => {
    expect(dbErrorHttp({ code: 'P2002' })).toEqual({ status: 409, title: 'Conflict' })
  })
  it('returns null for non-Prisma / unknown errors (→ generic 500)', () => {
    expect(dbErrorHttp(new Error('boom'))).toBeNull()
    expect(dbErrorHttp({ code: 'P9999' })).toBeNull()
    expect(dbErrorHttp(null)).toBeNull()
    expect(dbErrorHttp('nope')).toBeNull()
    expect(dbErrorHttp(undefined)).toBeNull()
  })

  it('maps the constraint failures a CALLER can cause, and nothing else (audit MED)', () => {
    // A foreign-key restriction ("this account still has devices") and an oversize numeric cursor
    // are answers, not faults — they were raw 500s. Everything unmapped must KEEP 500ing: a
    // catch-all would turn every unknown fault into a plausible 4xx and hide it.
    expect(dbErrorHttp({ code: 'P2003' })).toEqual({
      status: 409,
      title: 'Conflict',
      detail: 'referenced record missing, or still in use by another record',
    })
    expect(dbErrorHttp({ code: 'P2020' })).toEqual({ status: 400, title: 'Bad Request', detail: 'value out of range' })
    // the detail names the CLASS of problem — never a constraint name, a table, or another tenant
    const detail = dbErrorHttp({ code: 'P2003' })?.detail ?? ''
    expect(detail).not.toMatch(/fkey|_id|tenant|devices|accounts/i)
    for (const code of ['P2010', 'P1001', 'P2034', undefined, 'nonsense']) {
      expect(dbErrorHttp({ code }), `${String(code)} must stay a 500`).toBeNull()
    }
  })
})