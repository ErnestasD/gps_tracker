/**
 * Point-in-polygon for geofence containment (E05-2). Pure ray-casting over a GeoJSON
 * Polygon's rings (outer ring = coordinates[0]; any further rings are holes). Planar
 * on lon/lat — an excellent approximation for the ≤10,000 km² geofences the area cap
 * allows; matching PostGIS geography exactly would need a DB round-trip per fix (too
 * slow for the hot path — the whole point of the cached in-memory geoms). Antimeridian-
 * crossing polygons are out of scope (v1).
 */
export interface GeoPolygon {
  type: 'Polygon'
  coordinates: number[][][]
}

/** [minLon, minLat, maxLon, maxLat] — the outer ring's envelope. */
export type BBox = readonly [number, number, number, number]

/**
 * Envelope of a polygon's OUTER ring, computed ONCE per fence when it enters the cache.
 *
 * The ray-cast is O(vertices) and runs per record per fence on the process that hosts all 16 shard
 * consumers, so without an O(1) rejection a detailed fence costs its full vertex count for every
 * position on Earth. A vehicle is outside the great majority of a tenant's zones at any moment, so
 * the bbox answers almost every test in four comparisons (audit high).
 */
export function bboxOf(poly: GeoPolygon): BBox {
  let minLon = Infinity
  let minLat = Infinity
  let maxLon = -Infinity
  let maxLat = -Infinity
  for (const p of poly.coordinates[0] ?? []) {
    const x = p[0]!
    const y = p[1]!
    if (x < minLon) minLon = x
    if (x > maxLon) maxLon = x
    if (y < minLat) minLat = y
    if (y > maxLat) maxLat = y
  }
  return [minLon, minLat, maxLon, maxLat]
}

/** True when the point CANNOT be inside — a cheap, exact rejection (never a false negative). */
export const outsideBBox = (lon: number, lat: number, b: BBox): boolean =>
  lon < b[0] || lon > b[2] || lat < b[1] || lat > b[3]

/** Ray-cast test: is (lon,lat) inside this single ring? */
function inRing(lon: number, lat: number, ring: number[][]): boolean {
  let inside = false
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const pi = ring[i]!
    const pj = ring[j]!
    const xi = pi[0]!
    const yi = pi[1]!
    const xj = pj[0]!
    const yj = pj[1]!
    const intersect = yi > lat !== yj > lat && lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi
    if (intersect) inside = !inside
  }
  return inside
}

export function pointInPolygon(lon: number, lat: number, poly: GeoPolygon): boolean {
  const rings = poly.coordinates
  if (rings.length === 0 || !inRing(lon, lat, rings[0]!)) return false
  for (let k = 1; k < rings.length; k++) if (inRing(lon, lat, rings[k]!)) return false // inside a hole ⇒ outside
  return true
}
