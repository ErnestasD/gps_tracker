import { describe, expect, it } from 'vitest'

import { buildAffiliatePatch, type AffiliateView } from '../src/lib/affiliates'

/**
 * The edit panel's diff. Every case here is a money bug that renders identically to a correct save,
 * which is why the logic was pulled out of the component to be reachable at all.
 */
const partner: AffiliateView = {
  id: 'a1',
  name: 'Baltic Fleet Partners',
  email: 'p@partner.co',
  code: 'BALTIC25',
  commissionPct: '25.00', // Decimal, serialized as a string by the API
  commissionMonths: 12,
  status: 'active',
  createdAt: '2026-01-01T00:00:00.000Z',
}
const draft = (over: Partial<{ name: string; pct: string; months: string }> = {}) => ({
  name: partner.name,
  pct: '25',
  months: '12',
  ...over,
})

describe('buildAffiliatePatch', () => {
  it('sends nothing when nothing changed', () => {
    // `{}` is valid against the partial schema, so without this the server writes an audit row with
    // an identical before and after every time someone opens the panel and presses Save
    expect(buildAffiliatePatch(partner, draft())).toBeNull()
  })

  it('sends only the field that changed', () => {
    expect(buildAffiliatePatch(partner, draft({ pct: '30' }))).toEqual({ commissionPct: 30 })
    expect(buildAffiliatePatch(partner, draft({ months: '24' }))).toEqual({ commissionMonths: 24 })
    expect(buildAffiliatePatch(partner, draft({ name: 'Baltic Fleet' }))).toEqual({ name: 'Baltic Fleet' })
  })

  it('compares the rate NUMERICALLY, so 25 does not "differ" from the stored 25.00', () => {
    expect(buildAffiliatePatch(partner, draft({ pct: '25.00' }))).toBeNull()
    expect(buildAffiliatePatch(partner, draft({ pct: '25.0' }))).toBeNull()
  })

  it('ignores whitespace-only edits to the name', () => {
    // a stored name with a stray trailing space would otherwise look changed on every single open,
    // and every save would carry a name mutation nobody made
    expect(buildAffiliatePatch({ ...partner, name: 'Acme ' }, draft({ name: 'Acme' }))).toBeNull()
  })

  it('never sends a cleared or non-numeric money field', () => {
    // Number('') is 0 — a cleared percentage box would silently patch the partner to 0% commission
    expect(buildAffiliatePatch(partner, draft({ pct: '' }))).toBeNull()
    expect(buildAffiliatePatch(partner, draft({ pct: '  ' }))).toBeNull()
    expect(buildAffiliatePatch(partner, draft({ pct: 'abc' }))).toBeNull()
    expect(buildAffiliatePatch(partner, draft({ months: '' }))).toBeNull()
  })

  it('an explicit 0% IS a change — it is a decision, not an empty box', () => {
    expect(buildAffiliatePatch(partner, draft({ pct: '0' }))).toEqual({ commissionPct: 0 })
  })

  it('diffs against the BASELINE it was given, not against whatever the row says now', () => {
    // the concurrency case: the panel opened at 25%, another admin raised the row to 30% underneath,
    // and this admin only edited the name. The rate must NOT be in the patch — sending 25 here is
    // what silently reverts the other admin's raise.
    const opened = partner // what the sheet captured when it opened
    const patch = buildAffiliatePatch(opened, draft({ name: 'Baltic Fleet' }))
    expect(patch).toEqual({ name: 'Baltic Fleet' })
    expect(patch).not.toHaveProperty('commissionPct')
  })
})
