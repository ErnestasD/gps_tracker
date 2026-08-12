import { applySign, loadDictionary, type AvlTable } from '@orbetra/codec'
import { rawStreamPayloadSchema, type NormalizedRecord, type RawStreamPayload } from '@orbetra/shared'

// Core AVL ids (wiki FMB120 table, PROJECT_PLAN §3.7): promoted to columns.
// https://wiki.teltonika-gps.com/view/FMB120_Teltonika_Data_Sending_Parameters_ID
const AVL_IGNITION = 239
const AVL_MOVEMENT = 240
const AVL_TOTAL_ODOMETER = 16

// Fuel ids kept under FORCED io_<id> keys (E08-3). 84 (l, ×0.1) and 89 (%) share the
// dictionary name "Fuel Level" — a record carrying only ONE of them would store its value
// under a key whose unit the reader cannot know. Deterministic id-keys make the fuel
// series readable; values stay raw (multipliers apply at read, like every other attr).
// https://wiki.teltonika-gps.com/view/FMB120_Teltonika_Data_Sending_Parameters_ID
// (48 = OBD Fuel Level %, 84 = Fuel level l ×0.1, 89 = Fuel level %)
const FORCED_ID_KEYS = new Set([48, 84, 89])

/**
 * Every id whose dictionary NAME is shared with another id in the same table.
 *
 * The hand-maintained list above covered the fuel trio and nothing else, because it was written
 * against a 323-id table. Regenerating from the live wiki produced new collisions — 857 and 858 are
 * both "LNG Level" now (they were "LNG Level Proc" and "LNG Level kg", one a percentage and one
 * kilograms), and 281/282 both became "Fault Codes". Under a shared name the old rule kept whichever
 * arrived FIRST and pushed the other to `io_<id>`, so which value a reader found under "LNG Level"
 * depended on the order the device happened to send them: 80 (%) or 1234 (kg).
 *
 * Deriving the set per table fixes the ones regeneration created, the pre-existing 67/168 "Battery
 * Voltage" pair, and every future one — a dictionary is regenerated, a hand-written list is not.
 */
const ambiguousIds = new WeakMap<Map<number, { name: string }>, Set<number>>()
function ambiguousInTable(dict: Map<number, { name: string }>): Set<number> {
  const cached = ambiguousIds.get(dict)
  if (cached) return cached
  const byName = new Map<string, number[]>()
  for (const [id, e] of dict) byName.set(e.name, [...(byName.get(e.name) ?? []), id])
  const set = new Set<number>()
  for (const ids of byName.values()) if (ids.length > 1) for (const id of ids) set.add(id)
  ambiguousIds.set(dict, set)
  return set
}

export type HashFn = (data: Uint8Array) => bigint

/**
 * Stream payload → NormalizedRecord (PROJECT_PLAN §6.1 "normalize"):
 * dictionary decode (per-family; profile-driven lookup arrives with E03-3 —
 * default fmb1xx until devices carry profiles), fix_valid = satellites > 0
 * (CLAUDE.md rule 6), core IO promoted to columns, everything else → attrs
 * (named via dictionary, unknown ids kept as io_<id> — never dropped, §3.7).
 * rec_hash = xxhash64(raw) reinterpreted as SIGNED 64-bit (§6.3 R10 trap).
 */
/**
 * `positions.speed / course / altitude` are Postgres **smallint** (max 32767) while the protocol
 * fields are **uint16** (max 65535) and altitude is signed. A single out-of-range value — a firmware
 * quirk, a corrupt datagram, a spoofed frame — made the whole multi-row INSERT raise 22003, so the
 * batch was never ACKed, XAUTOCLAIM re-delivered it forever, and the ~199 records BESIDE it (other
 * tenants, on the same shard) were never written even though ingest had already ACKed them and the
 * devices had dropped them from their buffers. Audit critical #2.
 *
 * A garbage reading is nulled rather than the record dropped: the position itself is still valuable,
 * and every consumer already treats these as nullable. Bounds are semantic, not merely numeric —
 * a heading is 0-360, and 1000 km/h is already far beyond any road vehicle.
 */
