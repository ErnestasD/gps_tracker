import { describe, expect, it } from 'vitest'

import {
  canElementsForModel,
  estimateDataBytesPerHour,
  estimateDataUsage,
  isCanElementOfModel,
  isCanPriority,
  isSettingInRange,
  recordsPerHour,
  settingsForModel,
} from '../src/deviceSettings.js'

/**
 * The bounds under a customer's slider, and the number printed beside it.
 *
 * Everything pinned here was bought with hardware time on 2026-08-18: a send period of 0 stopped a
 * live tracker for an hour while it happily kept recording, the parameter ids turned out not to be
 * universal across the catalogue, and the four record triggers turned out to run concurrently.
 */
describe('settingsForModel', () => {
  it('offers the tracking settings for a model whose parameter list we have', () => {
    const keys = settingsForModel('FTC887').map((s) => s.key)
    expect(keys).toContain('movingSendPeriod')
    expect(keys).toContain('movingByDistance')
    expect(keys).toContain('parkedByTime')
  })

  it('never offers 0 for a period — the wiki allows it and a send period of 0 silences the device', () => {
    for (const model of ['FTC887', 'FMB120', 'FMC150']) {
      for (const s of settingsForModel(model).filter((x) => x.unit === 'seconds')) {
        expect(s.min, `${model} ${s.key}`).toBeGreaterThanOrEqual(2)
        expect(isSettingInRange(model, s.key, 0), `${model} ${s.key} must refuse 0`).toBe(false)
      }
    }
  })

  it('every offered setting is the HOME profile — the roaming ones ship silent and are not ours to write', () => {
    // 80 of the 89 models we have pages for default their roaming send period to 0. A slider that
    // silently wrote only the home profile would promise "every 2 s" to a truck that is abroad and
    // transmitting nothing at all.
    for (const s of settingsForModel('FTC887')) expect(s.profile).toBe('home')
  })

  it('carries the factory value the hardware itself reported', () => {
    // getparam over GPRS on a real FTC887: 10050 → 300, 10055 → 120, 10000 → 3600, 10051 → 100.
    const by = Object.fromEntries(settingsForModel('FTC887').map((s) => [s.key, s.factory]))
    expect(by['movingByTime']).toBe(300)
    expect(by['movingSendPeriod']).toBe(120)
    expect(by['parkedByTime']).toBe(3600)
    expect(by['movingByDistance']).toBe(100)
  })

  it('clamps a factory value that sits outside what we offer, and flags that it did', () => {
    // FMB640/FMC650/FMM650 state a factory movingByTime of 3600 s against our 300 s ceiling. Seeded
    // raw into a form it would render off-scale and "reset to factory" would write a value the API
    // rejects — or, worse, pin to 300 and cut a live truck from hourly to 5-minute records.
    for (const model of ['FMB640', 'FMC650', 'FMM650']) {
      const s = settingsForModel(model).find((x) => x.key === 'movingByTime')!
      expect(s.factory, model).toBeLessThanOrEqual(s.max)
      expect(s.factory, model).toBeGreaterThanOrEqual(s.min)
      expect(s.factoryOutOfRange, model).toBe(true)
      expect(isSettingInRange(model, 'movingByTime', s.factory), model).toBe(true)
    }
    // …and a model whose factory IS in range is not flagged
    expect(settingsForModel('FTC887').find((s) => s.key === 'movingByTime')!.factoryOutOfRange).toBe(false)
  })

  it('omits a setting the model does not implement, rather than offering a parameter it would reject', () => {
    // ATC700/ATM700 have no distance or angle trigger in their parameter list.
    const atc = settingsForModel('ATC700').map((s) => s.key)
    expect(atc).toContain('movingSendPeriod')
    expect(atc).not.toContain('movingByDistance')
    expect(atc).not.toContain('movingByAngle')
    expect(isSettingInRange('ATC700', 'movingByDistance', 100)).toBe(false)
  })

  it('an unknown or absent model gets NO settings — an empty list, never invented bounds', () => {
    for (const model of [undefined, null, '', '   ', 'NOT_A_MODEL', 'TAT100']) {
      expect(settingsForModel(model), String(model)).toEqual([])
    }
    expect(isSettingInRange('NOT_A_MODEL', 'movingSendPeriod', 30)).toBe(false)
  })

  it('a model name that collides with Object.prototype returns [] instead of throwing a 500', () => {
    // The catalogue is a JSON object literal, so a bare property lookup reaches the prototype. These
    // strings can arrive from a device record, and a settings page is not the place to crash.
    for (const hostile of ['constructor', 'toString', '__proto__', 'valueOf', 'hasOwnProperty']) {
      expect(() => settingsForModel(hostile), hostile).not.toThrow()
      expect(settingsForModel(hostile), hostile).toEqual([])
      expect(() => isSettingInRange(hostile, 'movingSendPeriod', 30), hostile).not.toThrow()
    }
    expect(settingsForModel(42 as unknown as string)).toEqual([])
  })

  it('tolerates surrounding whitespace and case in the model name', () => {
    expect(settingsForModel(' FTC887 ').length).toBeGreaterThan(0)
    expect(settingsForModel('ftc887').length).toBeGreaterThan(0)
  })

  it('the offered range is our safe range INTERSECTED with the model’s own', () => {
    const send = settingsForModel('FTC887').find((s) => s.key === 'movingSendPeriod')!
    // the model allows 0..2592000; we allow 2..120; the intersection is what a customer sees
    expect(send.min).toBe(2)
    expect(send.max).toBe(120)
    expect(isSettingInRange('FTC887', 'movingSendPeriod', 2)).toBe(true)
    expect(isSettingInRange('FTC887', 'movingSendPeriod', 120)).toBe(true)
    expect(isSettingInRange('FTC887', 'movingSendPeriod', 121)).toBe(false)
    expect(isSettingInRange('FTC887', 'movingSendPeriod', 1)).toBe(false)
  })

  it('refuses a non-integer — setparam takes whole numbers', () => {
    expect(isSettingInRange('FTC887', 'movingSendPeriod', 2.5)).toBe(false)
    expect(isSettingInRange('FTC887', 'movingSendPeriod', Number.NaN)).toBe(false)
    expect(isSettingInRange('FTC887', 'movingSendPeriod', Infinity)).toBe(false)
  })

  it('does not offer the speed-change trigger at all — its unit is not stateable from the wiki', () => {
    // FMB640/FMC650/FMM650 label 10053 "Seconds"; the FT pages treat it as a speed delta.
    for (const model of ['FTC887', 'FMB120', 'FMB640']) {
      expect(settingsForModel(model).map((s) => s.param), model).not.toContain('10053')
    }
  })
})

