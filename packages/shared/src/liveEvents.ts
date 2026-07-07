import { z } from 'zod'

/**
 * Live event contract (E02-4/E02-6): the compact JSON LiveState publishes to
 * `live:{tenantId}` and stores in `device:{id}:last` → `json`. The WS gateway
 * forwards it verbatim; `GET /v1/devices/last` returns it as-is. The producer
 * is apps/worker/src/liveState.ts — its `compact` object must match this schema
 * (drift tripwire: packages/shared/__tests__/liveEvents.spec.ts).
 */
export const liveEventSchema = z.strictObject({
  deviceId: z.string(),
  /** null ⇒ device not mapped to an account; account-scoped consumers fail closed. */
  accountId: z.string().nullable(),
  fixTimeMs: z.number(),
  lat: z.number(),
  lon: z.number(),
  speed: z.number().nullable(),
  course: z.number().nullable(),
  satellites: z.number().int(),
  fixValid: z.boolean(),
  ignition: z.boolean().nullable(),
  priority: z.union([z.literal(0), z.literal(1), z.literal(2)]),
})

export type LiveEvent = z.infer<typeof liveEventSchema>