/** How far ahead of server_time a device clock may legitimately run before we distrust it. */
export const MAX_CLOCK_SKEW_MS = 5 * 60_000

/**
 * A record whose device clock runs AHEAD of the server's — do not trust its `fix_time` for anything
 * ORDERING or LIVENESS related (audit high).
 *
 * Ingest's §3.6 sanity accepts a fix up to 48 h in the future, and every downstream consumer guards
 * only the past direction: live state is max-wins on fix_time, the motion engines drop anything
 * older than `lastSeen`, offline detection computes `now − lastFixMs`. So one record from a device
 * whose RTC drifted forward froze the map marker and the WS publish until wall-clock caught up,
 * suppressed `device_offline` for the same span, and pushed every subsequent real record into the
 * late map — enqueueing a recompute per batch. Nothing self-healed.
 *
 * The record is still WRITTEN: `fix_time` is part of the primary key
 * `(device_id, fix_time, rec_hash)`, so rewriting it would (a) collapse a whole buffered frame onto
 * one timestamp — `serverTimeMs` is stamped once per FRAME, and a bad RTC ships a whole buffer, not
 * one record — and (b) break I3, because a device retransmit after a lost ACK gets a NEW
 * serverTimeMs and therefore a second row for one physical record. This is the same seam as I5:
 * the row is kept, it just does not move state.
 */
export const isClockSkewed = (r: { fixTime: Date; serverTime: Date }): boolean =>
  r.fixTime.getTime() > r.serverTime.getTime() + MAX_CLOCK_SKEW_MS

const SMALLINT_MIN = -32768
const SMALLINT_MAX = 32767
/** Postgres `bigint` = signed 64-bit; AVL id 16 is an unbounded N8 IO value in this pipeline. */
const BIGINT_MIN = -(2n ** 63n)
const BIGINT_MAX = 2n ** 63n - 1n

/** Reports a field that was nulled, so the operator sees a firmware quirk instead of silent gaps. */
export type FieldNulled = (field: string) => void

/**
 * The table used when the caller does not name one.
 *
 * `fmb120` is the 640-element table that 45 Teltonika models render identically — the whole FMB1xx
 * family plus most of FMC/FMM/FMU/FMP/FMT — so it is the safest thing to decode an unattributed
 * record with. It is a FALLBACK, not a default to rely on: a TAT or FMx6xx device decoded with it is
 * MISLABELLED, not merely unnamed (id 520 is "Tamper detection Event" on a TAT and "Agricultural
 * State Flags P4" here), so every caller that knows the device must pass its table.
 *
 * AND IT IS NOT A PURE UPGRADE ON THE OLD HAND-MADE FILE. The live FMB120 table has since dropped
 * ten ids the old file carried, four of them Signed °C: 269/272/275/278 "Escort LLS Temperature
 * #1–#4", their battery-voltage siblings 271/274/277/280, plus 8 "Authorized iButton" and 244
 * "DIN2/AIN2 spec event". A device still emitting 269 goes from −3 °C to `io_269 = 65533` until its
 * profile names a table. They are not retired parameters — the Escort block is alive on fmb150,
 * fmc150, fmm150, fmc250, fmm80a and fmb010, and id 8 on the FMx6xx tables — so wiring profile →
 * table restores every one of them with the correct sign.
 *
 * THAT WIRING NOW EXISTS: the device profile's `avlTable` travels through `device:config` and the
 * consumer resolves it per device (AvlTableCache). This stays the fallback for the cases where the
 * answer is genuinely unavailable — a config row written before the field existed, a Redis blip, a
 * table name the codec no longer ships — because a position decoded with imperfect IO names is
 * worth incomparably more to a customer than no position. It is NOT a default to design against.
 */
export const FALLBACK_AVL_TABLE: AvlTable = 'fmb120'

