import { circleRing, cityFor, type DemoCity, type LngLat } from "@/lib/demo-geo";
import { contentFor } from "@/lib/demo-content";

export type DemoZoneKind = "polygon" | "circle" | "corridor";

export type DemoZoneDef = {
  id: string;
  name: string;
  kind: DemoZoneKind;
  color: string;
  /** ISO — when this zone was "created", for the detail card */
  created: string;
  /** closed ring for polygons and circles */
  ring?: LngLat[];
  /** centre-line for corridors, drawn as a wide band */
  line?: LngLat[];
  corridorWidthPx?: number;
  /** circles keep their metres so the editor can show and change a radius */
  radiusM?: number;
};

/**
 * ONE set of geofences for the whole demo.
 *
 * There used to be three vocabularies for the same fiction: the live map drew two unnamed circles
 * ("depot", "second"), the geofences page listed "STL bazė" / "Saldėnė" / "Vilnius–Kaunas
 * koridorius" drawn somewhere else entirely, and the events, notifications and rules pages
 * referred to zone names that appeared on neither map. Clicking from an alert to the map showed a
 * zone that was not the one the alert named — the single most load-bearing claim the product
 * makes (a rule fired because a vehicle crossed THIS line) contradicted by the next screen.
 *
 * They are anchored to fractions of the city's routed loop, so they follow the fleet when the
 * language moves it — see demo-geo's `cityFor`. The corridor is a SLICE OF THAT LOOP rather than
 * an intercity motorway: the Vilnius demo used the real 100 km A1 centre-line, and fitting it
 * shrank the other two zones to invisible dots at the corner of the map.
 */
export function demoZones(lang: string): DemoZoneDef[] {
  const city = cityFor(lang);
  const names = contentFor(lang).zones;
  const loop = city.loops[0];
  const at = (f: number): LngLat => loop[Math.floor(loop.length * f) % loop.length];
  const depot = at(0.12);
  const yard = at(0.55);
  return [
    {
      id: "gf_depot",
      name: names.depot,
      kind: "circle",
      color: "#4F46E5",
      created: "2026-06-11T09:24:00Z",
      ring: circleRing(depot, 900),
      radiusM: 900,
    },
    {
      id: "gf_yard",
      name: names.yard,
      kind: "polygon",
      color: "#059669",
      created: "2026-07-02T14:05:00Z",
      ring: quad(yard, 700),
    },
    {
      id: "gf_corridor",
      name: names.corridor,
      kind: "corridor",
      color: "#B45309",
      created: "2026-07-19T07:48:00Z",
      line: slice(loop, 0.62, 0.9),
      corridorWidthPx: 12,
    },
  ];
}

/** The zone a geofence alert in the demo feed refers to — the depot, which the fleet leaves and re-enters. */
export function demoAlertZone(lang: string): string {
  return contentFor(lang).zones.depot;
}

/** A slightly irregular four-corner ring around a point — a hand-drawn yard, not a perfect square. */
function quad(center: LngLat, radiusM: number): LngLat[] {
  const [lng, lat] = center;
  const dLat = radiusM / 111_320;
  const dLng = dLat / Math.max(0.2, Math.cos((lat * Math.PI) / 180));
  const ring: LngLat[] = [
    [lng - dLng * 1.1, lat - dLat * 0.8],
    [lng + dLng * 0.9, lat - dLat * 1.0],
    [lng + dLng * 1.2, lat + dLat * 0.7],
    [lng - dLng * 0.8, lat + dLat * 1.1],
  ];
  ring.push(ring[0]); // closed — MapLibre fills an open ring, PostGIS would not accept one
  return ring;
}

/** A contiguous stretch of the loop, given as fractions of its length. */
function slice(loop: LngLat[], from: number, to: number): LngLat[] {
  const a = Math.floor(loop.length * from);
  const b = Math.floor(loop.length * to);
  return loop.slice(a, Math.max(a + 2, b));
}

/** The city behind a language, re-exported so pages need one import for the demo's world. */
export function demoCity(lang: string): DemoCity {
  return cityFor(lang);
}
