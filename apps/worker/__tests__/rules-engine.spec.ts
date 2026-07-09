import type { NormalizedRecord } from '@orbetra/shared'
import { describe, expect, it } from 'vitest'

import { RuleEngine, type DeviceIo } from '../src/rules/engine.js'
import type { RuleDef } from '../src/rules/types.js'

const T0 = 1_751_600_000_000
interface RecOpts {
  fixValid?: boolean
  speed?: number | null
  ignition?: boolean | null
  attrs?: Record<string, unknown>
}
const rec = (tSec: number, o: RecOpts = {}): NormalizedRecord => ({
  deviceId: 42n,
  fixTime: new Date(T0 + tSec * 1000),
  serverTime: new Date(T0 + tSec * 1000),
  lat: 54.6,
  lon: 25.2,
  altitude: null,
  speed: o.speed === undefined ? 0 : o.speed,
  course: null,
  satellites: (o.fixValid ?? true) ? 9 : 0,
  fixValid: o.fixValid ?? true,
  ignition: o.ignition === undefined ? null : o.ignition,
  movement: null,
  odometerM: null,
  priority: 0,
  recHash: BigInt(tSec),
  attrs: o.attrs ?? {},
})

const rule = (kind: RuleDef['kind'], config: Record<string, unknown> = {}, cooldownS = 300): RuleDef => ({
  id: `r-${kind}`,
  accountId: 'acc-1',
  kind,
  name: `${kind} rule`,
  config,
  cooldownS,
})
const only = (r: RuleDef) => () => [r]

describe('E05-4 RuleEngine — overspeed (level, fixValid-only)', () => {
  it('fires when speed exceeds the configured limit', () => {
    const e = new RuleEngine()
    const ev = e.feed([rec(0, { speed: 95 })], only(rule('overspeed', { speedKmh: 90 })))
    expect(ev).toHaveLength(1)
    expect(ev[0]).toMatchObject({ kind: 'overspeed', deviceId: 42n, bypassCooldown: false })
    expect(ev[0]!.payload).toMatchObject({ speedKmh: 95, limitKmh: 90 })
  })

  it('does NOT fire on an invalid-fix record even if speed is high (rule 6 / §3.4)', () => {
    const e = new RuleEngine()
    // invalid fix carries last-valid coords + a stale/zero speed; must never affect overspeed
    const ev = e.feed([rec(0, { speed: 120, fixValid: false })], only(rule('overspeed', { speedKmh: 90 })))
    expect(ev).toHaveLength(0)
  })

  it('defaults the limit to 90 km/h and fires at most once per batch', () => {
    const e = new RuleEngine()
    const ev = e.feed([rec(0, { speed: 100 }), rec(1, { speed: 110 }), rec(2, { speed: 105 })], only(rule('overspeed')))
    expect(ev).toHaveLength(1) // level de-dup within a batch; cooldown spaces across batches
  })

  it('stays silent at or below the limit', () => {
    const e = new RuleEngine()
    expect(e.feed([rec(0, { speed: 90 })], only(rule('overspeed', { speedKmh: 90 })))).toHaveLength(0)
  })
})

describe('E05-4 RuleEngine — low_battery (level, works on invalid fix)', () => {
  it('fires below threshold, scaling raw mV by 0.001', () => {
    const e = new RuleEngine()
    // 10.5 V (10500 mV) < 11 V threshold
    const ev = e.feed([rec(0, { fixValid: false, attrs: { 'Battery Voltage': 10_500 } })], only(rule('low_battery', { thresholdV: 11 })))
    expect(ev).toHaveLength(1)
    expect(ev[0]!.payload).toMatchObject({ volts: 10.5, thresholdV: 11 })
  })

  it('resolves the id-67 value via io_67 when the name was taken by id 1045', () => {
    const e = new RuleEngine()
    const ev = e.feed([rec(0, { attrs: { 'Battery Voltage': 13_000, io_67: 10_000 } })], only(rule('low_battery', { thresholdV: 11 })))
    expect(ev).toHaveLength(1)
    expect(ev[0]!.payload).toMatchObject({ volts: 10 })
  })

  it('stays silent at or above threshold', () => {
    const e = new RuleEngine()
    expect(e.feed([rec(0, { attrs: { 'Battery Voltage': 12_600 } })], only(rule('low_battery', { thresholdV: 11 })))).toHaveLength(0)
  })
})

