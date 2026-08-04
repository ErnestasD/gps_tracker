import { loadDictionary, type DictionaryFamily } from '@orbetra/codec'
import { rawStreamPayloadSchema, type NormalizedRecord, type RawStreamPayload } from '@orbetra/shared'

// Core AVL ids (wiki FMB120 table, PROJECT_PLAN §3.7): promoted to columns.
// https://wiki.teltonika-gps.com/view/FMB120_Teltonika_Data_Sending_Parameters_ID
const AVL_IGNITION = 239
const AVL_MOVEMENT = 240
const AVL_TOTAL_ODOMETER = 16

// Fuel ids kept under FORCED io_<id> keys (E08-3). 84 (l, ×0.1) and 89 (%) share the
// dictionary name "Fuel level" — a record carrying only ONE of them would store its value
// under a key whose unit the reader cannot know. Deterministic id-keys make the fuel
// series readable; values stay raw (multipliers apply at read, like every other attr).
// https://wiki.teltonika-gps.com/view/FMB120_Teltonika_Data_Sending_Parameters_ID
// (48 = OBD Fuel Level %, 84 = Fuel level l ×0.1, 89 = Fuel level %)
const FORCED_ID_KEYS = new Set([48, 84, 89])

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
const SMALLINT_MIN = -32768
const SMALLINT_MAX = 32767
/** Postgres `bigint` = signed 64-bit; AVL id 16 is an unbounded N8 IO value in this pipeline. */
const BIGINT_MIN = -(2n ** 63n)
const BIGINT_MAX = 2n ** 63n - 1n

/** Reports a field that was nulled, so the operator sees a firmware quirk instead of silent gaps. */
export type FieldNulled = (field: string) => void

export function normalize(
  payload: unknown,
  hash: HashFn,
  family: DictionaryFamily = 'fmb1xx',
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
  const dict = loadDictionary(family)

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
      const name = FORCED_ID_KEYS.has(id) ? undefined : dict.get(id)?.name
      // §3.7 never-dropped: dictionary names are NOT unique across ids (e.g. two
      // "Battery Voltage" rows) — on collision the later id keeps its io_<id> key
      let key = name ?? `io_${id}`
      if (key in attrs) key = `io_${id}`
      attrs[key] =
        typeof v === 'bigint'
          ? v <= BigInt(Number.MAX_SAFE_INTEGER)
            ? Number(v)
            : v.toString()
          : Buffer.from(v).toString('hex')
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
