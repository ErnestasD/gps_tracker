import { ruleKindSchema } from '@orbetra/shared'
import { describe, expect, it } from 'vitest'

import { RULE_KINDS, configFields } from '../src/lib/rules.js'

describe('E05-3 client/server contract', () => {
  it('RULE_KINDS is set-equal to the server ruleKindSchema (guards silent 400 on drift)', () => {
    expect([...RULE_KINDS].sort()).toEqual([...ruleKindSchema.options].sort())
  })
})

describe('E05-3 rule config fields', () => {
  it('overspeed exposes a speed threshold', () => {
    const f = configFields('overspeed')
    expect(f.map((x) => x.key)).toEqual(['speedKmh'])
    expect(f[0]!.type).toBe('number')
    expect(f[0]!.default).toBe(90)
  })

  it('geofence exposes a geofence select + enter/exit/both', () => {
    const f = configFields('geofence')
    expect(f.map((x) => x.key)).toEqual(['geofenceId', 'on'])
    expect(f[1]!.options).toEqual(['enter', 'exit', 'both'])
  })

  it('low_battery / device_offline have their own thresholds', () => {
    expect(configFields('low_battery')[0]!.key).toBe('thresholdV')
    expect(configFields('device_offline')[0]!.key).toBe('afterH')
  })

  it('event-driven kinds have no config fields', () => {
    for (const k of ['ignition', 'din_change', 'power_cut', 'panic'] as const) {
      expect(configFields(k)).toEqual([])
    }
  })

  it('every RuleKind is handled (no throw)', () => {
    for (const k of RULE_KINDS) expect(Array.isArray(configFields(k))).toBe(true)
  })
})
