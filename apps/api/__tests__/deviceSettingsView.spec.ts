import { settingsForModel } from '@orbetra/shared'
import { describe, expect, it } from 'vitest'

import { currentSettings } from '../src/routes/deviceSettingsView.js'

/**
 * What the settings page reports as the device's state.
 *
 * The rule under every assertion here: a value we cannot source from the device's own reply is
 * `null` — "we do not know" — never the factory default and never the number we last commanded.
 * On 2026-08-18 a setparam was accepted, queued, delivered and had no effect whatsoever; showing
 * the commanded value would have reported success for a device that never changed.
 */
const FTC887 = settingsForModel('FTC887')

const reply = (text: string, response: string | null, at = '2026-08-18T12:00:00.000Z') =>
  ({ text, response, status: response === null ? 'queued' : 'acked', createdAt: at, sentAt: at })
/** A write in any dispatcher state — `sent` is the one the previous shape could not represent. */
const write = (text: string, status: string, at: string) =>
  ({ text, response: null, status, createdAt: at, sentAt: status === 'queued' ? null : at })

describe('currentSettings', () => {
  it('reports what the device answered, with the time it answered', () => {
    const { current } = currentSettings(FTC887, [
      reply('getparam 10055', 'Param ID:10055 Value:30', '2026-08-18T14:00:00.000Z'),
    ])
    expect(current['movingSendPeriod']).toEqual({
      value: 30,
      checkedAt: '2026-08-18T14:00:00.000Z',
      requested: null,
      state: null,
    })
  })

  it('null for a setting the device has never been asked about — not the factory default', () => {
    const { current } = currentSettings(FTC887, [])
    for (const s of FTC887) {
      expect(current[s.key], s.key).toEqual({ value: null, checkedAt: null, requested: null, state: null })
      // …even though the catalogue knows a factory value for it
      expect(s.factory).toBeGreaterThan(0)
    }
  })

  it('the NEWEST reply wins — history is newest-first', () => {
    const { current } = currentSettings(FTC887, [
      reply('getparam 10055', 'Param ID:10055 Value:2', '2026-08-18T15:00:00.000Z'),
      reply('getparam 10055', 'Param ID:10055 Value:120', '2026-08-18T09:00:00.000Z'),
    ])
    expect(current['movingSendPeriod']!.value).toBe(2)
  })

  it('reads the multi-id reply, so one verification covers every changed setting', () => {
    // The real shape: only the first pair says "Value:".
    const { current } = currentSettings(FTC887, [
      reply('getparam 10050;10051;10055', 'Param ID:10050 Value:2;10051:20;10055:2'),
    ])
    expect(current['movingByTime']!.value).toBe(2)
    expect(current['movingByDistance']!.value).toBe(20)
    expect(current['movingSendPeriod']!.value).toBe(2)
  })

  it('a change is visible at EVERY stage of its life, not only while it sits in the queue', () => {
    // The dispatcher flips `queued` to `sent` the instant ingest writes the frame. Reporting only
    // the queued state made a change vanish from the API at the moment of transmission — and stay
    // vanished forever if the verification never came back, so a client seeding its form from
    // `value` would re-send the OLD number and quietly revert a change the device had applied.
    const cases: [string, string][] = [
      ['queued', 'waiting'],
      ['sent', 'sent'],
      ['failed', 'undelivered'],
      ['expired', 'undelivered'],
    ]
    for (const [status, expected] of cases) {
      const { current } = currentSettings(FTC887, [
        write('setparam 10055:2', status, '2026-08-18T16:00:00.000Z'),
        reply('getparam 10055', 'Param ID:10055 Value:120', '2026-08-18T09:00:00.000Z'),
      ])
      expect(current['movingSendPeriod']!.requested, status).toBe(2)
      expect(current['movingSendPeriod']!.state, status).toBe(expected)
      // …and the device's own last word is still what we report as its state
      expect(current['movingSendPeriod']!.value, status).toBe(120)
    }
  })

  it('names the failure this whole feature exists for: delivered, acked, and REJECTED', () => {
    // The write went out, the device said OK, and the verification came back holding something
    // else. Before this state existed the API reported that as though nothing had been asked.
    const { current } = currentSettings(FTC887, [
      reply('getparam 10055', 'Param ID:10055 Value:120', '2026-08-18T16:05:00.000Z'),
      { text: 'setparam 10055:2', response: 'OK', status: 'acked', createdAt: '2026-08-18T16:00:00.000Z', sentAt: '2026-08-18T16:00:00.000Z' },
    ])
    expect(current['movingSendPeriod']!.value).toBe(120)
    expect(current['movingSendPeriod']!.requested).toBe(2)
    expect(current['movingSendPeriod']!.state).toBe('rejected')
  })

  it('…and confirms one that did take', () => {
    const { current } = currentSettings(FTC887, [
      reply('getparam 10055', 'Param ID:10055 Value:2', '2026-08-18T16:05:00.000Z'),
      { text: 'setparam 10055:2', response: 'OK', status: 'acked', createdAt: '2026-08-18T16:00:00.000Z', sentAt: '2026-08-18T16:00:00.000Z' },
    ])
    expect(current['movingSendPeriod']!.state).toBe('confirmed')
  })

  it('ignores parameters this model does not offer', () => {
    const { current } = currentSettings(FTC887, [
      reply('getparam 11813', 'Param ID:11813 Value:0'),
      reply('getparam 2004', 'Param ID:2004 Value:185.80.129.33'),
    ])
    expect(Object.keys(current).sort()).toEqual(FTC887.map((s) => s.key).sort())
    for (const v of Object.values(current)) expect(v.value).toBeNull()
  })

  it('a reply the device could not answer leaves us not knowing — even with a good OLDER one behind it', () => {
    // The stale-wins trap: if an unreadable NEWER reply does not settle the parameter, the page
    // freezes on pre-upgrade values after a firmware change instead of admitting it cannot read
    // them. Each case here has a perfectly good older reading behind it.
    for (const response of ["Param ID:10055 doesn't exist", 'Param ID:10055 Value:', 'OK', '']) {
      const { current } = currentSettings(FTC887, [
        reply('getparam 10055', response, '2026-08-18T15:00:00.000Z'),
        reply('getparam 10055', 'Param ID:10055 Value:30', '2026-08-18T09:00:00.000Z'),
      ])
      expect(current['movingSendPeriod']!.value, JSON.stringify(response)).toBeNull()
      // we DID ask, and we know when — that is a different fact from never having asked
      expect(current['movingSendPeriod']!.checkedAt, JSON.stringify(response)).toBe('2026-08-18T15:00:00.000Z')
    }
  })

  it('does not trust the caller’s ordering — it sorts by time itself', () => {
    // `listForDevice` happens to order newest-first today. Every "newest wins" property here
    // inverts silently if that ORDER BY is ever changed, and the route would report a superseded
    // value as current with no test failing.
    const oldestFirst = [
      reply('getparam 10055', 'Param ID:10055 Value:120', '2026-08-18T09:00:00.000Z'),
      reply('getparam 10055', 'Param ID:10055 Value:2', '2026-08-18T15:00:00.000Z'),
    ]
    expect(currentSettings(FTC887, oldestFirst).current['movingSendPeriod']!.value).toBe(2)
  })

  it('a value cannot smuggle another parameter’s reading in through the reply', () => {
    // `getparam 2001` answering `Value:banga;10055:2` must not state a 2-second send period.
    const { current } = currentSettings(FTC887, [reply('getparam 2001', 'Param ID:2001 Value:banga;10055:2')])
    expect(current['movingSendPeriod']!.value).toBeNull()
  })

  it('a setparam value cannot be misread as an id/value pair', () => {
    // `setparam 2004:host10055:9` scanned loosely would report a pending 9 for movingSendPeriod.
    const { current } = currentSettings(FTC887, [write('setparam 2004:host10055:9', 'queued', '2026-08-18T16:00:00.000Z')])
    expect(current['movingSendPeriod']!.requested).toBeNull()
  })

  it('a model with no settings yields an empty map rather than throwing', () => {
    expect(currentSettings([], [reply('getparam 10055', 'Param ID:10055 Value:30')]).current).toEqual({})
  })

  it('a reading taken BEFORE the write cannot judge it — that is "sent", never "rejected"', () => {
    /**
     * The sequence the re-read button invites: read the device, then change something. Comparing a
     * pre-change reading against the new value reported `rejected` — "the device answered and kept
     * something else" — while the device had said nothing since. On a parked vehicle the real
     * verification is hours away, so this was the common case, not an edge.
     */
    const { current } = currentSettings(FTC887, [
      { text: 'setparam 10055:2', response: 'OK', status: 'acked', createdAt: '2026-08-18T16:00:00.000Z', sentAt: '2026-08-18T16:00:00.000Z' },
      reply('getparam 10055', 'Param ID:10055 Value:120', '2026-08-18T15:00:00.000Z'),
    ])
    expect(current['movingSendPeriod']!.state).toBe('sent')
    expect(current['movingSendPeriod']!.requested).toBe(2)
    // the device's last word is still reported as its state, with the time it was taken
    expect(current['movingSendPeriod']!.value).toBe(120)
    expect(current['movingSendPeriod']!.checkedAt).toBe('2026-08-18T15:00:00.000Z')
  })

  it('…and a reading taken AFTER it still judges it', () => {
    const { current } = currentSettings(FTC887, [
      reply('getparam 10055', 'Param ID:10055 Value:120', '2026-08-18T16:05:00.000Z'),
      { text: 'setparam 10055:2', response: 'OK', status: 'acked', createdAt: '2026-08-18T16:00:00.000Z', sentAt: '2026-08-18T16:00:00.000Z' },
    ])
    expect(current['movingSendPeriod']!.state).toBe('rejected')
  })
})
