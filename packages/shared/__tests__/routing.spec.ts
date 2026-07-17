import { describe, expect, it } from 'vitest'

import {
  buildOsrmTripPath,
  mapOsrmTrip,
  OsrmResponseError,
  OsrmUnroutableError,
  routeOptimizeRequestSchema,
  type RouteStop,
} from '../src/routing.js'

const stop = (lat: number, lon: number, label?: string): RouteStop => ({ lat, lon, ...(label !== undefined ? { label } : {}) })

const STOPS: RouteStop[] = [stop(54.687, 25.28, 'Vilnius HQ'), stop(54.9, 23.91, 'Kaunas'), stop(55.73, 24.36)]

/** Canned OSRM /trip response: optimal order is input 0 → 2 → 1 (waypoint_index reorders). */
const OSRM_OK = {
  code: 'Ok',
  trips: [
    {
      geometry: { type: 'LineString', coordinates: [[25.28, 54.687], [24.36, 55.73], [23.91, 54.9]] },
      legs: [
        { duration: 3600.4, distance: 95_000.6 },
        { duration: 1800.2, distance: 60_000.4 },
      ],
      duration: 5400.6,
      distance: 155_001,
    },
  ],
  waypoints: [{ waypoint_index: 0 }, { waypoint_index: 2 }, { waypoint_index: 1 }],
}

describe('ADR-029 routeOptimizeRequestSchema', () => {
  it('rejects a single stop (min 2)', () => {
    expect(routeOptimizeRequestSchema.safeParse({ stops: [stop(54, 25)] }).success).toBe(false)
  })

  it('rejects 51 stops (max 50, below --max-trip-size 100)', () => {
    const stops = Array.from({ length: 51 }, (_, i) => stop(54 + i * 0.01, 25))
    expect(routeOptimizeRequestSchema.safeParse({ stops }).success).toBe(false)
    expect(routeOptimizeRequestSchema.safeParse({ stops: stops.slice(0, 50) }).success).toBe(true)
  })

  it('rejects an out-of-range latitude (91)', () => {
    expect(routeOptimizeRequestSchema.safeParse({ stops: [stop(91, 25), stop(54, 25)] }).success).toBe(false)
  })

  it('defaults roundtrip to true', () => {
    const parsed = routeOptimizeRequestSchema.parse({ stops: [stop(54, 25), stop(55, 24)] })
    expect(parsed.roundtrip).toBe(true)
  })
})

describe('ADR-029 buildOsrmTripPath', () => {
  it('roundtrip: lon,lat order, source pinned to first, no destination', () => {
    expect(buildOsrmTripPath(STOPS, true)).toBe(
      '/trip/v1/driving/25.28,54.687;23.91,54.9;24.36,55.73?roundtrip=true&source=first&geometries=geojson&overview=full&steps=false',
    )
  })

  it('one-way: roundtrip=false additionally pins destination=last', () => {
    expect(buildOsrmTripPath(STOPS, false)).toBe(
      '/trip/v1/driving/25.28,54.687;23.91,54.9;24.36,55.73?roundtrip=false&source=first&destination=last&geometries=geojson&overview=full&steps=false',
    )
  })
})

describe('ADR-029 mapOsrmTrip', () => {
  it('maps waypoint_index to the optimized order and keeps labels on reordered stops', () => {
    const r = mapOsrmTrip(OSRM_OK, STOPS)
    expect(r.order).toEqual([0, 2, 1]) // visit input 0, then 2, then 1
    expect(r.stops.map((s) => s.inputIndex)).toEqual([0, 2, 1])
    expect(r.stops.map((s) => s.visitOrder)).toEqual([0, 1, 2])
    expect(r.stops[0]!.label).toBe('Vilnius HQ')
    expect(r.stops[1]!.label).toBeUndefined() // input 2 has no label
    expect(r.stops[2]!.label).toBe('Kaunas')
    expect(r.geometry.type).toBe('LineString')
    expect(r.legs).toEqual([
      { durationS: 3600, distanceM: 95_001 },
      { durationS: 1800, distanceM: 60_000 },
    ])
    expect(r.totalDurationS).toBe(5401)
    expect(r.totalDistanceM).toBe(155_001)
  })

  it('throws the typed unroutable error on NoTrips (and NoSegment)', () => {
    expect(() => mapOsrmTrip({ code: 'NoTrips' }, STOPS)).toThrowError(OsrmUnroutableError)
    expect(() => mapOsrmTrip({ code: 'NoSegment', message: 'x' }, STOPS)).toThrowError(OsrmUnroutableError)
  })

  it('throws a response error for malformed bodies and non-permutation waypoints', () => {
    expect(() => mapOsrmTrip(null, STOPS)).toThrowError(OsrmResponseError)
    expect(() => mapOsrmTrip({ code: 'InvalidQuery' }, STOPS)).toThrowError(OsrmResponseError)
    expect(() => mapOsrmTrip({ ...OSRM_OK, waypoints: [{ waypoint_index: 0 }] }, STOPS)).toThrowError(OsrmResponseError)
    expect(() =>
      mapOsrmTrip({ ...OSRM_OK, waypoints: [{ waypoint_index: 0 }, { waypoint_index: 0 }, { waypoint_index: 1 }] }, STOPS),
    ).toThrowError(OsrmResponseError)
  })
})
