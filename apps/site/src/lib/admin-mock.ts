// Deterministic mock data for the admin panel demo.
// No network calls — everything is generated in-memory.
//
// Every generator takes the DemoContent for the interface language: the people, plates, towns and
// job names belong to the city the fleet drives in, and the words the operator typed belong to the
// language they read. The pools used to be Lithuanian constants, so a German visitor pressing ⌘K
// searched a fleet crewed by Jonas Kazlauskas driving between Klaipėda and Marijampolė. See
// demo-content.
import type { DemoContent } from "@/lib/demo-content";

export type DeviceStatus = "active" | "idle" | "offline" | "maintenance";
export type Device = {
  id: string;
  name: string;
  imei: string;
  plate: string;
  driver: string;
  status: DeviceStatus;
  speed: number;
  lastSeen: string;
  battery: number;
  fuel: number;
  odometer: number;
  location: string;
  lat: number;
  lng: number;
};

export type Driver = {
  id: string;
  name: string;
  license: string;
  phone: string;
  status: "active" | "on-leave" | "inactive";
  score: number;
  trips: number;
  km: number;
  vehicle: string;
};

export type Trip = {
  id: string;
  device: string;
  driver: string;
  start: string;
  end: string;
  distance: number;
  duration: string;
  avgSpeed: number;
  maxSpeed: number;
  fuelUsed: number;
  from: string;
  to: string;
};

export type Geofence = {
  id: string;
  name: string;
  type: "polygon" | "circle" | "corridor";
  color: string;
  devices: number;
  triggers: number;
  created: string;
  // Geometry in lat/lng. Polygon/corridor use `points`; circle uses `center` + `radiusKm`.
  points?: { lat: number; lng: number }[];
  center?: { lat: number; lng: number };
  radiusKm?: number;
};

export type Rule = {
  id: string;
  name: string;
  type: "speeding" | "offline" | "geofence" | "panic" | "idle";
  enabled: boolean;
  channels: string[];
  cooldown: number;
  triggered: number;
  scope: string;
};

export type MaintenanceTask = {
  id: string;
  device: string;
  service: string;
  dueKm: number;
  currentKm: number;
  dueDate: string;
  status: "ok" | "due" | "overdue";
};

export type Command = {
  id: string;
  device: string;
  command: string;
  status: "queued" | "sent" | "ack" | "failed";
  created: string;
  operator: string;
};

export type ApiKey = {
  id: string;
  label: string;
  prefix: string;
  scopes: string[];
  lastUsed: string;
  created: string;
};

export type Webhook = {
  id: string;
  url: string;
  events: string[];
  status: "active" | "paused" | "failing";
  successRate: number;
  lastDelivery: string;
};

export type AuditEntry = {
  id: string;
  ts: string;
  actor: string;
  action: string;
  target: string;
  ip: string;
};

export type Invoice = {
  id: string;
  number: string;
  period: string;
  amount: number;
  status: "paid" | "open" | "overdue";
  issued: string;
  due: string;
};

