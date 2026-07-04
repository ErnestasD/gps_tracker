import { readFileSync } from 'node:fs'

export interface RoutePoint {
  lat: number
  lon: number
  /** Bearing of the segment being travelled, degrees 0..359 (AVL "angle"). */
  angle: number
}

interface LineStringFeature {
  geometry: { type: 'LineString'; coordinates: [number, number][] }
}

const EARTH_R = 6371000

function haversineM(aLat: number, aLon: number, bLat: number, bLon: number): number {
  const dLat = ((bLat - aLat) * Math.PI) / 180
  const dLon = ((bLon - aLon) * Math.PI) / 180
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((aLat * Math.PI) / 180) * Math.cos((bLat * Math.PI) / 180) * Math.sin(dLon / 2) ** 2
  return 2 * EARTH_R * Math.asin(Math.sqrt(s))
}

function bearingDeg(aLat: number, aLon: number, bLat: number, bLon: number): number {
  const φ1 = (aLat * Math.PI) / 180
  const φ2 = (bLat * Math.PI) / 180
  const dλ = ((bLon - aLon) * Math.PI) / 180
  const y = Math.sin(dλ) * Math.cos(φ2)
  const x = Math.cos(φ1) * Math.sin(φ2) - Math.sin(φ1) * Math.cos(φ2) * Math.cos(dλ)
  return (Math.round((Math.atan2(y, x) * 180) / Math.PI) + 360) % 360
}

/** Loops forever along a LineString; position by distance-from-start (metres). */
export class Route {
  private readonly coords: [number, number][]
  private readonly cumulative: number[] // metres at each vertex
  readonly totalM: number

  constructor(geojsonPath: string) {
    const feature = JSON.parse(readFileSync(geojsonPath, 'utf8')) as LineStringFeature
    this.coords = feature.geometry.coordinates
    this.cumulative = [0]
    for (let i = 1; i < this.coords.length; i++) {
      const [aLon, aLat] = this.coords[i - 1]!
      const [bLon, bLat] = this.coords[i]!
      this.cumulative.push(this.cumulative[i - 1]! + haversineM(aLat, aLon, bLat, bLon))
    }
    this.totalM = this.cumulative[this.cumulative.length - 1]!
  }

  at(distanceM: number): RoutePoint {
    const d = ((distanceM % this.totalM) + this.totalM) % this.totalM
    let i = 1
    while (this.cumulative[i]! < d) i++
    const [aLon, aLat] = this.coords[i - 1]!
    const [bLon, bLat] = this.coords[i]!
    const segStart = this.cumulative[i - 1]!
    const segLen = this.cumulative[i]! - segStart
    const t = segLen === 0 ? 0 : (d - segStart) / segLen
    return {
      lat: aLat + (bLat - aLat) * t,
      lon: aLon + (bLon - aLon) * t,
      angle: bearingDeg(aLat, aLon, bLat, bLon),
    }
  }
}
