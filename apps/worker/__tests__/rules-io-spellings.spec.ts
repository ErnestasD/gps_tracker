import type { NormalizedRecord } from '@orbetra/shared'
import { describe, expect, it } from 'vitest'

import { alarmOf, din1Of, unplugOf } from '../src/rules/io.js'

/**
 * The rule accessors, against the vocabulary the DEVICE actually writes.
 *
 * Once the profile selected the dictionary, an attrs key became the device's own table's name for
 * that id. These three accessors kept reading FMB120's spelling, so on the ATC/FTC families — where
 * the parameter EXISTS with the same meaning under a different name — the rule was accepted by the
 * API and then never fired. `power_cut` and `panic` are the two priority-2 kinds that bypass the
 * cooldown, i.e. exactly the ones a customer buys the hardware for.
 *
 * The counts below are from the 34 shipped dictionaries: id 252 is "Unplug" on 15 tables and
 * "Unplug detection" on 11; id 236 is "Alarm" on 16 and "Alarm button" on atc700; id 1 is "Digital
 * Input 1" on 27 and "Digital Input Status 1" on fm36.
 */
const rec = (attrs: Record<string, unknown>): NormalizedRecord =>
  ({ attrs } as unknown as NormalizedRecord)

describe('rule IO accessors read every spelling of one parameter', () => {
  it('power cut (AVL 252) — "Unplug" and "Unplug detection" are the same event', () => {
    for (const key of ['Unplug', 'Unplug detection', 'io_252']) {
      expect(unplugOf(rec({ [key]: 1 })), key).toBe(true)
      expect(unplugOf(rec({ [key]: 0 })), key).toBe(false)
    }
  })

  it('panic (AVL 236) — "Alarm" and "Alarm button" are the same event', () => {
    for (const key of ['Alarm', 'Alarm button', 'io_236']) {
      expect(alarmOf(rec({ [key]: 1 })), key).toBe(true)
    }
  })

  it('digital input 1 (AVL 1) — "Digital Input 1" and "Digital Input Status 1"', () => {
    for (const key of ['Digital Input 1', 'Digital Input Status 1', 'io_1']) {
      expect(din1Of(rec({ [key]: 1 })), key).toBe(true)
    }
  })

  it('a name that means something ELSE is NOT read — silence beats a false alert', () => {
    // On the six FMx6xx tables id 252 is "Authorized Driving" and id 236 is "Axis X". Those are
    // different parameters that happen to share a number, so the accessor must miss them. Before
    // the profile chose a dictionary every device decoded as FMB120 and this fired `panic` off an
    // accelerometer reading; not firing is wrong too, but it is the safe half of wrong, and the
    // README records the semantic index that fixes it properly.
    expect(alarmOf(rec({ 'Axis X': 4000 }))).toBeNull()
    expect(unplugOf(rec({ 'Authorized Driving': 1 }))).toBeNull()
  })

  it('the forced io_<id> key still wins when both are present', () => {
    // normalize writes `io_<id>` when a name is ambiguous within the table; that key is the
    // deterministic one, so it must take precedence over any spelling.
    expect(unplugOf(rec({ io_252: 1, Unplug: 0 }))).toBe(true)
  })
})