export function normalize(
  payload: unknown,
  hash: HashFn,
  table: AvlTable = FALLBACK_AVL_TABLE,
  onFieldNulled?: FieldNulled,
): NormalizedRecord {
  const inRangeOrNull = (field: string, v: number | null, min: number, max: number): number | null => {
    if (v === null) return null
    if (!Number.isFinite(v) || v < min || v > max) {
      onFieldNulled?.(field)
      return null
    }
    return Math.round(v)
  }
  const smallintOrNull = (field: string, v: number | null): number | null =>
    inRangeOrNull(field, v, SMALLINT_MIN, SMALLINT_MAX)
  const p: RawStreamPayload = rawStreamPayloadSchema.parse(payload)
  const dict = loadDictionary(table)

  let ignition: boolean | null = null
  let movement: boolean | null = null
  let odometerM: bigint | null = null
  const attrs: Record<string, unknown> = {}

  for (const [id, value] of p.io) {
    const v = typeof value === 'number' ? BigInt(value) : value
    if (id === AVL_IGNITION && typeof v === 'bigint') ignition = v === 1n
    else if (id === AVL_MOVEMENT && typeof v === 'bigint') movement = v === 1n
    else if (id === AVL_TOTAL_ODOMETER && typeof v === 'bigint') {
      // odometer_m is bigint, but AVL id 16 arrives as an unbounded N8 value — a ≥2^63 reading
      // raises 22003 and poisons the whole batch exactly as an out-of-range speed did.
      if (v < BIGINT_MIN || v > BIGINT_MAX) onFieldNulled?.('odometerM')
      else odometerM = v
    }
    else {
      const entry = dict.get(id)
      const name = FORCED_ID_KEYS.has(id) || ambiguousInTable(dict).has(id) ? undefined : entry?.name
      // §3.7 never-dropped. Every ambiguous id is already forced to `io_<id>` above, so this is now
      // a backstop rather than the mechanism: it used to be the only thing standing between two
      // same-named parameters, and it resolved them by ARRIVAL ORDER, which is not a property the
      // device guarantees.
      let key = name ?? `io_${id}`
      if (key in attrs) key = `io_${id}`
      // Two's-complement reinterpretation for the parameters the wiki marks Signed (audit MED). The
      // wire carries raw bytes; the dictionary is what says how to read them, and nothing did — so
      // a −5 °C coolant/BLE temperature surfaced as 251 and an accelerometer axis as ~65 000, in
      // the UI, in exports, and in any rule threshold built on them.
      const signed = typeof v === 'bigint' ? applySign(entry, v) : v
      attrs[key] =
        typeof signed === 'bigint'
          ? signed >= BigInt(Number.MIN_SAFE_INTEGER) && signed <= BigInt(Number.MAX_SAFE_INTEGER)
            ? Number(signed)
            : signed.toString()
          : Buffer.from(signed).toString('hex')
    }
  }

  const sats = smallintOrNull('satellites', p.satellites) ?? 0


  return {
    deviceId: p.deviceId,
    fixTime: new Date(p.tsMs),
    serverTime: new Date(p.serverTimeMs),
    lat: p.lat,
    lon: p.lon,
    altitude: smallintOrNull('altitude', p.altitude),
    // km/h; the protocol field is uint16 (see the smallint note). Bound is the COLUMN's, not a
    // semantic one — a speed we merely disbelieve is real data, and dropping it needs a rule, not
    // a magic number. The rule engine applies its own overspeed thresholds downstream.
    speed: inRangeOrNull('speed', p.speed, 0, SMALLINT_MAX),
    // protocol "Angle" → DB "course" (§6.3 naming note); valid heading is 0-360
    course: inRangeOrNull('course', p.angle, 0, 360),
    // satellites is smallint and NOT NULL (rule 6 / I5 reads it). An out-of-range count is garbage,
    // so fall to 0 — which marks the fix INVALID, the fail-safe side of I5.
    satellites: sats,
    fixValid: sats > 0, // rule 6 / I5 — reads the SAME value the row stores
    ignition,
    movement,
    odometerM,
    priority: p.priority as 0 | 1 | 2,
    recHash: BigInt.asIntN(64, hash(p.raw)), // signed reinterpretation (R10)
    attrs,
  }
}