describe('E05-4 RuleEngine — ignition (edge)', () => {
  it('fires on a confirmed on→off transition, not on the first sight', () => {
    const e = new RuleEngine()
    const r = rule('ignition')
    expect(e.feed([rec(0, { ignition: true })], only(r))).toHaveLength(0) // first sight — no prior value
    const ev = e.feed([rec(10, { ignition: false })], only(r))
    expect(ev).toHaveLength(1)
    expect(ev[0]!.payload).toMatchObject({ ignition: false })
  })

  it('warm-starts the prior value so a restart does not re-fire', () => {
    const e = new RuleEngine()
    const ioState = (): DeviceIo => ({ ignition: true, din1: null, unplug: null, alarm: null })
    // device is still ignition-on after restart → no phantom edge
    expect(e.feed([rec(0, { ignition: true })], only(rule('ignition')), ioState)).toHaveLength(0)
  })
})

describe('E05-4 RuleEngine — din_change (edge)', () => {
  it('fires on a DIN1 change', () => {
    const e = new RuleEngine()
    const r = rule('din_change')
    expect(e.feed([rec(0, { attrs: { 'Digital Input 1': 0 } })], only(r))).toHaveLength(0)
    const ev = e.feed([rec(10, { attrs: { 'Digital Input 1': 1 } })], only(r))
    expect(ev).toHaveLength(1)
    expect(ev[0]!.payload).toMatchObject({ din1: true })
  })
})

describe('E05-4 RuleEngine — power_cut (rising edge, bypasses cooldown)', () => {
  it('fires only on Unplug 0→1 and marks bypassCooldown', () => {
    const e = new RuleEngine()
    const r = rule('power_cut')
    expect(e.feed([rec(0, { attrs: { Unplug: 0 } })], only(r))).toHaveLength(0)
    const ev = e.feed([rec(10, { attrs: { Unplug: 1 } })], only(r))
    expect(ev).toHaveLength(1)
    expect(ev[0]).toMatchObject({ kind: 'power_cut', bypassCooldown: true })
    // falling edge (plugged back in) does NOT fire
    expect(e.feed([rec(20, { attrs: { Unplug: 0 } })], only(r))).toHaveLength(0)
  })
})

describe('E05-4 RuleEngine — panic (Alarm rising edge, bypasses cooldown)', () => {
  it('fires on Alarm 0→1', () => {
    const e = new RuleEngine()
    const r = rule('panic')
    expect(e.feed([rec(0, { attrs: { Alarm: 0 } })], only(r))).toHaveLength(0)
    const ev = e.feed([rec(10, { fixValid: false, attrs: { Alarm: 1 } })], only(r)) // works on invalid fix
    expect(ev).toHaveLength(1)
    expect(ev[0]).toMatchObject({ kind: 'panic', bypassCooldown: true })
  })
})

describe('E05-4 RuleEngine — ordering & scope', () => {
  it('drops out-of-order records (I2)', () => {
    const e = new RuleEngine()
    const r = rule('overspeed', { speedKmh: 90 })
    e.feed([rec(100, { speed: 100 })], only(r)) // establishes lastSeen=100s
    // an older record must be ignored
    const ev = e.feed([rec(50, { speed: 100 })], only(r))
    expect(ev).toHaveLength(0)
  })

  it('emits nothing when the device has no rules', () => {
    const e = new RuleEngine()
    expect(e.feed([rec(0, { speed: 200 })], () => [])).toHaveLength(0)
  })

  it('snapshot exposes the current IO for durable persistence', () => {
    const e = new RuleEngine()
    e.feed([rec(0, { ignition: true, attrs: { Unplug: 1, Alarm: 0, 'Digital Input 1': 1 } })], only(rule('ignition')))
    expect(e.snapshot(42n)).toEqual({ ignition: true, din1: true, unplug: true, alarm: false })
  })
})
