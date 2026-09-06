import { describe, expect, it } from 'vitest'

import { renderBrandedEmail, resetEmailPlatform } from '../src/email.js'
import { whiteLabelFromPlan } from '../src/plans.js'

/**
 * Whose identity does a message wear? (audit W-4)
 *
 * The renderer used to answer by counting branding keys, which is a proxy for the entitlement and is
 * wrong in the one direction that costs us: a `tsp_*` tenant who has not saved a single field took
 * the PLATFORM branch, so our wordmark and our footer went out in mail to their own customers — at
 * exactly the moment they onboard their first one.
 */
describe('renderBrandedEmail decides by the entitlement, not by counting keys', () => {
  const content = { subject: 'Reset your password', bodyHtml: '<p>hi</p>' }

  it('a reseller with NO branding saved still gets THEIR identity, never ours', () => {
    resetEmailPlatform()
    const html = renderBrandedEmail({}, 'VrummTrack UAB', content, { whiteLabel: true })
    expect(html).toContain('VrummTrack UAB')
    expect(html).not.toContain('Orbetra')
  })

  it('a tenant that is genuinely ours still gets the platform identity', () => {
    resetEmailPlatform()
    const html = renderBrandedEmail({ primary: '#112233' }, 'Some Fleet Ltd', content, { whiteLabel: false })
    expect(html).toContain('Orbetra')
    // …and NOT the customer's own company name, which is a strange thing to sign our mail with
    expect(html).not.toContain('Some Fleet Ltd')
  })

  it('the flag OVERRIDES the key count in both directions', () => {
    resetEmailPlatform()
    // rich branding + whiteLabel:false ⇒ platform. Without the flag this object would say "reseller".
    expect(renderBrandedEmail({ productName: 'Dokigo', primary: '#46D993' }, 'X', content, { whiteLabel: false })).toContain('Orbetra')
    // empty branding + whiteLabel:true ⇒ reseller. Without the flag this object would say "ours".
    expect(renderBrandedEmail({}, 'Dokigo', content, { whiteLabel: true })).not.toContain('Orbetra')
  })

  it('with NO flag the old key-count fallback still stands — the partner path depends on it', () => {
    resetEmailPlatform()
    // Affiliate notices are OURS by design and pass `{}` with no tenant behind them.
    expect(renderBrandedEmail({}, 'Orbetra', content)).toContain('Orbetra')
    expect(renderBrandedEmail({ productName: 'Dokigo' }, 'X', content)).toContain('Dokigo')
  })
})

/**
 * `undefined` and `false` are NOT interchangeable here: `false` asserts "this tenant is ours", which
 * is the claim that puts our wordmark in front of a reseller's customers.
 */
describe('whiteLabelFromPlan answers "unknown" rather than guessing', () => {
  it('reads every real plan', () => {
    expect(whiteLabelFromPlan('tsp_start')).toBe(true)
    expect(whiteLabelFromPlan('tsp_enterprise')).toBe(true)
    expect(whiteLabelFromPlan('direct_5')).toBe(false)
    expect(whiteLabelFromPlan('direct_100')).toBe(false)
  })

  it('returns undefined — not false — for anything it cannot read', () => {
    // a column the query forgot, a value from a newer build, a schema skew mid-deploy
    for (const v of [null, undefined, '', 'tsp_unknown', 'nonsense']) {
      expect(whiteLabelFromPlan(v), String(v)).toBeUndefined()
    }
  })
})
