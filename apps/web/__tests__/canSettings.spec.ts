import { describe, expect, it } from 'vitest'

import {
  canChanges,
  DEFAULT_ON_PRIORITY,
  enabledCount,
  groupCanElements,
  isOn,
  onPriority,
  parseCanElements,
  PRIMARY_CAN_PARAMS,
  type CanElement,
} from '../src/lib/canSettings'

/**
 * What the CAN-parameter screen is allowed to send, and what it is allowed to believe.
 *
 * Two failures these guard against, both of which the tracking-settings card next door has already
 * had once:
 *  - transmitting values the customer never touched (there it armed Save with six factory numbers;
 *    here it would be an 83-parameter Codec 12 command for one flipped switch);
 *  - telling the customer something confident about hardware on the strength of a response we did
 *    not actually understand.
 */
const el = (p: Partial<CanElement> & { param: string }): CanElement => ({
  name: `Element ${p.param}`,
  enabled: false,
  priority: 0,
  ...p,
})

describe('parseCanElements', () => {
  it('accepts the contract shape', () => {
    const r = parseCanElements({
      supported: true,
      elements: [{ param: '45100', name: 'Vehicle Speed', enabled: false, priority: 0 }],
    })
    expect(r.supported).toBe(true)
    expect(r.elements).toEqual([{ param: '45100', name: 'Vehicle Speed', enabled: false, priority: 0 }])
  })

  it('keeps `supported: false` — the honest empty state depends on it being a real answer', () => {
    expect(parseCanElements({ supported: false, elements: [] })).toEqual({ supported: false, elements: [] })
  })

  /**
   * The live hazard: `/v1/devices/:id/can` is also the path of the older engine-snapshot read. A
   * trusting parse would see no `supported` field, take the falsy branch, and tell a customer whose
   * CAN bus demonstrably works that their model "has no CAN parameters". Refusing the body puts the
   * screen in its load-error state instead, which is the truth.
   */
  it('refuses a body that is not this endpoint (an engine snapshot, say) rather than reading it as unsupported', () => {
    expect(() => parseCanElements({ fixTime: 'x', rpm: 900, totalMileageKm: 12 })).toThrow()
    expect(() => parseCanElements(null)).toThrow()
    expect(() => parseCanElements({ supported: true })).toThrow()
    expect(() => parseCanElements({ supported: true, elements: [{ param: '45100' }] })).toThrow()
  })
})

describe('groupCanElements', () => {
  it('puts the shortlist first, in the shortlist order rather than numeric order', () => {
    const { primary } = groupCanElements([el({ param: '45150' }), el({ param: '45100' }), el({ param: '45140' })])
    expect(primary.map((e) => e.param)).toEqual(['45100', '45140', '45150'])
  })

  it('everything else keeps the order the API sent it in', () => {
    const { more } = groupCanElements([el({ param: '45800' }), el({ param: '45100' }), el({ param: '45360' })])
    expect(more.map((e) => e.param)).toEqual(['45800', '45360'])
  })

  /** The shortlist ORDERS what the model has; it never invents a toggle for an element the model
   *  does not carry — sending such a parameter to a device is exactly what the catalogue forbids. */
  it('never invents a row the model did not report', () => {
    const { primary, more } = groupCanElements([el({ param: '45100' })])
    expect(primary).toHaveLength(1)
    expect(more).toHaveLength(0)
  })

  it('an element we have never catalogued is still switchable, under "more"', () => {
    const { more } = groupCanElements([el({ param: '46000', name: 'Something New' })])
    expect(more.map((e) => e.param)).toEqual(['46000'])
  })

  it('the shortlist has no duplicates', () => {
    expect(new Set(PRIMARY_CAN_PARAMS).size).toBe(PRIMARY_CAN_PARAMS.length)
  })
})

describe('isOn / enabledCount', () => {
  it('the draft wins over what the device holds, so a switch does not fight the customer', () => {
    expect(isOn(el({ param: '45100', enabled: false }), { '45100': true })).toBe(true)
    expect(isOn(el({ param: '45100', enabled: true }), { '45100': false })).toBe(false)
  })

  it('untouched rows report the device state', () => {
    expect(isOn(el({ param: '45100', enabled: true }), {})).toBe(true)
  })

  it('counts the unsaved edits, because the header sits above the switches', () => {
    const els = [el({ param: '45100', enabled: true, priority: 1 }), el({ param: '45140' })]
    expect(enabledCount(els, {})).toBe(1)
    expect(enabledCount(els, { '45140': true })).toBe(2)
    expect(enabledCount(els, { '45100': false, '45140': true })).toBe(1)
  })
})

describe('onPriority', () => {
  it('switching something on means low priority — never high, which costs mobile data', () => {
    expect(onPriority(el({ param: '45100' }))).toBe(DEFAULT_ON_PRIORITY)
    expect(DEFAULT_ON_PRIORITY).toBe(1)
  })

  it('an element an installer set to high or panic comes back at that, not demoted to low', () => {
    expect(onPriority(el({ param: '45100', enabled: true, priority: 2 }))).toBe(2)
    expect(onPriority(el({ param: '45100', enabled: true, priority: 3 }))).toBe(3)
  })
})

describe('canChanges', () => {
  const els = [
    el({ param: '45100', enabled: false, priority: 0 }),
    el({ param: '45140', enabled: true, priority: 1 }),
    el({ param: '45150', enabled: true, priority: 2 }),
  ]

  it('an untouched card sends nothing', () => {
    expect(canChanges(els, {})).toEqual({})
  })

  it('switching on sends the priority, switching off sends 0', () => {
    expect(canChanges(els, { '45100': true })).toEqual({ '45100': 1 })
    expect(canChanges(els, { '45140': false })).toEqual({ '45140': 0 })
  })

  /** Re-sending a value the device already holds is a wasted command and, on a parked vehicle, a
   *  day of "queued" for a change that changes nothing. */
  it('a switch flipped off and back on again is not a change', () => {
    expect(canChanges(els, { '45140': true })).toEqual({})
  })

  it('sends ONLY what was touched, never the whole element list', () => {
    expect(canChanges(els, { '45100': true, '45150': false })).toEqual({ '45100': 1, '45150': 0 })
  })

  it('a high-priority element switched off and on again is restored, not demoted', () => {
    expect(canChanges(els, { '45150': false })).toEqual({ '45150': 0 })
    expect(canChanges(els, { '45150': true })).toEqual({}) // back to where the device already is
  })

  it('ignores draft entries for elements the model does not have', () => {
    expect(canChanges(els, { '49999': true })).toEqual({})
  })
})
