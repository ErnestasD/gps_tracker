import { describe, expect, it } from 'vitest'

import { SUPPORTED_LOCALES, localeUpdateSchema, ruleScopeSchema, userUpdateSchema } from '../src/entities.js'

/**
 * `userUpdateSchema.locale` accepted any 2–10 character string while the self-service route three
 * lines away used the enum (audit MED #65). The value is then looked up in an object literal when a
 * password-reset e-mail is rendered, so an admin typing `gb` or `en-US` set a locale nothing could
 * resolve — for a user who then could not read their own reset mail, and had no way to fix it.
 */
describe('userUpdateSchema', () => {
  it('accepts only the locales Orbetra actually ships — the SAME set the self-service route uses', () => {
    for (const l of SUPPORTED_LOCALES) {
      expect(userUpdateSchema.safeParse({ locale: l }).success, l).toBe(true)
      expect(localeUpdateSchema.safeParse({ locale: l }).success, l).toBe(true)
    }
    // plausible-looking values an admin would actually type, all previously accepted
    for (const l of ['gb', 'en-US', 'EN', 'ru', 'xx', 'english']) {
      expect(userUpdateSchema.safeParse({ locale: l }).success, l).toBe(false)
    }
  })

  it('stays a partial — an update that only changes the role must not require a locale', () => {
    expect(userUpdateSchema.safeParse({ role: 'viewer' }).success).toBe(true)
    expect(userUpdateSchema.safeParse({}).success).toBe(true)
  })
})

describe('ruleScopeSchema', () => {
  it('device ids are digits only — anything else validates and then matches nothing', () => {
    // the worker looks these up against `deviceId.toString()`, so "042" or " 42" would leave a rule
    // silently covering no devices at all
    expect(ruleScopeSchema.safeParse({ deviceIds: ['42', '1234567890123456789'] }).success).toBe(true)
    expect(ruleScopeSchema.parse({ deviceIds: [42] }).deviceIds).toEqual(['42']) // numbers coerce
    for (const bad of ['042', ' 42', '4.2e1', '', 'abc']) {
      expect(ruleScopeSchema.safeParse({ deviceIds: [bad] }).success, JSON.stringify(bad)).toBe(false)
    }
  })

  it('keeps unknown keys instead of rejecting OR silently dropping them', () => {
    // `scope` used to be a free record, so an old client may have stored more. Rejecting breaks it;
    // zod's default (strip) would delete the field on the next read-modify-write PATCH.
    expect(ruleScopeSchema.parse({ deviceIds: ['1'], groups: ['vans'] })).toEqual({ deviceIds: ['1'], groups: ['vans'] })
  })
})
