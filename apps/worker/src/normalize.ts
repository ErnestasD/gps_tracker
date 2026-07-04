import { loadDictionary, type DictionaryFamily } from '@orbetra/codec'
import { rawStreamPayloadSchema, type NormalizedRecord, type RawStreamPayload } from '@orbetra/shared'

// Core AVL ids (wiki FMB120 table, PROJECT_PLAN §3.7): promoted to columns.
// https://wiki.teltonika-gps.com/view/FMB120_Teltonika_Data_Sending_Parameters_ID
const AVL_IGNITION = 239
const AVL_MOVEMENT = 240
const AVL_TOTAL_ODOMETER = 16

export type HashFn = (data: Uint8Array) => bigint

/**
 * Stream payload → NormalizedRecord (PROJECT_PLAN §6.1 "normalize"):
 * dictionary decode (per-family; profile-driven lookup arrives with E03-3 —
 * default fmb1xx until devices carry profiles), fix_valid = satellites > 0
 * (CLAUDE.md rule 6), core IO promoted to columns, everything else → attrs
 * (named via dictionary, unknown ids kept as io_<id> — never dropped, §3.7).
 * rec_hash = xxhash64(raw) reinterpreted as SIGNED 64-bit (§6.3 R10 trap).
 */
export function normalize(
  payload: unknown,
  hash: HashFn,
  family: DictionaryFamily = 'fmb1xx',
): NormalizedRecord {
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
    else if (id === AVL_TOTAL_ODOMETER && typeof v === 'bigint') odometerM = v
    else {
      const name = dict.get(id)?.name
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

  return {
    deviceId: p.deviceId,
    fixTime: new Date(p.tsMs),
    serverTime: new Date(p.serverTimeMs),
    lat: p.lat,
    lon: p.lon,
    altitude: p.altitude,
    speed: p.speed,
    course: p.angle, // protocol "Angle" → DB "course" (§6.3 naming note)
    satellites: p.satellites,
    fixValid: p.satellites > 0, // rule 6 / I5
    ignition,
    movement,
    odometerM,
    priority: p.priority as 0 | 1 | 2,
    recHash: BigInt.asIntN(64, hash(p.raw)), // signed reinterpretation (R10)
    attrs,
  }
}
