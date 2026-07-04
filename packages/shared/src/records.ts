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
