/**
 * Virtual-device route math (pure). A route is the OSRM driving geometry — an ordered
 * [lon,lat] coordinate list — prepared once into cumulative distances so each tick is a
 * binary search + linear interpolation, not a rescan.
 */

export interface PreparedRoute {
  coords: readonly [number, number][]
  /** cumulative metres from the start to coords[i] (cum[0] = 0) */
  cum: readonly number[]
  totalM: number
}

const R = 6_371_000

/** Great-circle distance in metres (haversine — same formula the trip engine trusts). */
export function haversineM(aLon: number, aLat: number, bLon: number, bLat: number): number {
  const dLat = ((bLat - aLat) * Math.PI) / 180
  const dLon = ((bLon - aLon) * Math.PI) / 180
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((aLat * Math.PI) / 180) * Math.cos((bLat * Math.PI) / 180) * Math.sin(dLon / 2) ** 2
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(s)))
}

/** Initial bearing from a → b, degrees 0–359 (the AVL course convention: clockwise from north). */
export function bearingDeg(aLon: number, aLat: number, bLon: number, bLat: number): number {
  const φ1 = (aLat * Math.PI) / 180
  const φ2 = (bLat * Math.PI) / 180
  const Δλ = ((bLon - aLon) * Math.PI) / 180
  const y = Math.sin(Δλ) * Math.cos(φ2)
  const x = Math.cos(φ1) * Math.sin(φ2) - Math.sin(φ1) * Math.cos(φ2) * Math.cos(Δλ)
  return (Math.round((Math.atan2(y, x) * 180) / Math.PI) + 360) % 360
}

export function prepRoute(coords: readonly [number, number][]): PreparedRoute | null {
  if (coords.length < 2) return null
  const cum: number[] = [0]
  for (let i = 1; i < coords.length; i++) {
    const [aLon, aLat] = coords[i - 1]!
    const [bLon, bLat] = coords[i]!
    cum.push(cum[i - 1]! + haversineM(aLon, aLat, bLon, bLat))
  }
  const totalM = cum[cum.length - 1]!
  return totalM > 0 ? { coords, cum, totalM } : null
}

/** Position + heading `m` metres along the route (clamped to [0, totalM]). */
export function pointAt(route: PreparedRoute, m: number): { lat: number; lon: number; course: number } {
  const d = Math.max(0, Math.min(route.totalM, m))
  // binary search: greatest i with cum[i] <= d
  let lo = 0
  let hi = route.cum.length - 1
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1
    if (route.cum[mid]! <= d) lo = mid
    else hi = mid - 1
  }
  const i = Math.min(lo, route.coords.length - 2)
  const [aLon, aLat] = route.coords[i]!
  const [bLon, bLat] = route.coords[i + 1]!
  const segM = route.cum[i + 1]! - route.cum[i]!
  const f = segM > 0 ? (d - route.cum[i]!) / segM : 0
  return {
    lon: aLon + (bLon - aLon) * f,
    lat: aLat + (bLat - aLat) * f,
    course: bearingDeg(aLon, aLat, bLon, bLat),
  }
}