describe('recordsPerHour', () => {
  it('is set by the FASTEST trigger — they run concurrently, they do not take turns', () => {
    // 300 s time period alone is 12/h, but 20 m at 50 km/h is a record every 1.44 s.
    expect(recordsPerHour({ byTimeSeconds: 300 })).toBe(12)
    expect(recordsPerHour({ byTimeSeconds: 300, byDistanceMetres: 20, avgSpeedKmh: 50 })).toBeGreaterThan(2000)
  })

  it('is capped at 1 Hz — the GNSS receiver samples once a second whatever the sliders say', () => {
    expect(recordsPerHour({ byTimeSeconds: 2, byDistanceMetres: 20, avgSpeedKmh: 200 })).toBe(3600)
    expect(recordsPerHour({ byTimeSeconds: 0.1 })).toBe(3600)
  })

  it('a stationary vehicle generates nothing from the distance trigger', () => {
    expect(recordsPerHour({ byDistanceMetres: 100, avgSpeedKmh: 0 })).toBe(0)
    expect(recordsPerHour({})).toBe(0)
  })
})

describe('estimateDataUsage', () => {
  it('counts the distance trigger, which is the whole point — the old estimate was 100× low', () => {
    const timeOnly = estimateDataUsage({ byTimeSeconds: 300, sendEverySeconds: 120 })
    const withDistance = estimateDataUsage({ byTimeSeconds: 300, byDistanceMetres: 20, avgSpeedKmh: 50, sendEverySeconds: 120 })
    expect(withDistance.perMonthMB).toBeGreaterThan(timeOnly.perMonthMB * 50)
  })

  it('quotes a plausible figure for the dense configuration a customer reaches for', () => {
    // 2 s records, 2 s sends, 8 h/day: one record per frame, so the overhead is paid every time.
    const { perDrivingDayMB, perMonthMB } = estimateDataUsage({ byTimeSeconds: 2, sendEverySeconds: 2 })
    expect(perDrivingDayMB).toBeGreaterThan(2)
    expect(perDrivingDayMB).toBeLessThan(5)
    expect(perMonthMB).toBeGreaterThan(perDrivingDayMB * 21)
  })

  it('a longer send period is cheaper — the frame, packet and ACK overhead amortises', () => {
    const dense = estimateDataBytesPerHour({ byTimeSeconds: 2, sendEverySeconds: 2 })
    const batched = estimateDataBytesPerHour({ byTimeSeconds: 2, sendEverySeconds: 30 })
    expect(batched).toBeLessThan(dense)
    // …and recording less often is the bigger lever than batching
    expect(estimateDataBytesPerHour({ byTimeSeconds: 30, sendEverySeconds: 30 })).toBeLessThan(batched / 5)
  })

  it('refuses to quote Infinity, NaN or a negative bill', () => {
    expect(estimateDataBytesPerHour({ byTimeSeconds: 0, sendEverySeconds: 30 })).toBe(0)
    expect(estimateDataBytesPerHour({ byTimeSeconds: 30, sendEverySeconds: 0 })).toBe(0)
    expect(estimateDataBytesPerHour({ byTimeSeconds: 30, sendEverySeconds: Infinity })).toBe(0)
    expect(estimateDataBytesPerHour({ byTimeSeconds: Number.NaN, sendEverySeconds: 30 })).toBe(0)
    expect(estimateDataUsage({ byTimeSeconds: 2, sendEverySeconds: 2 }, -8).perMonthMB).toBe(0)
    expect(estimateDataUsage({ byTimeSeconds: 2, sendEverySeconds: 2 }, Infinity).perMonthMB).toBe(0)
  })
})

