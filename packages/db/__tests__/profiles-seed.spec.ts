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

  it('the HW column filters PER CAPABILITY GROUP, and only where it discriminates', () => {
    // The HW column excludes every row of a capability group for 60 (model, capability) pairs
    // across 31 models — for those it is not describing the model at all. FMM880's page carries 44 BLE
    // and 39 OBD rows and not one names FMM880 (they say `FMBXXX`, which does not match an FMM
    // code). Worst was the pair an operator compares side by side — FMB641's page carries 196 CAN
    // and 73 tachograph rows whose HW column reads "FMB640 FMC640 FMM640", so FMB641 advertised
    // can:false / tacho:false beside FMB640's true: a false differentiator on the exact feature
    // FMB641 exists for.
    expect(caps('FMM880')).toMatchObject({ ble: true, obd: true })
    expect(caps('FMC880')).toMatchObject({ ble: true, obd: true })
    expect(caps('FMB641')).toMatchObject({ can: true, tacho: true })
    expect(caps('FMB641').can).toBe(caps('FMB640').can)
    expect(caps('FMB641').tacho).toBe(caps('FMB640').tacho)
    expect(caps('FMM650')).toMatchObject({ can: true, tacho: true })

    // …and NO DISCONTINUITY. The first attempt scoped the exemption to single-model tables, which
    // made the answer depend on a hash collision: FMM880 (its own table) got ble:true while FMM920
    // (in the 45-model fmb120 group) got ble:false off the SAME hwSupport string, and FMC13A —
    // named on 0 of 640 rows — got every capability while FMC230, named on exactly 1, got none.
    // Being mentioned less bought more. Same evidence must give the same answer.
    expect(caps('FMM920').ble).toBe(caps('FMM880').ble)
    expect(caps('FMC920').ble).toBe(caps('FMC880').ble)
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
