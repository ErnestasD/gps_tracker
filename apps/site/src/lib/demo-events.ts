import type { TFunction } from "i18next";

import { cityFor } from "@/lib/demo-geo";
import { demoZones } from "@/lib/demo-zones";

/**
 * The demo's event feed — ONE source, shared by the events page and the notification bell.
 *
 * They used to be two: the page held a structured feed (kind + payload, phrased through the
 * product's own translation keys) while the bell read a second mock whose "details" were finished
 * Lithuanian SENTENCES. Nothing could translate a sentence, so a visitor who picked Polish got a
 * Polish interface listing Lithuanian alerts — and the two feeds described different fleets.
 *
 * Everything here mirrors the real product's shapes on purpose: the same `kind` values, the same
 * payload fields, the same i18n keys. The demo exists to show the product, so it must not invent a
 * vocabulary the product does not have.
 */
export type Kind =
  | "geofence"
  | "overspeed"
  | "ignition"
  | "din_change"
  | "power_cut"
  | "low_battery"
  | "panic"
  | "device_offline"
  | "fuel_theft";

export type DemoEvent = {
  id: string;
  at: string;
  kind: Kind;
  deviceId: string;
  payload: Record<string, unknown>;
};

export const DEVICES = [
  { id: "dev_1", name: "Van 03" },
  { id: "dev_2", name: "Sprinter 07" },
  { id: "dev_3", name: "Van 08" },
  { id: "dev_4", name: "Truck 12" },
];

/**
 * A geofence crossing. The zone is a PLACEHOLDER and the coordinates come from the zone itself at
 * render time — see `localizeEvents`. The feed used to hardcode "Testas" / "STL bazė" at fixed
 * Vilnius coordinates, so the Warsaw demo reported crossings of zones that were not on its map, at
 * a latitude 700 km away from the vehicle that supposedly crossed them.
 */
const geo = (zone: "depot" | "yard", transition: "enter" | "exit", jitter: number) => ({
  geofenceId: zone === "yard" ? "gf_yard" : "gf_depot",
  zoneKey: zone,
  name: zone,
  transition,
  jitter,
  lat: 0,
  lon: 0,
});
/** An overspeed. `step` picks a point along the city's loop — see `localizeEvents`. */
const speed = (speedKmh: number, limitKmh: number, step: number) => ({ speedKmh, limitKmh, step, lat: 0, lon: 0 });

export const DEMO_EVENTS: DemoEvent[] = [
  { id: "ev_14", at: "2026-09-01T07:42:00Z", kind: "overspeed", deviceId: "dev_1", payload: speed(105, 90, 35) },
  { id: "ev_13", at: "2026-09-01T07:15:00Z", kind: "geofence", deviceId: "dev_1", payload: geo("yard", "exit", 0.002) },
  { id: "ev_12", at: "2026-09-01T06:58:00Z", kind: "geofence", deviceId: "dev_2", payload: geo("depot", "enter", 0.003) },
  { id: "ev_11", at: "2026-09-01T06:31:00Z", kind: "overspeed", deviceId: "dev_4", payload: speed(97, 90, 79) },
  { id: "ev_10", at: "2026-09-01T05:54:00Z", kind: "geofence", deviceId: "dev_2", payload: geo("depot", "exit", 0.003) },
  { id: "ev_09", at: "2026-08-31T19:22:00Z", kind: "geofence", deviceId: "dev_1", payload: geo("yard", "enter", 0.002) },
  { id: "ev_08", at: "2026-08-31T18:47:00Z", kind: "overspeed", deviceId: "dev_1", payload: speed(112, 90, 84) },
  { id: "ev_07", at: "2026-08-31T17:36:00Z", kind: "geofence", deviceId: "dev_3", payload: geo("yard", "exit", 0.002) },
  { id: "ev_06", at: "2026-08-31T16:05:00Z", kind: "geofence", deviceId: "dev_4", payload: geo("depot", "enter", 0.004) },
  { id: "ev_05", at: "2026-08-31T14:58:00Z", kind: "overspeed", deviceId: "dev_2", payload: speed(94, 90, 58) },
  { id: "ev_04", at: "2026-08-31T13:21:00Z", kind: "geofence", deviceId: "dev_4", payload: geo("depot", "exit", 0.003) },
  { id: "ev_03", at: "2026-08-31T11:49:00Z", kind: "geofence", deviceId: "dev_3", payload: geo("yard", "enter", 0.002) },
  { id: "ev_02", at: "2026-08-31T09:34:00Z", kind: "overspeed", deviceId: "dev_3", payload: speed(101, 90, 7) },
  { id: "ev_01", at: "2026-08-31T08:02:00Z", kind: "geofence", deviceId: "dev_1", payload: geo("yard", "enter", 0.003) },
];

export const deviceName = (id: string): string => DEVICES.find((d) => d.id === id)?.name ?? id;

/**
 * One line of prose for an event, built from its payload with the PRODUCT's keys.
 *
 * Both surfaces call this, so the bell and the table can never disagree about what an event says —
 * and both follow the interface language, because nothing here is a pre-written sentence.
 */
export function demoDetail(t: TFunction, e: DemoEvent): string {
  const p = e.payload as { name?: string; transition?: "enter" | "exit"; speedKmh?: number; limitKmh?: number };
  if (p.transition !== undefined && p.name !== undefined) {
    return t(p.transition === "enter" ? "events.s.geofence_enter" : "events.s.geofence_exit", { name: p.name });
  }
  return `${p.speedKmh} ${t("units.kmh")} > ${p.limitKmh} ${t("units.kmh")}`;
}

/**
 * The feed as this language's fleet would have produced it: zone names from the shared geofence
 * set, coordinates on the city's own roads.
 *
 * The static list carries placeholders rather than text and numbers because both depend on the
 * reader: a Berlin visitor's alerts must name Berlin zones at Berlin coordinates. Resolving at
 * render keeps ONE feed (the bell and the events table cannot drift apart) while letting it move.
 */
export function localizeEvents(lang: string): DemoEvent[] {
  const zones = demoZones(lang);
  const byKey: Record<string, (typeof zones)[number]> = { depot: zones[0], yard: zones[1] };
  const loop = cityFor(lang).loops[0];
  return DEMO_EVENTS.map((e) => {
    const p = e.payload;
    if (typeof p.zoneKey === "string") {
      const z = byKey[p.zoneKey];
      const anchor = (z.ring ?? z.line ?? [[0, 0]])[0];
      const j = typeof p.jitter === "number" ? p.jitter : 0;
      return { ...e, payload: { ...p, name: z.name, geofenceId: z.id, lat: anchor[1] + j, lon: anchor[0] + j } };
    }
    if (typeof p.step === "number") {
      const at = loop[(p.step * 3) % loop.length];
      return { ...e, payload: { ...p, lat: at[1], lon: at[0] } };
    }
    return e;
  });
}
