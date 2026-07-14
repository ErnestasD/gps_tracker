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
})
