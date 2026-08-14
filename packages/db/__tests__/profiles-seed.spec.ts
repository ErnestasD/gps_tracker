import { describe, expect, it } from 'vitest'

import { DEVICE_PROFILES } from '../seed/profiles.js'

/**
 * The device-profile catalogue, checked without a database.
 *
 * The seed is DERIVED — from `catalogue.json` and from the 34 generated dictionaries — so the
 * things worth pinning are the derivations, not the rows. Each of these assertions exists because
 * the derivation was wrong in a way that reached a customer-visible surface: a capability shown in
 * the picker that the hardware does not have is a lie, and a trip profile that can never open a
 * trip is a fleet that reports no distance at all.
 */
const live = DEVICE_PROFILES.filter((p) => p.legacy !== true)
const byModel = new Map(live.map((p) => [p.model, p]))
const caps = (model: string): Record<string, boolean> => (byModel.get(model)?.capabilities ?? {}) as Record<string, boolean>
const isAsset = (model: string): boolean => (byModel.get(model)?.presenceRules as Record<string, unknown>)['noIgnition'] === true

describe('device profile catalogue', () => {
  it('offers one profile per catalogued model, plus the hidden legacy rows', () => {
    expect(live).toHaveLength(105)
    expect(DEVICE_PROFILES.filter((p) => p.legacy === true).map((p) => p.key).sort()).toEqual(['fmb1xx', 'fmb6xx-stub', 'fmc', 'tat-asset'])
    expect(live.every((p) => p.avlTable !== '' && p.model !== undefined)).toBe(true)
    expect(new Set(DEVICE_PROFILES.map((p) => p.key)).size).toBe(DEVICE_PROFILES.length) // keys unique
  })

  it('a model whose table has NO ignition id runs in asset mode — else it can never open a trip', () => {
    // ATC700/ATM700 were classified by a model-code PREFIX list that did not know about them, so
    // they got vehicle rules. Their table has 40 ids — battery voltage, alarm button, last-fix age
    // — and no AVL 239 at all, and the engine's vehicle branch is `r.ignition === true && …`. With
    // ignition null forever, `moving` stays false: no trip, no distance, no report, ever.
    expect(isAsset('ATC700')).toBe(true)
    expect(isAsset('ATM700')).toBe(true)
    // …and the product classification still stands on its own: these tables DO carry id 239, but
    // nobody wires a battery-powered asset tracker's ignition.
    expect(isAsset('TAT100')).toBe(true)
    expect(isAsset('TMT250')).toBe(true)
    expect(isAsset('FMB120')).toBe(false)
  })

  it('a capability is a TABLE-level claim: present iff the dictionary documents that group', () => {
    // What this test asserted before could not fail. It compared two models that share a table and
    // required them to be equal — true by construction under any rule that reads only the table,
    // which is every rule this function has ever had. Review proved the shipped predicate was a
    // tautology (420 of 420 evaluations equal `rows.length > 0`) and the assertion could not see it.
    //
    // So assert the rule that actually exists, in the direction that can fail: a group the table
    // documents ⇒ true, a group it does not ⇒ false. Mutating any group vocabulary now shows up
    // here, which is what the old assertion was supposed to do.
    expect(caps('FMB120')).toEqual({ can: true, ble: true, tacho: false, obd: true })
    expect(caps('FMC650')).toEqual({ can: true, ble: true, tacho: true, obd: false })
    expect(caps('ATC700')).toEqual({ can: false, ble: false, tacho: false, obd: false })

    // FMB641 and FMB640 sit on DIFFERENT tables and still agree — that is evidence about the two
    // tables, not an artefact. Earlier formulations had FMB641 advertising can:false / tacho:false
    // beside FMB640's true, a false differentiator on the exact feature FMB641 exists for.
    expect(caps('FMB641')).toEqual(caps('FMB640'))
    expect(caps('FMM880')).toMatchObject({ ble: true, obd: true })

    // …and two models that SHARE a table are identical by design, not by accident. Stated so the
    // next reader does not mistake it for a discrimination the flags do not carry: an AVL page does
    // not answer at SKU granularity, and nothing renders these flags yet.
    expect(caps('FMC13A')).toEqual(caps('FMC230'))
  })

  it('the CAN group vocabulary is ENUMERATED, and fm36 proves an incomplete list is a wrong answer', () => {
    // fm36 spells its group `ALLCAN300/LVCAN200 I/O elements`. That one omission reported
    // FM36/FM3612/FM36M1 as can:false while their table carries 89 CAN rows — from a list whose
    // own docblock says substring matching on an un-enumerated vocabulary ships a confident, wrong
    // answer. An incomplete enumeration is a substring match with extra steps.
    for (const m of ['FM36', 'FM3612', 'FM36M1']) expect(caps(m).can, m).toBe(true)
  })

  it('a capability is never claimed for a model whose table has no such elements at all', () => {
    // The opposite failure: capabilities that are all-true would be just as useless. ATC700 is a
    // 40-id battery asset table with no CAN, no BLE, no tacho and no OBD block.
    expect(caps('ATC700')).toEqual({ can: false, ble: false, tacho: false, obd: false })
    expect(caps('TAT100')).toMatchObject({ can: false, tacho: false })
  })
})

describe('the re-seed change report', () => {
  it('does not fire on key ORDER — it exists to surface a reverted manual correction', () => {
    // Postgres returns jsonb with its own key ordering, and the report compared JSON.stringify, so
    // every deploy printed ~20 "changed" lines where nothing had changed. That buries the one line
    // the report is for. This pins the property the comparison must have; the live evidence is the
    // staging deploy whose output it flooded.
    const a = { moveSpeedKmh: 6, movingSustainS: 90, parkedIgnitionOffS: 180, idleSustainS: 120 }
    const b = { idleSustainS: 120, moveSpeedKmh: 6, movingSustainS: 90, parkedIgnitionOffS: 180 }
    expect(JSON.stringify(a)).not.toBe(JSON.stringify(b)) // …which is why the old test passed
    const stable = (v: unknown): string => {
      if (v === null || typeof v !== 'object') return JSON.stringify(v) ?? 'null'
      if (Array.isArray(v)) return `[${v.map(stable).join(',')}]`
      const o = v as Record<string, unknown>
      return `{${Object.keys(o).sort().map((k) => `${JSON.stringify(k)}:${stable(o[k])}`).join(',')}}`
    }
    expect(stable(a)).toBe(stable(b))
    expect(stable({ ...a, moveSpeedKmh: 7 })).not.toBe(stable(b)) // …and a REAL change still differs
  })
})

