import { z } from 'zod'

/**
 * Contract for entries ingest XADDs to `raw:{imei%16}` (PROJECT_PLAN §6.1; CBOR-encoded,
 * ADR-014/015). Validated on consume — malformed entries go to `raw:dead`.
 */
export const rawStreamPayloadSchema = z.object({
  deviceId: z.bigint().or(z.number().transform((n) => BigInt(n))),
  imei: z.string(),
  serverTimeMs: z.number(),
  tsMs: z.number(),
  priority: z.number().int().min(0).max(2),
  lat: z.number(),
  lon: z.number(),
  altitude: z.number(),
  angle: z.number(),
  satellites: z.number().int(),
  speed: z.number(),
  eventIoId: z.number().int(),
  io: z.array(z.tuple([z.number(), z.union([z.bigint(), z.number(), z.instanceof(Uint8Array)])])),
  raw: z.instanceof(Uint8Array),
})

export type RawStreamPayload = z.infer<typeof rawStreamPayloadSchema>

/** Appendix A contract — the pipeline's normalized record (changes require ADR). */
export interface NormalizedRecord {
  deviceId: bigint
  fixTime: Date
  serverTime: Date
  lat: number
  lon: number
  altitude: number | null
  speed: number | null
  course: number | null
  satellites: number
  fixValid: boolean
  ignition: boolean | null
  movement: boolean | null
  odometerM: bigint | null
  priority: 0 | 1 | 2
  recHash: bigint
  attrs: Record<string, unknown>
}

/**
 * The null island — lat 0, lon 0 — is not a place a tracked vehicle reports from.
 *
 * A device once sent exactly 0/0 while reporting 37 satellites, so `satellites > 0` (PROJECT_PLAN
 * §3.4, CLAUDE.md rule 6) called the fix valid and the vehicle appeared in the Gulf of Guinea. The
 * odds of a real fix landing on both axes at exactly 0.0000000 are nil, and the cost is asymmetric:
 * refusing one improbable mid-Atlantic fix loses a point nobody needed, while accepting a fabricated
 * one moves a customer's vehicle 6000 km, opens a phantom trip and can fire a geofence alarm.
 *
 * Deliberately EXACT equality, not a radius: a tolerance would start discarding real fixes off the
 * African coast, and this is a sentinel value, not a region.
 *
 * It lives HERE, not in the worker and not in the web client, because both must agree about the same
 * row — a rule with two definitions is a rule with two answers. See ADR-039.
 */
export const isNullIsland = (lat: number, lon: number): boolean => lat === 0 && lon === 0
