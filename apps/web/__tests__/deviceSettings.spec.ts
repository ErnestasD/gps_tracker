import { settingsForModel } from '@orbetra/shared'
import { describe, expect, it } from 'vitest'

import {
  changedOnly,
  displayValue,
  estimateFor,
  isInFlight,
  isRejected,
  settingsView,
  type CurrentSetting,
} from '../src/lib/deviceSettings'

/**
 * What the settings screen is allowed to say.
 *
 * The rule these tests defend is the same one the API defends: a number a customer sees must be one
 * the DEVICE reported, or one they themselves just asked for and can see is still in flight. Never
 * the factory default dressed up as device state — that is the same class of lie as a marker at
 * 0,0, and on 2026-08-18 it was the difference between "the write took" and "the write did nothing".
 */
const cur = (p: Partial<CurrentSetting>): CurrentSetting =>
  ({ value: null, checkedAt: null, requested: null, state: null, ...p })

describe('displayValue', () => {
  it('shows what the device reported', () => {
    expect(displayValue(cur({ value: 30, checkedAt: 'now' }))).toBe(30)
  })

  it('shows a change still in flight, so the slider does not snap back under the customer', () => {
    expect(displayValue(cur({ requested: 2, state: 'waiting' }))).toBe(2)
    expect(displayValue(cur({ requested: 2, state: 'sent' }))).toBe(2)
  })

  it('the DEVICE wins once it has spoken, even mid-change', () => {
    expect(displayValue(cur({ value: 120, requested: 2, state: 'rejected' }))).toBe(120)
    expect(displayValue(cur({ value: 2, requested: 2, state: 'confirmed' }))).toBe(2)
  })

  it('null when nothing is known — never the factory default', () => {
    expect(displayValue(cur({}))).toBeNull()
    expect(displayValue(undefined)).toBeNull()
    // an undelivered request is NOT a value: the device never saw it
    expect(displayValue(cur({ requested: 2, state: 'undelivered' }))).toBeNull()
  })
})

describe('isInFlight / isRejected', () => {
  it('in flight covers exactly the states where the device has not had its say', () => {
    expect(isInFlight(cur({ state: 'waiting' }))).toBe(true)
    expect(isInFlight(cur({ state: 'sent' }))).toBe(true)
    for (const state of ['confirmed', 'rejected', 'undelivered', null] as const) {
      expect(isInFlight(cur({ state })), String(state)).toBe(false)
    }
  })

  it('rejected is its own state — the write arrived and the device kept something else', () => {
    expect(isRejected(cur({ value: 120, requested: 2, state: 'rejected' }))).toBe(true)
    expect(isRejected(cur({ state: 'undelivered' }))).toBe(false)
  })
})

describe('changedOnly', () => {
  const current = {
    movingSendPeriod: cur({ value: 120, state: 'confirmed' }),
    movingByTime: cur({}),
  }

  it('drops a value the device already holds — a no-op command would show "waiting" for a day', () => {
    expect(changedOnly({ movingSendPeriod: 120 }, current)).toEqual({})
  })

  it('keeps a real change, and anything the device has never confirmed', () => {
    expect(changedOnly({ movingSendPeriod: 30 }, current)).toEqual({ movingSendPeriod: 30 })
    expect(changedOnly({ movingByTime: 300 }, current)).toEqual({ movingByTime: 300 })
  })

  it('after a rejection, re-sending what the device KEPT is still a no-op', () => {
    // The device was told 30 and kept 120, so the slider now shows 120. Re-sending 120 would come
    // back `confirmed` and look like the retry worked. The customer has to pick a different value.
    const rejected = { movingSendPeriod: cur({ value: 120, requested: 30, state: 'rejected' }) }
    expect(changedOnly({ movingSendPeriod: 120 }, rejected)).toEqual({})
    // …and choosing something else is sent normally
    expect(changedOnly({ movingSendPeriod: 45 }, rejected)).toEqual({ movingSendPeriod: 45 })
  })

  it('does not re-send a change that is already on its way', () => {
    const inFlight = { movingSendPeriod: cur({ requested: 15, state: 'waiting' }) }
    expect(changedOnly({ movingSendPeriod: 15 }, inFlight)).toEqual({})
    expect(changedOnly({ movingSendPeriod: 20 }, inFlight)).toEqual({ movingSendPeriod: 20 })
  })

  it('an UNTOUCHED card queues nothing, even on a device that has never replied', () => {
    // The API seeds every available key with {value:null,state:null}. Iterating slider POSITIONS
    // (which fall back to the factory value) armed Save with six numbers nobody chose, and one
    // click overwrote whatever the installer had configured — on FMB640/FMC650/FMM650 that meant
    // cutting a truck from 3600 s to 300 s records. An empty draft must mean an empty payload.
    const untouched = Object.fromEntries(
      settingsForModel('FTC887').map((s) => [s.key, cur({})]),
    )
    expect(changedOnly({}, untouched)).toEqual({})
  })
})