/**
 * The vehicle-bus elements, and the one parameter that decides whether the device sends them.
 *
 * Every CAN element ships with its priority at 0 — "do not send" — which is why a customer with a
 * working CAN bus still sees only the handful of GPS/IO elements a bus-less vehicle produces.
 * https://wiki.teltonika-gps.com/view/FMC150_Parameter_list (LVCAN section)
 */
describe('canElementsForModel', () => {
  it('lists a CAN model\u2019s elements, in the order its own parameter page lists them', () => {
    const els = canElementsForModel('FMC150')
    expect(els.length).toBeGreaterThan(50)
    expect(els[0]).toEqual({ param: '45100', name: 'Vehicle Speed' })
    const ids = els.map((e) => Number(e.param))
    expect(ids).toEqual([...ids].sort((a, b) => a - b))
    // only the FIRST id of each six-id block — the priority. The operand/high/low/event-only/
    // avg-const ids that follow it configure event generation and are a different feature.
    expect(ids).not.toContain(45101)
  })

  it('is empty for a model whose page has no CAN block \u2014 and that is not "all switched off"', () => {
    expect(canElementsForModel('ATC700')).toEqual([])
    expect(canElementsForModel('FMB640')).toEqual([])
  })

  it('answers empty rather than throwing for a missing, blank or prototype-shaped model', () => {
    for (const model of [null, undefined, '', '  ', 'constructor', 'toString', 'NOSUCHMODEL']) {
      expect(canElementsForModel(model), String(model)).toEqual([])
      expect(isCanElementOfModel(model, '45100'), String(model)).toBe(false)
    }
  })

  it('membership is per MODEL \u2014 an id the model does not implement is never sent to it', () => {
    expect(isCanElementOfModel('FMC150', '45100')).toBe(true)
    expect(isCanElementOfModel('fmc150', '45100')).toBe(true) // the profile key is lower-cased
    expect(isCanElementOfModel('FMC150', '45101')).toBe(false) // an operand id in the same block
    expect(isCanElementOfModel('FMC150', '10055')).toBe(false) // a tracking setting, not CAN
    expect(isCanElementOfModel('ATC700', '45100')).toBe(false)
  })

  it('accepts only the four priorities the parameter takes', () => {
    for (const v of [0, 1, 2, 3]) expect(isCanPriority(v), String(v)).toBe(true)
    for (const v of [-1, 4, 1.5, Number.NaN, Infinity]) expect(isCanPriority(v), String(v)).toBe(false)
  })
})