// -----------------------------------------------------------
// Seed helpers (deterministic pseudo-random via mulberry32)
// -----------------------------------------------------------
function rng(seed: number) {
  return function () {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = seed;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function pick<T>(r: () => number, arr: T[]) { return arr[Math.floor(r() * arr.length)]; }

/** A full name from the city's pools — the demo's people all come from here. */
function person(c: DemoContent, r: () => number): string {
  return `${pick(r, c.firstNames)} ${pick(r, c.lastNames)}`;
}

// Fixed "now" so SSR and client renders match deterministically.
const NOW = new Date("2026-07-16T15:00:00.000Z").getTime();
function isoAgo(minutes: number) {
  return new Date(NOW - minutes * 60_000).toISOString();
}

export function generateDevices(c: DemoContent, count = 24): Device[] {
  const r = rng(42);
  const out: Device[] = [];
  for (let i = 0; i < count; i++) {
    const statuses: DeviceStatus[] = ["active", "active", "active", "idle", "offline", "maintenance"];
    const status = pick(r, statuses);
    const speed = status === "active" ? Math.round(r() * 110) : 0;
    out.push({
      id: `dev_${(i + 1).toString().padStart(4, "0")}`,
      name: `${pick(r, ["Van", "Truck", "Sprinter", "Transit"])} ${(i + 1).toString().padStart(2, "0")}`,
      imei: `86700012${(1000 + i).toString().padStart(7, "0")}`.slice(0, 15),
      plate: c.plate(r),
      driver: person(c, r),
      status,
      speed,
      lastSeen: isoAgo(Math.floor(r() * (status === "offline" ? 4320 : 60))),
      battery: Math.round(20 + r() * 80),
      fuel: Math.round(15 + r() * 85),
      odometer: Math.round(30000 + r() * 200000),
      location: pick(r, c.towns),
      lat: 54.6 + (r() - 0.5) * 1.2,
      lng: 24.5 + (r() - 0.5) * 2.2,
    });
  }
  return out;
}

export function generateDrivers(c: DemoContent, count = 14): Driver[] {
  const r = rng(7);
  const out: Driver[] = [];
  for (let i = 0; i < count; i++) {
    out.push({
      id: `drv_${(i + 1).toString().padStart(4, "0")}`,
      name: person(c, r),
      license: `${c.licensePrefix}${Math.floor(1000000 + r() * 9000000)}`,
      phone: `${c.phonePrefix}${Math.floor(1000000 + r() * 9000000)}`,
      status: pick(r, ["active", "active", "active", "on-leave", "inactive"] as const),
      score: Math.round(60 + r() * 40),
      trips: Math.round(20 + r() * 400),
      km: Math.round(1500 + r() * 60000),
      vehicle: `${pick(r, ["Van", "Truck"])} ${Math.floor(1 + r() * 24).toString().padStart(2, "0")}`,
    });
  }
  return out;
}

export function generateTrips(c: DemoContent, count = 60): Trip[] {
  const r = rng(101);
  const out: Trip[] = [];
  for (let i = 0; i < count; i++) {
    const dist = Math.round(5 + r() * 320);
    const dur = Math.round(10 + dist * 1.2);
    out.push({
      id: `trp_${(i + 1).toString().padStart(5, "0")}`,
      device: `Van ${Math.floor(1 + r() * 24).toString().padStart(2, "0")}`,
      driver: person(c, r),
      start: isoAgo(i * 240 + Math.floor(r() * 120)),
      end: isoAgo(i * 240),
      distance: dist,
      duration: `${Math.floor(dur / 60)}h ${dur % 60}m`,
      avgSpeed: Math.round(dist / (dur / 60)),
      maxSpeed: Math.round(70 + r() * 60),
      fuelUsed: Math.round(dist * 0.09 * 10) / 10,
      from: pick(r, c.towns),
      to: pick(r, c.towns),
    });
  }
  return out;
}

export function generateRules(c: DemoContent): Rule[] {
  const r = rng(5);
  return [
    { id: "rul_1", name: c.rules.overspeed, type: "speeding", enabled: true, channels: ["email", "webhook"], cooldown: 300, triggered: 42, scope: c.scopes.all },
    { id: "rul_2", name: c.rules.offline, type: "offline", enabled: true, channels: ["email"], cooldown: 600, triggered: 12, scope: c.scopes.all },
    { id: "rul_3", name: "SOS", type: "panic", enabled: true, channels: ["email", "sms", "webhook"], cooldown: 60, triggered: 2, scope: c.scopes.drivers },
    { id: "rul_4", name: c.rules.geofence, type: "geofence", enabled: false, channels: ["email"], cooldown: 0, triggered: 0, scope: c.zones.depot },
    { id: "rul_5", name: c.rules.idle, type: "idle", enabled: true, channels: ["email"], cooldown: 900, triggered: Math.round(r() * 40), scope: c.scopes.vans },
  ];
}

export function generateMaintenance(c: DemoContent): MaintenanceTask[] {
  const r = rng(11);
  const services = c.services;
  const out: MaintenanceTask[] = [];
  for (let i = 0; i < 14; i++) {
    const dueKm = Math.round(80000 + r() * 200000);
    const cur = dueKm - Math.round((r() - 0.3) * 20000);
    const delta = dueKm - cur;
    const status: MaintenanceTask["status"] = delta < 0 ? "overdue" : delta < 3000 ? "due" : "ok";
    out.push({
      id: `mnt_${i + 1}`,
      device: `${pick(r, ["Van", "Truck"])} ${Math.floor(1 + r() * 24).toString().padStart(2, "0")}`,
      service: pick(r, services),
      dueKm,
      currentKm: cur,
      dueDate: new Date(NOW + delta * 20 * 60_000).toISOString(),
      status,
    });
  }
  return out;
}

export function generateCommands(c: DemoContent): Command[] {
  const r = rng(17);
  const cmds = ["Engine block", "Engine unblock", "Reboot", "Request location", "Update firmware"];
  const stat: Command["status"][] = ["queued", "sent", "ack", "failed"];
  return Array.from({ length: 20 }, (_, i) => ({
    id: `cmd_${(i + 1).toString().padStart(4, "0")}`,
    device: `Van ${Math.floor(1 + r() * 24).toString().padStart(2, "0")}`,
    command: pick(r, cmds),
    status: stat[Math.min(3, Math.floor(r() * 4))],
    created: isoAgo(i * 30),
    operator: person(c, r),
  }));
}

export function generateApiKeys(): ApiKey[] {
  return [
    { id: "k1", label: "Production backend", prefix: "orb_live_a94f…", scopes: ["read", "write"], lastUsed: isoAgo(5), created: isoAgo(60_000) },
    { id: "k2", label: "Analytics BI", prefix: "orb_live_71cd…", scopes: ["read"], lastUsed: isoAgo(140), created: isoAgo(240_000) },
    { id: "k3", label: "Zapier", prefix: "orb_live_bb02…", scopes: ["read", "webhook"], lastUsed: isoAgo(6000), created: isoAgo(500_000) },
  ];
}

export function generateWebhooks(c: DemoContent): Webhook[] {
  return [
    { id: "w1", url: `https://${c.clientHost}/orbetra/events`, events: ["event.*", "trip.completed"], status: "active", successRate: 99.7, lastDelivery: isoAgo(2) },
    { id: "w2", url: "https://hooks.slack.com/services/T00/B00/xxx", events: ["event.sos", "event.speeding"], status: "active", successRate: 100, lastDelivery: isoAgo(35) },
    { id: "w3", url: `https://staging.${c.clientHost}/hook`, events: ["*"], status: "failing", successRate: 71.4, lastDelivery: isoAgo(600) },
  ];
}

export function generateAudit(c: DemoContent): AuditEntry[] {
  const r = rng(23);
  const actions = ["user.login", "device.create", "device.update", "rule.enable", "rule.disable", "geofence.create", "apikey.create", "settings.update"];
  return Array.from({ length: 30 }, (_, i) => ({
    id: `aud_${(i + 1).toString().padStart(5, "0")}`,
    ts: isoAgo(i * 20 + Math.floor(r() * 20)),
    actor: person(c, r),
    action: pick(r, actions),
    target: pick(r, ["dev_0021", "rul_1", "geo_2", "user_admin", "settings.notifications"]),
    ip: `85.${Math.floor(r() * 255)}.${Math.floor(r() * 255)}.${Math.floor(r() * 255)}`,
  }));
}

export function generateInvoices(): Invoice[] {
  return [
    { id: "i1", number: "INV-2026-0007", period: "2026-07", amount: 168, status: "open", issued: isoAgo(60), due: isoAgo(-20000) },
    { id: "i2", number: "INV-2026-0006", period: "2026-06", amount: 168, status: "paid", issued: isoAgo(43200), due: isoAgo(21600) },
    { id: "i3", number: "INV-2026-0005", period: "2026-05", amount: 152, status: "paid", issued: isoAgo(86400), due: isoAgo(64800) },
    { id: "i4", number: "INV-2026-0004", period: "2026-04", amount: 152, status: "paid", issued: isoAgo(129600), due: isoAgo(108000) },
  ];
}

// Pre-computed static series for dashboard charts
export const fleetActivitySeries = Array.from({ length: 30 }, (_, i) => {
  const day = new Date();
  day.setDate(day.getDate() - (29 - i));
  const base = 800 + Math.sin(i / 3) * 220 + (i > 20 ? 120 : 0);
  return {
    date: day.toISOString().slice(0, 10),
    km: Math.round(base + ((i * 37) % 90)),
    trips: Math.round(40 + Math.sin(i / 2) * 12 + ((i * 13) % 8)),
  };
});

export const eventsBreakdown = [
  { name: "Greičio viršijimai", value: 42, color: "#F59E0B" },
  { name: "Geozonos", value: 68, color: "#4F46E5" },
  { name: "Staigūs manevrai", value: 21, color: "#0284C7" },
  { name: "Be ryšio", value: 12, color: "#94A3B8" },
  { name: "SOS", value: 2, color: "#E11D48" },
];

export const utilizationSeries = Array.from({ length: 24 }, (_, i) => ({
  hour: `${i.toString().padStart(2, "0")}:00`,
  active: Math.max(0, Math.round(4 + Math.sin((i - 8) / 3) * 8 + (i > 6 && i < 20 ? 6 : 0))),
}));

export const DASH = {
  activeDevices: 18,
  totalDevices: 24,
  todayKm: 1_246,
  weekKm: 8_910,
  openAlerts: 7,
  utilization: 74,
};
