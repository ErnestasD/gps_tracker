import type { TFunction } from "i18next";

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

const geo = (name: string, transition: "enter" | "exit", lat: number, lon: number) => ({
  geofenceId: name === "Testas" ? "gf_01" : "gf_02",
  name,
  transition,
  lat,
  lon,
});
const speed = (speedKmh: number, limitKmh: number, lat: number, lon: number) => ({ speedKmh, limitKmh, lat, lon });

export const DEMO_EVENTS: DemoEvent[] = [
  { id: "ev_14", at: "2026-09-01T07:42:00Z", kind: "overspeed", deviceId: "dev_1", payload: speed(105, 90, 54.7126, 25.2621) },
  { id: "ev_13", at: "2026-09-01T07:15:00Z", kind: "geofence", deviceId: "dev_1", payload: geo("Testas", "exit", 54.6721, 25.2797) },
  { id: "ev_12", at: "2026-09-01T06:58:00Z", kind: "geofence", deviceId: "dev_2", payload: geo("STL bazė", "enter", 54.6384, 25.1912) },
  { id: "ev_11", at: "2026-09-01T06:31:00Z", kind: "overspeed", deviceId: "dev_4", payload: speed(97, 90, 54.8942, 23.9036) },
  { id: "ev_10", at: "2026-09-01T05:54:00Z", kind: "geofence", deviceId: "dev_2", payload: geo("STL bazė", "exit", 54.6381, 25.1908) },
  { id: "ev_09", at: "2026-08-31T19:22:00Z", kind: "geofence", deviceId: "dev_1", payload: geo("Testas", "enter", 54.6725, 25.2801) },
  { id: "ev_08", at: "2026-08-31T18:47:00Z", kind: "overspeed", deviceId: "dev_1", payload: speed(112, 90, 55.0034, 24.9871) },
  { id: "ev_07", at: "2026-08-31T17:36:00Z", kind: "geofence", deviceId: "dev_3", payload: geo("Testas", "exit", 54.6718, 25.2793) },
  { id: "ev_06", at: "2026-08-31T16:05:00Z", kind: "geofence", deviceId: "dev_4", payload: geo("STL bazė", "enter", 54.6386, 25.1915) },
  { id: "ev_05", at: "2026-08-31T14:58:00Z", kind: "overspeed", deviceId: "dev_2", payload: speed(94, 90, 54.9214, 23.9402) },
  { id: "ev_04", at: "2026-08-31T13:21:00Z", kind: "geofence", deviceId: "dev_4", payload: geo("STL bazė", "exit", 54.6379, 25.1904) },
  { id: "ev_03", at: "2026-08-31T11:49:00Z", kind: "geofence", deviceId: "dev_3", payload: geo("Testas", "enter", 54.6723, 25.2799) },
  { id: "ev_02", at: "2026-08-31T09:34:00Z", kind: "overspeed", deviceId: "dev_3", payload: speed(101, 90, 54.7311, 25.3527) },
  { id: "ev_01", at: "2026-08-31T08:02:00Z", kind: "geofence", deviceId: "dev_1", payload: geo("Testas", "enter", 54.6726, 25.2802) },
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
