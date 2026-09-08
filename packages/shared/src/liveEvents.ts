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
  /**
   * WHERE THE VEHICLE WAS LAST SEEN, carried forward across unplaceable reports.
   *
   * A Teltonika in deep sleep keeps reporting on schedule with `satellites: 0`, and I6 rightly
   * makes that fix invalid — it must never move a trip, a geofence or a trail. But it is also the
   * only thing the snapshot carries, so a car parked in its own yard vanished from the map
   * entirely: `GET /v1/devices/last` returned the newest row, that row was unplaceable, and the
   * map had nothing to draw. The founder's FMC150 reported the correct parked coordinates for
   * twenty hours while the map showed nothing (2026-09-08).
   *
   * The live store has always carried the last good fix forward WITHIN a session; this is the same
   * fact, in the snapshot, so a page load starts where the session would have been. It changes
   * nothing about validity: `fixValid` still says the current fix is not one, the status chips
   * still read "no GPS fix", and every I6 consumer still refuses the record. Absent when the device
   * has never had a valid fix — a marker at 0/0 is the Gulf of Guinea, not a vehicle.
   */
  lastFix: z
    .object({ lat: z.number(), lon: z.number(), fixTimeMs: z.number() })
    .optional(),
})

export type LiveEvent = z.infer<typeof liveEventSchema>

/**
 * WS close codes the gateway uses, in the application range (4000-4999) so they can never collide
 * with a protocol code. Shared because BOTH ends need them: the server sends them, and the SPA's
 * reconnect policy differs per reason. A code the client does not understand is a code that
 * changes nothing — which is how a "back off" signal turns into a reconnect storm.
 */
export const WS_CLOSE = {
  /** Session revoked, or the socket hit its max lifetime — reconnect immediately to re-authorize. */
  REVOKED: 4401,
  /** The client fell too far behind its feed and was cut. Reconnecting instantly just repeats it:
   *  back off, then reconnect and re-read current state. */
  SLOW_CONSUMER: 4408,
} as const

/**
 * Redis key of the per-tenant device index — the set `GET /v1/devices/last` reads to answer "which
 * devices are mine?" without scanning the platform-wide `device:tenant` hash (audit MED).
 *
 * Lives here rather than in the API because four things write it (device CRUD activate/deactivate,
 * the boot rehydrate, and the simulator/e2e seed) and a drifting literal in any one of them shows
 * up as a silently empty map, not as a failing build.
 *
 * It is a HINT, never the authority: readers re-verify each member against `device:tenant`.
 */
export const tenantDevicesKey = (tenantId: string): string => `tenant:${tenantId}:devices`
