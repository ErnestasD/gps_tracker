import { z } from 'zod'

/**
 * Route optimization contracts + PURE OSRM `/trip` helpers (ADR-029). The API proxies
 * `POST /v1/routing/optimize` to a self-hosted OSRM's Trip service (TSP approximation:
 * exact for small n, farthest-insertion beyond — http://project-osrm.org/docs/v5.24.0/api/#trip-service).
 * Everything here is pure so both the request builder and the response mapper are unit-testable
 * without a network.
 */

// ── request ───────────────────────────────────────────────────────────────────
export const routeStopSchema = z.object({
  lat: z.number().min(-90).max(90),
  lon: z.number().min(-180).max(180),
  label: z.string().max(120).optional(),
})
export type RouteStop = z.infer<typeof routeStopSchema>

/** 2–50 stops: OSRM's container runs --max-trip-size 100; we cap well below (ADR-029). */
export const routeOptimizeRequestSchema = z.object({
  stops: z.array(routeStopSchema).min(2).max(50),
  roundtrip: z.boolean().default(true),
})
export type RouteOptimizeRequest = z.infer<typeof routeOptimizeRequestSchema>

// ── result ────────────────────────────────────────────────────────────────────
export interface RouteOptimizedStop {
  /** index of this stop in the REQUEST's stops array */
  inputIndex: number
  /** 0-based position in the optimized visiting order */
  visitOrder: number
  lat: number
  lon: number
  label?: string
}
export interface RouteLeg {
  durationS: number
  distanceM: number
}
export interface RouteOptimizeResult {
  /** order[visitOrder] = inputIndex — the optimized permutation of the input stops */
  order: number[]
  /** the input stops sorted by visitOrder */
  stops: RouteOptimizedStop[]
  /** road path for the whole trip (GeoJSON LineString, lon/lat pairs) */
  geometry: { type: 'LineString'; coordinates: [number, number][] }
  /** legs[i] = from visited stop i to the next (roundtrip adds the closing leg) */
  legs: RouteLeg[]
  totalDurationS: number
  totalDistanceM: number
}

// ── OSRM request builder ──────────────────────────────────────────────────────
/**
 * Path+query for OSRM's Trip service. `source=first` pins the start to the first input
 * stop; a non-roundtrip additionally pins `destination=last`. Coordinates are
 * `lon,lat` pairs joined by `;` (OSRM order, NOT lat/lon).
 */
export function buildOsrmTripPath(stops: readonly RouteStop[], roundtrip: boolean): string {
  const coords = stops.map((s) => `${s.lon},${s.lat}`).join(';')
  const dest = roundtrip ? '' : '&destination=last'
  return `/trip/v1/driving/${coords}?roundtrip=${roundtrip}&source=first${dest}&geometries=geojson&overview=full&steps=false`
}

// ── OSRM response mapper ──────────────────────────────────────────────────────
/** OSRM said the stops cannot be connected by road (NoTrips/NoSegment/NoRoute) → 422. */
export class OsrmUnroutableError extends Error {
  constructor(readonly code: string) {
    super(`OSRM unroutable: ${code}`)
    this.name = 'OsrmUnroutableError'
  }
}
/** Anything else non-Ok or shape-invalid — the caller treats it as a bad gateway (502). */
export class OsrmResponseError extends Error {
  constructor(detail: string) {
    super(`OSRM response invalid: ${detail}`)
    this.name = 'OsrmResponseError'
  }
}

const UNROUTABLE = new Set(['NoTrips', 'NoSegment', 'NoRoute'])

const osrmTripResponseSchema = z.object({
  code: z.string(),
  trips: z
    .array(
      z.object({
        geometry: z.object({ type: z.literal('LineString'), coordinates: z.array(z.tuple([z.number(), z.number()])) }),
        legs: z.array(z.object({ duration: z.number(), distance: z.number() })),
        duration: z.number(),
        distance: z.number(),
      }),
    )
    .min(1),
  // waypoints[i] describes INPUT stop i; waypoint_index = its position in the trip
  waypoints: z.array(z.object({ waypoint_index: z.number().int().nonnegative() })),
})

/**
 * Map a raw OSRM `/trip` JSON body to our result. Throws OsrmUnroutableError for
 * NoTrips/NoSegment/NoRoute and OsrmResponseError for any other non-Ok code or a
 * malformed/inconsistent body (bad permutation, waypoint count mismatch).
 */
export function mapOsrmTrip(json: unknown, stops: readonly RouteStop[]): RouteOptimizeResult {
  const head = z.object({ code: z.string() }).safeParse(json)
  if (!head.success) throw new OsrmResponseError('missing code')
  if (head.data.code !== 'Ok') {
    if (UNROUTABLE.has(head.data.code)) throw new OsrmUnroutableError(head.data.code)
    throw new OsrmResponseError(`code ${head.data.code}`)
  }
  const parsed = osrmTripResponseSchema.safeParse(json)
  if (!parsed.success) throw new OsrmResponseError('shape mismatch')
  const { trips, waypoints } = parsed.data
  if (waypoints.length !== stops.length) throw new OsrmResponseError('waypoint count mismatch')

  // waypoint_index must be a permutation of 0..n-1 (one visit per stop)
  const order = new Array<number>(stops.length).fill(-1)
  for (let inputIndex = 0; inputIndex < waypoints.length; inputIndex++) {
    const visitOrder = waypoints[inputIndex]!.waypoint_index
    if (visitOrder >= stops.length || order[visitOrder] !== -1) throw new OsrmResponseError('waypoint_index is not a permutation')
    order[visitOrder] = inputIndex
  }

  const orderedStops: RouteOptimizedStop[] = order.map((inputIndex, visitOrder) => {
    const s = stops[inputIndex]!
    return { inputIndex, visitOrder, lat: s.lat, lon: s.lon, ...(s.label !== undefined ? { label: s.label } : {}) }
  })

  const trip = trips[0]!
  return {
    order,
    stops: orderedStops,
    geometry: trip.geometry,
    legs: trip.legs.map((l) => ({ durationS: Math.round(l.duration), distanceM: Math.round(l.distance) })),
    totalDurationS: Math.round(trip.duration),
    totalDistanceM: Math.round(trip.distance),
  }
}
