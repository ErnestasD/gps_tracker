import { describe, expect, it } from 'vitest'

import { DEMO_CITIES, fleetPlacement, type DemoCity, type LngLat } from '../src/lib/demo-geo'

/**
 * The live demo fits its camera to ALL 24 vehicles, so how far apart they are decides the zoom.
 *
 * `lt` had the Kaunas loop as its second circuit, 91 km from the Vilnius one, so the map opened on
 * the whole country and a city fleet arrived as a vertical pile of overlapping labels — the demo's
 * single most-looked-at screen, showing the product at its worst (founder, 2026-09-06). Every other
 * city repeated its own loop and looked right, which is why the fault survived: it was in ONE
 * language.
 *
 * A demo fleet is a city fleet. This fails long before a placement is far enough away to zoom the
 * map out to a region again.
 */
const MAX_SPAN_KM = 25

/** THE placement rule — imported, not restated, so this cannot drift from what the map draws. */
const placements = (city: DemoCity, n = 24): LngLat[] =>
  Array.from({ length: n }, (_, i) => fleetPlacement(city, i).at)

const spanKm = (pts: LngLat[]) => {
  const lons = pts.map((p) => p[0])
  const lats = pts.map((p) => p[1])
  const midLat = (Math.max(...lats) + Math.min(...lats)) / 2
  return {
    ew: (Math.max(...lons) - Math.min(...lons)) * 111.32 * Math.cos((midLat * Math.PI) / 180),
    ns: (Math.max(...lats) - Math.min(...lats)) * 110.57,
  }
}

describe('a demo fleet stays inside one city', () => {
  for (const [lang, city] of Object.entries(DEMO_CITIES)) {
    it(`${lang} (${city.label}) fits in a city-sized view`, () => {
      const { ew, ns } = spanKm(placements(city))
      expect(ew).toBeLessThan(MAX_SPAN_KM)
      expect(ns).toBeLessThan(MAX_SPAN_KM)
    })
  }

  it('the two circuits still put the groups in different places', () => {
    // repeating one loop is only acceptable because the placement PHASE differs; if the second
    // group landed on the first group's points the fleet would be 16 vehicles wearing 24 labels
    for (const city of Object.values(DEMO_CITIES)) {
      const pts = placements(city)
      const key = (p: LngLat) => `${p[0]},${p[1]}`
      const firstGroup = new Set(pts.slice(0, 16).map(key))
      const reused = pts.slice(16).filter((p) => firstGroup.has(key(p)))
      expect(reused).toEqual([])
    }
  })
})