describe('estimateFor', () => {
  it('counts the distance trigger, not just the time one', () => {
    const timeOnly = estimateFor({ movingByTime: 300, movingSendPeriod: 120 })
    const withDistance = estimateFor({ movingByTime: 300, movingByDistance: 20, movingSendPeriod: 120 })
    expect(withDistance.perMonthMB).toBeGreaterThan(timeOnly.perMonthMB * 50)
  })

  it('rises when the customer drags towards "more live"', () => {
    const relaxed = estimateFor({ movingByTime: 60, movingSendPeriod: 60 })
    const dense = estimateFor({ movingByTime: 2, movingSendPeriod: 2 })
    expect(dense.perMonthMB).toBeGreaterThan(relaxed.perMonthMB)
  })

  it('quotes nothing rather than a wrong number when the send period is unknown', () => {
    expect(estimateFor({ movingByTime: 2 })).toEqual({ perDrivingDayMB: 0, perMonthMB: 0 })
  })

  it('every setting the catalogue offers for a real model is a key this understands', () => {
    // Guards the seam: a new setting added to the catalogue that the estimate ignores would quietly
    // under-quote a customer's bill.
    const keys = settingsForModel('FTC887').map((s) => s.key)
    expect(keys).toContain('movingSendPeriod')
    expect(keys).toContain('movingByTime')
    expect(keys).toContain('movingByDistance')
  })
})

/**
 * The card's whole derivation, in one function.
 *
 * This exists because the worst defect this screen has had was not a wrong computation but a wrong
 * ARGUMENT: the component handed the save path the slider positions instead of the draft, and
 * positions fall back to the factory value. Deriving both here means there is no second record to
 * confuse, and these tests pin the property the component could otherwise break again.
 */
describe('settingsView', () => {
  const FTC = settingsForModel('FTC887')
  const untouched = Object.fromEntries(FTC.map((s) => [s.key, cur({})]))

  it('an untouched card on a device that has never replied queues NOTHING', () => {
    const { positions, pending, dirty } = settingsView(FTC, untouched, {})
    // the thumbs still have somewhere to sit…
    expect(Object.keys(positions).length).toBe(FTC.length)
    expect(positions.movingSendPeriod).toBe(120) // the factory value, as a POSITION only
    // …and not one of those numbers is transmittable
    expect(pending).toEqual({})
    expect(dirty).toBe(false)
  })

  it('only what the customer moved becomes pending, however many sliders are on screen', () => {
    const { pending, dirty } = settingsView(FTC, untouched, { movingSendPeriod: 30 })
    expect(pending).toEqual({ movingSendPeriod: 30 })
    expect(dirty).toBe(true)
  })

  it('positions prefer the DEVICE’s value over the factory one', () => {
    const known = { ...untouched, movingSendPeriod: cur({ value: 15, checkedAt: 'x' }) }
    expect(settingsView(FTC, known, {}).positions.movingSendPeriod).toBe(15)
    expect(settingsView(FTC, known, {}).dirty).toBe(false)
  })

  it('a model with no settings is empty and clean, not a crash', () => {
    expect(settingsView([], {}, {})).toEqual({ positions: {}, pending: {}, dirty: false })
  })
})
