import { describe, expect, it } from 'vitest'

import { loadDictionary, type AvlDictionaryEntry } from '@orbetra/codec'

import { attrLabelsFor } from '../src/routes/attrLabels.js'

/**
 * The middle of the chain: generator → WIRE → renderer.
 *
 * The dictionary knows what `raw × multiplier` is measured in and the browser knows how to render
 * it; this is the only place that decides what actually travels between them. It runs against the
 * REAL shipped tables rather than a fixture, because the thing being asserted is that a specific
 * row's correction survives — a hand-made entry would prove only that the spread operator works.
 */
describe('attrLabelsFor', () => {
  it('carries the CORRECTED unit for the rows where the Units cell names the raw value', () => {
    // fm6300 id 67: the wiki says mV, × 0.001; scaling on the cell's prefix rendered 12.6 V as 0.0 V
    const labels = attrLabelsFor(loadDictionary('fm6300'), ['io_67'])
    // matched, not equalled: `group` and `max` travel for their own reasons and Teltonika edits them
    // (recapitalising a Parameter Group cell once turned this test red for nothing to do with units)
    expect(labels['io_67']).toMatchObject({
      name: 'Battery Voltage',
      units: 'mV', // provenance survives untouched — this IS what the wiki says
      unitAfterMultiplier: 'V', // …and this is what the number means
      multiplier: 0.001,
    })
  })

  it('sends NOTHING extra where the Units cell is already right — absent is a load-bearing state', () => {
    // Teltonika's own corrected row for the same element on the same silicon
    const labels = attrLabelsFor(loadDictionary('fmc650'), ['io_67'])
    expect(labels['io_67']?.units).toBe('V')
    expect(labels['io_67']).not.toHaveProperty('unitAfterMultiplier')
  })

  it('confirms the ambiguous rows the display must NOT rescale twice', () => {
    // ×50 mV is how a 400 V traction pack reports: the cell describes the RESULT
    expect(attrLabelsFor(loadDictionary('fmc650'), ['io_10879'])['io_10879']).toMatchObject({
      units: 'mV',
      unitAfterMultiplier: 'mV',
      multiplier: 50,
    })
    // the UL202 panel displays 285.2mm, so 2852 × 0.1 is already the millimetre figure
    expect(attrLabelsFor(loadDictionary('fmb120'), ['io_327'])['io_327']).toMatchObject({
      name: 'UL202-02 Sensor Fuel level',
      units: 'mm',
      unitAfterMultiplier: 'mm',
      multiplier: 0.1,
    })
  })

  it('an explicit REFUSAL survives the wire — it is not "falsy, therefore drop it"', () => {
    // no shipped row refuses today; the state exists so an undecidable one can ship honestly, and a
    // truthiness test on the way out would silently turn it back into "the Units cell is fine"
    const dict = new Map<number, AvlDictionaryEntry>([
      [999, { name: 'Undecidable', bytes: '2', type: 'Unsigned', units: 'mV', multiplier: '0.01', unitAfterMultiplier: null }],
    ])
    const labels = attrLabelsFor(dict, ['io_999'])
    expect(labels['io_999']).toHaveProperty('unitAfterMultiplier')
    expect(labels['io_999']?.unitAfterMultiplier).toBeNull()
  })

  it('resolves a NAMED key too, and passes over what the table does not document', () => {
    const labels = attrLabelsFor(loadDictionary('fmb120'), ['Ignition', 'io_65535', 'not_an_element'])
    expect(labels['Ignition']?.name).toBe('Ignition')
    expect(labels).not.toHaveProperty('io_65535') // never invented: an undocumented id gets no label
    expect(labels).not.toHaveProperty('not_an_element')
  })

  it('a device with no profile gets no labels rather than another table\'s', () => {
    expect(attrLabelsFor(undefined, ['io_67'])).toEqual({})
  })
})
