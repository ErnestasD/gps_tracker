import { describe, expect, it } from 'vitest'
import xxhash from 'xxhash-wasm'

import { isClockSkewed, normalize } from '../src/normalize.js'

const hasher = await xxhash()
const hash = (d: Uint8Array): bigint => hasher.h64Raw(d)

const basePayload = {
  deviceId: 42n,
  imei: '356307042441013',
  serverTimeMs: Date.UTC(2026, 6, 4, 12, 0, 1),
  tsMs: Date.UTC(2026, 6, 4, 12, 0, 0),
  priority: 0,
  lat: 54.6872,
  lon: 25.2797,
  altitude: 120,
  angle: 90,
  satellites: 9,
  speed: 50,
  eventIoId: 0,
  io: [] as [number, bigint | number | Uint8Array][],
  raw: new Uint8Array([1, 2, 3]),
}

describe('normalize (E02-3)', () => {
  it('fix_valid = satellites > 0 (CLAUDE.md rule 6 / I5)', () => {
    expect(normalize({ ...basePayload, satellites: 9 }, hash).fixValid).toBe(true)
    expect(normalize({ ...basePayload, satellites: 0 }, hash).fixValid).toBe(false)
  })

  it('promotes ignition/movement/odometer (AVL 239/240/16) to columns', () => {
    const rec = normalize(
      { ...basePayload, io: [[239, 1n], [240, 0n], [16, 123456n]] },
      hash,
    )
    expect(rec.ignition).toBe(true)
    expect(rec.movement).toBe(false)
    expect(rec.odometerM).toBe(123456n)
  })

  it('missing IO ⇒ nulls (never guessed)', () => {
    const rec = normalize(basePayload, hash)
    expect(rec.ignition).toBeNull()
    expect(rec.movement).toBeNull()
    expect(rec.odometerM).toBeNull()
  })

  it('dictionary names known ids; unknown ids kept as io_<id> — never dropped (§3.7)', () => {
    const rec = normalize(
      { ...basePayload, io: [[21, 4n], [65535, 7n], [385, new Uint8Array([0xaa, 0xbb])]] },
      hash,
    )
    expect(rec.attrs['GSM Signal']).toBe(4)
    expect(rec.attrs['io_65535']).toBe(7)
    expect(rec.attrs['Beacon']).toBe('aabb') // variable payload as hex
  })

  it('SIGNED dictionary parameters reach attrs as negative numbers, at their own width', () => {
    // REGRESSION (audit MED). The wire carries raw bytes and the dictionary's Type column says how
    // to read them; nothing applied it, so a −5 °C coolant temperature surfaced as 251 and an
    // accelerometer axis swinging negative as ~65 000 — on the device page, in exports, and in any
    // rule threshold built on them. A "below −10 °C" cold-chain alert could never fire.
    const rec = normalize(
      { ...basePayload, io: [[32, 251n], [17, 65_531n], [21, 251n]] },
      hash,
    )
    expect(rec.attrs['Coolant Temperature']).toBe(-5) // 1-byte signed
    expect(rec.attrs['Axis X']).toBe(-5) // 2-byte signed — read at ITS width, not the 1-byte one
    expect(rec.attrs['GSM Signal']).toBe(251) // unsigned parameter untouched
  })

  it('rec_hash: unsigned xxhash64 > 2^63−1 reinterpreted as SIGNED bigint (§6.3 R10)', () => {
    // find a raw whose hash has the top bit set — proves the two's-complement path
    let raw: Uint8Array | null = null
    for (let i = 0; i < 1000; i++) {
      const candidate = new Uint8Array([i & 0xff, (i >> 8) & 0xff, 7])
      if (hasher.h64Raw(candidate) > 0x7fffffffffffffffn) {
        raw = candidate
        break
      }
    }
    expect(raw).not.toBeNull()
    const rec = normalize({ ...basePayload, raw: raw! }, hash)
    expect(rec.recHash).toBeLessThan(0n) // signed — fits PG bigint
    expect(BigInt.asUintN(64, rec.recHash)).toBe(hasher.h64Raw(raw!)) // lossless round-trip
  })

  it('course column carries the protocol angle (§6.3 naming note)', () => {
    expect(normalize({ ...basePayload, angle: 275 }, hash).course).toBe(275)
  })

  it('duplicate dictionary names do not overwrite each other (§3.7 never-dropped)', async () => {
    const { loadDictionary } = await import('@orbetra/codec')
    const dict = loadDictionary('fmb1xx')
    const byName = new Map<string, number[]>()
    for (const [id, e] of dict) {
      const ids = byName.get(e.name) ?? []
      ids.push(id)
      byName.set(e.name, ids)
    }
    const dup = [...byName.values()].find((ids) => ids.length >= 2)
    expect(dup, 'fmb1xx has at least one duplicated name').toBeDefined()
    const [id1, id2] = dup!
    const rec = normalize({ ...basePayload, io: [[id1!, 1n], [id2!, 2n]] }, hash)
    const values = Object.values(rec.attrs)
    expect(values).toContain(1)
    expect(values).toContain(2) // both survive — second under io_<id>
    expect(rec.attrs[`io_${id2}`]).toBe(2)
  })

  it('fuel ids (48/84/89) always keep their io_<id> key — never the ambiguous dictionary name (E08-3)', () => {
    // 84 (l ×0.1) and 89 (%) are BOTH named "Fuel level" in fmb1xx — a single-id record
    // would land under one indistinguishable key. Forced id-keys make read-side units safe.
    const rec = normalize({ ...basePayload, io: [[89, 76n], [84, 412n], [48, 51n]] }, hash)
    expect(rec.attrs['io_89']).toBe(76)
    expect(rec.attrs['io_84']).toBe(412) // raw — the ×0.1 wiki multiplier applies at read
    expect(rec.attrs['io_48']).toBe(51)
    expect(rec.attrs['Fuel level']).toBeUndefined()
    expect(rec.attrs['Fuel Level']).toBeUndefined()
  })

  it('a single fuel id still gets its io_<id> key (the no-collision case is the dangerous one)', () => {
    const rec = normalize({ ...basePayload, io: [[89, 30n]] }, hash)
    expect(rec.attrs['io_89']).toBe(30)
    expect(rec.attrs['Fuel level']).toBeUndefined()
  })

  it('uint16 speed/angle beyond smallint are NULLED, never written (audit critical #2)', () => {
    // The protocol fields are uint16 (max 65535); positions.speed/course are smallint (max 32767).
    // One such value used to make the whole multi-row INSERT raise 22003 — the batch was never ACKed,
    // XAUTOCLAIM re-delivered it forever, and the ~199 OTHER tenants' records in it were lost.
    const rec = normalize({ ...basePayload, speed: 65535, angle: 65535 }, hash)
    expect(rec.speed).toBeNull()
    expect(rec.course).toBeNull()
    // the position itself survives — it is still useful without a heading
    expect(rec.lat).toBe(basePayload.lat)
    expect(rec.fixValid).toBe(true)
  })

  it('keeps ordinary readings and rejects only semantically impossible ones', () => {
    const ok = normalize({ ...basePayload, speed: 90, angle: 359 }, hash)
    expect(ok.speed).toBe(90)
    expect(ok.course).toBe(359)
    // a heading of 400 is not a heading
    expect(normalize({ ...basePayload, angle: 400 }, hash).course).toBeNull()
  })

  it('an out-of-range odometer is nulled too — bigint overflows exactly as speed did', () => {
    // REGRESSION (review high): only speed/course/altitude were bounded. AVL id 16 arrives as an
    // unbounded N8 value and goes into `odometer_m bigint`, so ≥2^63 raises 22003 and poisons the
    // batch by the identical mechanism the smallint clamp was added to stop.
    const nulled: string[] = []
    const rec = normalize({ ...basePayload, io: [[16, 2n ** 63n]] }, hash, undefined, (f) => nulled.push(f))
    expect(rec.odometerM).toBeNull()
    expect(nulled).toEqual(['odometerM'])
    // the largest value the column DOES accept is kept
    expect(normalize({ ...basePayload, io: [[16, 2n ** 63n - 1n]] }, hash).odometerM).toBe(2n ** 63n - 1n)
  })

  it('every nulled field is REPORTED — a silent null looks identical to a device that reports none', () => {
    const nulled: string[] = []
    normalize({ ...basePayload, speed: 65535, angle: 400, altitude: 40000 }, hash, undefined, (f) => nulled.push(f))
    expect(nulled.sort()).toEqual(['altitude', 'course', 'speed'])
  })

  it('a garbage satellite count falls to 0, which marks the fix INVALID (I5 fail-safe)', () => {
    // satellites is NOT NULL and rule 6 reads it, so it cannot simply be nulled. 0 ⇒ fix_valid=false,
    // which keeps the record out of trips, geofences and overspeed — the conservative side.
    const rec = normalize({ ...basePayload, satellites: 99999 }, hash)
    expect(rec.satellites).toBe(0)
    expect(rec.fixValid).toBe(false)
  })

  it('a FUTURE-dated fix is KEPT verbatim but flagged — fix_time is part of the primary key', () => {
    // The first attempt at this fix REWROTE fix_time to serverTime. That was wrong twice over:
    // `serverTimeMs` is stamped once per FRAME and a drifted RTC ships a whole BUFFER, so an entire
    // day's records collapsed onto one timestamp (the trail becomes a scribble and the trip engine
    // sees secs()===0 forever); and fix_time is part of `(device_id, fix_time, rec_hash)`, so a
    // device retransmit after a lost ACK gets a new serverTimeMs and therefore a SECOND row for one
    // physical record — an I3 break. The record is stored as sent; consumers decide what to trust.
    const serverTimeMs = Date.UTC(2026, 6, 1, 12, 0, 0)
    const tsMs = serverTimeMs + 10 * 3_600_000
    const rec = normalize({ ...basePayload, serverTimeMs, tsMs }, hash)
    expect(rec.fixTime.getTime()).toBe(tsMs) // verbatim — history is preserved
    expect(isClockSkewed(rec)).toBe(true) // …and the seam flags it for live state / the engines
  })

  it('ordinary jitter and buffered (past) records are NOT flagged', () => {
    const serverTimeMs = Date.UTC(2026, 6, 1, 12, 0, 0)
    // a minute ahead is normal clock/network skew
    expect(isClockSkewed(normalize({ ...basePayload, serverTimeMs, tsMs: serverTimeMs + 60_000 }, hash))).toBe(false)
    // a buffered flood is the WHOLE point of the protocol — the past is never suspect
    expect(isClockSkewed(normalize({ ...basePayload, serverTimeMs, tsMs: serverTimeMs - 30 * 86_400_000 }, hash))).toBe(false)
  })

  it('a whole buffered frame keeps its DISTINCT timestamps', () => {
    // the regression the clamp would have caused: one serverTimeMs per frame × 255 records
    const serverTimeMs = Date.UTC(2026, 6, 1, 12, 0, 0)
    const times = [0, 30, 60, 90, 120].map((s) =>
      normalize({ ...basePayload, serverTimeMs, tsMs: serverTimeMs + 10 * 3_600_000 + s * 1000 }, hash).fixTime.getTime(),
    )
    expect(new Set(times).size).toBe(5)
  })

  it('malformed payload throws (consumer dead-letters it)', () => {
    expect(() => normalize({ nonsense: true }, hash)).toThrow()
  })
})
