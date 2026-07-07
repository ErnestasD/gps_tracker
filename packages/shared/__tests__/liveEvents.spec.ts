import { describe, expect, it } from 'vitest'

import { liveEventSchema } from '../src/liveEvents.js'

describe('liveEventSchema', () => {
  // Literal mirror of the `compact` object built in apps/worker/src/liveState.ts —
  // if a field is added/renamed/retyped there, this fixture must be updated in the
  // same PR or the schema drifts from the wire (drift tripwire).
  const compact = {
    deviceId: '42',
    accountId: 'acc-a',
    fixTimeMs: 1_751_600_000_000,
    lat: 54.687157,
    lon: 25.279652,
    speed: 47,
    course: 132,
    satellites: 11,
    fixValid: true,
    ignition: true,
    priority: 0,
  }

  it('parses the exact producer shape', () => {
    expect(liveEventSchema.parse(compact)).toEqual(compact)
  })

  it('parses the nullable variant (unmapped account, no GPS extras)', () => {
    const nulls = { ...compact, accountId: null, speed: null, course: null, ignition: null }
    expect(liveEventSchema.parse(nulls)).toEqual(nulls)
  })

  it('accepts invalid-fix records (satellites 0, fixValid false)', () => {
    const invalidFix = { ...compact, satellites: 0, fixValid: false, priority: 1 }
    expect(liveEventSchema.parse(invalidFix)).toEqual(invalidFix)
  })

  it('rejects unknown priority and missing fields', () => {
    expect(liveEventSchema.safeParse({ ...compact, priority: 3 }).success).toBe(false)
    const missing: Partial<typeof compact> = { ...compact }
    delete missing.fixTimeMs
    expect(liveEventSchema.safeParse(missing).success).toBe(false)
  })
})
