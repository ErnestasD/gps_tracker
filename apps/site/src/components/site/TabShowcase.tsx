import { motion, AnimatePresence } from "framer-motion";
import { useState, type ReactElement } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  ReferenceLine,
} from "recharts";
import {
  Map,
  Route,
  Radar,
  FileBarChart2,
  Terminal,
  Truck,
  Circle,
  ArrowUpRight,
  AlertTriangle,
  CheckCircle2,
  Clock,
  ChevronRight,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { TabMap } from "./TabMap";

interface Tab {
  id: string;
  label: string;
  icon: LucideIcon;
  panel: () => ReactElement;
}

const TABS: Tab[] = [
  { id: "map", label: "Live map", icon: Map, panel: LiveMapPanel },
  { id: "trips", label: "Trips & playback", icon: Route, panel: TripsPanel },
  { id: "geo", label: "Geofences & alerts", icon: Radar, panel: GeoPanel },
  { id: "reports", label: "Reports", icon: FileBarChart2, panel: ReportsPanel },
  { id: "commands", label: "Commands", icon: Terminal, panel: CommandsPanel },
];

export function TabShowcase() {
  const [active, setActive] = useState(TABS[0].id);
  const current = TABS.find((t) => t.id === active) ?? TABS[0];
  const CurrentPanel = current.panel;

  return (
    <div>
      <div className="flex flex-wrap gap-1 border-b border-[var(--hairline)]">
        {TABS.map((t) => {
          const Icon = t.icon;
          const isActive = t.id === active;
          return (
            <button
              key={t.id}
              onClick={() => setActive(t.id)}
              className={`relative inline-flex items-center gap-2 px-4 py-3 text-sm transition-colors duration-150 ${
                isActive ? "text-ink font-medium" : "text-muted-foreground hover:text-ink"
              }`}
            >
              <Icon className="h-4 w-4" strokeWidth={1.75} />
              {t.label}
              {isActive && (
                <motion.span
                  layoutId="tab-underline"
                  className="absolute left-2 right-2 -bottom-px h-[2px] bg-[var(--brand-blue)] rounded-full"
                />
              )}
            </button>
          );
        })}
      </div>

      <div className="mt-8 relative">
        <AnimatePresence mode="wait">
          <motion.div
            key={active}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            transition={{ duration: 0.22 }}
          >
            <div
              className="rounded-2xl overflow-hidden border border-[#22304C]/40 bg-[#0B1020]"
              style={{
                boxShadow:
                  "0 30px 80px -30px rgba(11,16,32,0.45), 0 10px 30px -15px rgba(37,99,235,0.25)",
              }}
            >
              {/* Browser chrome */}
              <div className="flex items-center justify-between px-4 py-2.5 bg-[#0F172A] border-b border-[#22304C]">
                <div className="flex items-center gap-1.5">
                  <span className="h-2.5 w-2.5 rounded-full bg-[#ff5f57]" />
                  <span className="h-2.5 w-2.5 rounded-full bg-[#febc2e]" />
                  <span className="h-2.5 w-2.5 rounded-full bg-[#28c840]" />
                </div>
                <div className="flex items-center gap-2 px-3 py-1 rounded-md bg-[#0B1020] border border-[#22304C]">
                  <Circle className="h-2 w-2 fill-[#10B981] text-[#10B981]" />
                  <span className="mono text-[10px] tracking-wider text-slate-300">
                    app.orbetra.eu / {current.label.toLowerCase()}
                  </span>
                </div>
                <div className="mono text-[10px] text-slate-500">v1.4.2</div>
              </div>
              <CurrentPanel />
            </div>
          </motion.div>
        </AnimatePresence>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────
// LIVE MAP
// ─────────────────────────────────────────────
// Realistic multi-waypoint corridors approximating major PL road paths.
// Extra waypoints give visible turns rather than a straight line.
const VEHICLE_PATHS: Record<string, [number, number][]> = {
  "9F42": [ // Warsaw → Łódź → Poznań → Szczecin (A2/S3 corridor)
    [21.012, 52.229], [20.62, 52.19], [20.20, 52.14], [19.85, 52.03],
    [19.46, 51.76], [19.05, 51.85], [18.55, 52.02], [18.10, 52.18],
    [17.55, 52.30], [17.10, 52.38], [16.925, 52.406], [16.40, 52.55],
    [15.85, 52.70], [15.35, 52.87], [14.90, 53.10], [14.55, 53.428],
  ],
  "A312": [ // Kraków → Katowice → Opole → Wrocław (A4)
    [19.945, 50.064], [19.60, 50.09], [19.25, 50.18], [19.02, 50.259],
    [18.66, 50.294], [18.28, 50.42], [17.93, 50.675], [17.55, 50.82],
    [17.30, 50.95], [17.038, 51.107],
  ],
  "C551": [ // Gdańsk → Elbląg → Olsztyn → Ełk → Białystok
    [18.646, 54.352], [19.00, 54.28], [19.40, 54.152], [19.85, 54.02],
    [20.20, 53.90], [20.482, 53.778], [20.95, 53.80], [21.45, 53.85],
    [21.90, 53.86], [22.36, 53.828], [22.70, 53.55], [23.00, 53.30],
    [23.164, 53.132],
  ],
  "E217": [ // Wrocław → Leszno → Poznań → Bydgoszcz → Gdańsk (S5)
    [17.038, 51.107], [16.85, 51.40], [16.65, 51.65], [16.58, 51.84],
    [16.72, 52.10], [16.925, 52.406], [17.20, 52.65], [17.55, 52.88],
    [17.85, 53.02], [18.005, 53.123], [18.35, 53.30], [18.65, 53.55],
    [18.72, 53.85], [18.68, 54.10], [18.646, 54.352],
  ],
};

const DEVICES = [
  { name: "MB Sprinter · 9F42", vin: "9F42", speed: 48, status: "moving", lng: 19.05, lat: 51.85, dur: 140, fuel: 62, signal: -72, ignition: true },
  { name: "MAN TGX · A312", vin: "A312", speed: 82, status: "moving", lng: 18.28, lat: 50.42, dur: 95, fuel: 78, signal: -68, ignition: true },
  { name: "VW Crafter · B871", vin: "B871", speed: 0, status: "idle", lng: 22.567, lat: 51.246, fuel: 41, signal: -81, ignition: true },
  { name: "Iveco Daily · C551", vin: "C551", speed: 63, status: "moving", lng: 20.482, lat: 53.778, dur: 130, fuel: 55, signal: -74, ignition: true },
  { name: "Volvo FH · D904", vin: "D904", speed: 0, status: "stopped", lng: 22.004, lat: 50.041, fuel: 88, signal: -90, ignition: false },
  { name: "Scania R · E217", vin: "E217", speed: 71, status: "moving", lng: 16.925, lat: 52.406, dur: 150, fuel: 47, signal: -70, ignition: true },
];


function statusColor(s: string) {
  if (s === "moving") return "#4c4dcf";
  if (s === "idle") return "#5B21B6";
  return "#475569";
}

function fmtCoord(v: number, pos: string, neg: string) {
  return `${Math.abs(v).toFixed(3)}°${v >= 0 ? pos : neg}`;
}

function LiveMapPanel() {
  const [selectedVin, setSelectedVin] = useState("9F42");
  const selected = DEVICES.find((d) => d.vin === selectedVin) ?? DEVICES[0];

  const staticMarkers = DEVICES
    .filter((d) => !VEHICLE_PATHS[d.vin])
    .map((d) => ({
      lng: d.lng,
      lat: d.lat,
      label: d.vin,
      color: statusColor(d.status),
      highlighted: d.vin === selectedVin,
    }));

  const animatedVehicles = DEVICES
    .filter((d) => VEHICLE_PATHS[d.vin])
    .map((d) => ({
      id: d.vin,
      path: VEHICLE_PATHS[d.vin],
      currentPosition: [d.lng, d.lat] as [number, number],
      label: d.vin,
      color: d.vin === selectedVin ? "#4c4dcf" : "#4338CA",
      highlighted: d.vin === selectedVin,
      durationSec: d.dur ?? 90,
      showTrail: true,
    }));

  const statusLabel =
    selected.status === "moving"
      ? `● Moving · Ignition ${selected.ignition ? "on" : "off"}`
      : selected.status === "idle"
      ? `● Idle · Ignition ${selected.ignition ? "on" : "off"}`
      : `● Stopped · Ignition ${selected.ignition ? "on" : "off"}`;

  return (
    <div className="h-[440px] grid grid-rows-1 grid-cols-[220px_1fr] text-slate-200">
      <aside className="border-r border-[rgba(76,77,207,0.18)] bg-[rgba(10,20,40,0.6)] overflow-hidden">
        <div className="px-3 py-2.5 border-b border-[rgba(76,77,207,0.18)] flex items-center justify-between">
          <span className="mono text-[10px] tracking-wider text-slate-400 uppercase">Devices</span>
          <span className="mono text-[10px] text-slate-500">6 / 132</span>
        </div>
        <ul>
          {DEVICES.map((d) => {
            const sel = d.vin === selectedVin;
            return (
              <li
                key={d.vin}
                onClick={() => setSelectedVin(d.vin)}
                className={`relative px-3 py-2.5 border-b border-[rgba(76,77,207,0.08)] text-[11px] cursor-pointer transition-all duration-200 ${
                  sel
                    ? "bg-[rgba(76,77,207,0.18)] shadow-[inset_0_0_0_1px_rgba(76,77,207,0.45),0_0_20px_-4px_rgba(76,77,207,0.5)]"
                    : "hover:bg-[rgba(76,77,207,0.06)]"
                }`}
              >
                {sel && (
                  <span
                    aria-hidden
                    className="absolute left-0 top-0 bottom-0 w-[2px] bg-[#4c4dcf] shadow-[0_0_10px_rgba(76,77,207,0.9)]"
                  />
                )}
                <div className="flex items-center gap-2">
                  <span
                    className={`h-1.5 w-1.5 rounded-full ${sel ? "animate-pulse" : ""}`}
                    style={{ background: statusColor(d.status), boxShadow: d.status === "moving" || sel ? `0 0 6px ${statusColor(d.status)}` : "none" }}
                  />
                  <span className={`truncate ${sel ? "text-white font-medium" : "text-slate-100"}`}>{d.name}</span>
                  {sel && (
                    <span className="ml-auto mono text-[8px] uppercase tracking-wider text-[#4c4dcf]">
                      ● Live
                    </span>
                  )}
                </div>
                <div className="mt-1 flex items-center justify-between text-slate-500 mono">
                  <span className="uppercase text-[9px] tracking-wider">{d.status}</span>
                  <span className="text-slate-300">{d.speed} km/h</span>
                </div>
              </li>
            );

          })}
        </ul>
      </aside>

      <div className="relative overflow-hidden">
        <TabMap
          center={[18.5, 52.0]}
          zoom={5.3}
          markers={staticMarkers}
          animatedVehicles={animatedVehicles}
          showZoomControls
        />

        <div className="absolute bottom-4 left-4 w-[240px] rounded-lg border border-[rgba(76,77,207,0.35)] bg-[rgba(10,20,40,0.95)] backdrop-blur p-3 shadow-2xl z-10">
          <div className="flex items-center gap-2 pb-2 border-b border-[rgba(76,77,207,0.18)]">
            <div className="h-6 w-6 rounded flex items-center justify-center bg-[rgba(76,77,207,0.18)]">
              <Truck className="h-3.5 w-3.5 text-[#4c4dcf]" strokeWidth={1.75} />
            </div>
            <div>
              <div className="text-[11px] text-slate-100 font-medium">{selected.name}</div>
              <div
                className="mono text-[9px] uppercase tracking-wider"
                style={{ color: statusColor(selected.status) }}
              >
                {statusLabel}
              </div>
            </div>
          </div>
          <div className="grid grid-cols-3 gap-2 mt-2.5 mono text-[10px]">
            <div>
              <div className="text-slate-500 uppercase tracking-wider text-[8px]">Speed</div>
              <div className="text-slate-100 text-sm">{selected.speed} km/h</div>
            </div>
            <div>
              <div className="text-slate-500 uppercase tracking-wider text-[8px]">Fuel</div>
              <div className="text-slate-100 text-sm">{selected.fuel}%</div>
            </div>
            <div>
              <div className="text-slate-500 uppercase tracking-wider text-[8px]">Signal</div>
              <div className="text-slate-100 text-sm">{selected.signal}dBm</div>
            </div>
          </div>
          <div className="mono text-[9px] text-slate-500 mt-2 pt-2 border-t border-[rgba(76,77,207,0.15)]">
            {fmtCoord(selected.lat, "N", "S")} · {fmtCoord(selected.lng, "E", "W")} · updated 2s ago
          </div>
        </div>
      </div>
    </div>
  );
}



// ─────────────────────────────────────────────
// TRIPS
// ─────────────────────────────────────────────
interface Trip {
  start: string;
  asset: string;
  vin: string;
  route: string;
  distance: string;
  duration: string;
  status: "moving" | "completed";
  coords: [number, number][];
  stats: { avgSpeed: string; maxSpeed: string; idle: string; fuel: string; stops: string; harsh: string };
}

const TRIPS: Trip[] = [
  {
    start: "07:12", asset: "MB Sprinter", vin: "9F42", route: "Warsaw → Łódź",
    distance: "128 km", duration: "01:52", status: "moving",
    coords: [[21.012, 52.229], [20.5, 52.0], [20.0, 51.85], [19.457, 51.759]],
    stats: { avgSpeed: "54 km/h", maxSpeed: "88 km/h", idle: "14 min", fuel: "18.4 L", stops: "2", harsh: "1" },
  },
  {
    start: "09:44", asset: "MAN TGX", vin: "A312", route: "Berlin → Poznań",
    distance: "289 km", duration: "03:41", status: "completed",
    coords: [[13.405, 52.520], [14.5, 52.45], [15.5, 52.4], [16.926, 52.406]],
    stats: { avgSpeed: "78 km/h", maxSpeed: "104 km/h", idle: "22 min", fuel: "62.1 L", stops: "3", harsh: "0" },
  },
  {
    start: "11:08", asset: "VW Crafter", vin: "B871", route: "Vilnius → Kaunas",
    distance: "104 km", duration: "01:18", status: "completed",
    coords: [[25.279, 54.687], [24.7, 54.75], [24.2, 54.85], [23.900, 54.898]],
    stats: { avgSpeed: "68 km/h", maxSpeed: "92 km/h", idle: "8 min", fuel: "14.2 L", stops: "1", harsh: "0" },
  },
  {
    start: "13:20", asset: "Iveco Daily", vin: "C551", route: "Gdańsk → Toruń",
    distance: "170 km", duration: "02:12", status: "completed",
    coords: [[18.646, 54.352], [18.8, 53.7], [18.7, 53.2], [18.605, 53.013]],
    stats: { avgSpeed: "72 km/h", maxSpeed: "98 km/h", idle: "11 min", fuel: "22.8 L", stops: "2", harsh: "1" },
  },
  {
    start: "14:55", asset: "Volvo FH", vin: "D904", route: "Riga → Šiauliai",
    distance: "142 km", duration: "01:47", status: "completed",
    coords: [[24.106, 56.946], [23.7, 56.5], [23.4, 56.0], [23.316, 55.933]],
    stats: { avgSpeed: "80 km/h", maxSpeed: "102 km/h", idle: "6 min", fuel: "26.4 L", stops: "1", harsh: "0" },
  },
  {
    start: "16:30", asset: "Scania R", vin: "E217", route: "Prague → Brno",
    distance: "208 km", duration: "02:34", status: "moving",
    coords: [[14.421, 50.087], [15.2, 49.85], [16.0, 49.5], [16.607, 49.195]],
    stats: { avgSpeed: "82 km/h", maxSpeed: "108 km/h", idle: "9 min", fuel: "34.1 L", stops: "2", harsh: "2" },
  },
  {
    start: "18:12", asset: "Renault Master", vin: "F338", route: "Kraków → Katowice",
    distance: "82 km", duration: "01:04", status: "completed",
    coords: [[19.945, 50.064], [19.5, 50.15], [19.15, 50.22], [19.045, 50.259]],
    stats: { avgSpeed: "76 km/h", maxSpeed: "94 km/h", idle: "5 min", fuel: "11.6 L", stops: "1", harsh: "0" },
  },
  {
    start: "19:48", asset: "Ford Transit", vin: "G712", route: "Wrocław → Opole",
    distance: "96 km", duration: "01:22", status: "moving",
    coords: [[17.038, 51.107], [17.4, 50.95], [17.7, 50.8], [17.926, 50.675]],
    stats: { avgSpeed: "70 km/h", maxSpeed: "96 km/h", idle: "12 min", fuel: "13.1 L", stops: "1", harsh: "0" },
  },
];

function TripsPanel() {
  const [sel, setSel] = useState(1); // Berlin → Poznań preselected
  const trip = TRIPS[sel];
  const spark = [12, 18, 22, 30, 42, 48, 44, 50, 46, 58, 52, 60, 55, 62];

  // Fit map to trip bounds
  const lngs = trip.coords.map((c) => c[0]);
  const lats = trip.coords.map((c) => c[1]);
  const center: [number, number] = [
    (Math.min(...lngs) + Math.max(...lngs)) / 2,
    (Math.min(...lats) + Math.max(...lats)) / 2,
  ];
  const span = Math.max(Math.max(...lngs) - Math.min(...lngs), Math.max(...lats) - Math.min(...lats));
  const zoom = span > 3 ? 6 : span > 1.5 ? 7 : span > 0.7 ? 8 : 9;

  return (
    <div className="h-[440px] grid grid-rows-1 grid-cols-[1fr_260px] text-slate-200">
      <div className="flex flex-col min-h-0">
        <div className="grid grid-cols-[70px_140px_80px_1fr_90px_80px_100px] gap-3 px-5 py-2.5 border-b border-[#22304C] bg-[#0E1526] mono text-[10px] uppercase tracking-wider text-slate-400">
          <span>Start</span>
          <span>Asset</span>
          <span>VIN</span>
          <span>Route</span>
          <span className="text-right">Distance</span>
          <span className="text-right">Duration</span>
          <span className="text-right">Status</span>
        </div>
        <div className="flex-1 overflow-y-auto">
          {TRIPS.map((r, i) => (
            <button
              key={i}
              onClick={() => setSel(i)}
              className={`w-full text-left grid grid-cols-[70px_140px_80px_1fr_90px_80px_100px] gap-3 px-5 py-3 border-b border-[#1A2338] text-[11px] items-center transition-colors ${
                sel === i ? "bg-[#132043]" : i % 2 ? "bg-[#0E1526] hover:bg-[#12192D]" : "hover:bg-[#12192D]"
              }`}
            >
              <span className="mono text-[#B45309]">{r.start}</span>
              <span className="text-slate-100 truncate">{r.asset}</span>
              <span className="mono text-slate-400">{r.vin}</span>
              <span className="text-slate-300 truncate">{r.route}</span>
              <span className="mono text-slate-100 text-right">{r.distance}</span>
              <span className="mono text-slate-300 text-right">{r.duration}</span>
              <span className="text-right">
                <span
                  className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full mono text-[9px] uppercase tracking-wider ${
                    r.status === "moving"
                      ? "bg-[#10B981]/15 text-[#10B981]"
                      : "bg-slate-700/40 text-slate-400"
                  }`}
                >
                  ● {r.status}
                </span>
              </span>
            </button>
          ))}
        </div>
        {/* Playback timeline */}
        <div className="px-5 py-3 border-t border-[#22304C] bg-[#0E1526]">
          <div className="flex items-center justify-between mb-2 mono text-[10px] text-slate-400">
            <span>00:00</span>
            <span className="text-slate-200">Playback · {trip.start} · 1.0×</span>
            <span>23:59</span>
          </div>
          <div className="relative h-8">
            <svg viewBox="0 0 400 32" className="absolute inset-0 w-full h-full" preserveAspectRatio="none">
              <polyline
                points={spark.map((v, i) => `${(i * 400) / (spark.length - 1)},${32 - v * 0.45}`).join(" ")}
                fill="none"
                stroke="#3a3b8f"
                strokeWidth="1.5"
              />
              <polyline
                points={`0,32 ${spark.map((v, i) => `${(i * 400) / (spark.length - 1)},${32 - v * 0.45}`).join(" ")} 400,32`}
                fill="#3a3b8f"
                fillOpacity="0.12"
              />
            </svg>
            <div className="absolute top-0 bottom-0 w-px bg-[#B45309]" style={{ left: "42%" }}>
              <div className="absolute -top-1 -left-1 h-2 w-2 rounded-full bg-[#B45309]" />
            </div>
          </div>
        </div>
      </div>

      {/* Route preview */}
      <div className="border-l border-[#22304C] bg-[#0E1526] p-4 flex flex-col min-h-0">
        <div className="mono text-[10px] uppercase tracking-wider text-slate-400 mb-2">
          Route preview
        </div>
        <div className="rounded-lg overflow-hidden border border-[#22304C] bg-[#0B1020] h-[130px] shrink-0">
          <TabMap
            center={center}
            zoom={zoom}
            routes={[
              {
                id: `trip-${sel}`,
                coordinates: trip.coords,
                color: "#2563EB",
                width: 3,
              },
            ]}
            markers={[
              { lng: trip.coords[0][0], lat: trip.coords[0][1], label: "A", color: "#10B981" },
              { lng: trip.coords[trip.coords.length - 1][0], lat: trip.coords[trip.coords.length - 1][1], label: "B", color: "#B45309" },
            ]}
          />
        </div>
        <dl className="mt-3 space-y-1.5 text-[11px]">
          {[
            ["Avg speed", trip.stats.avgSpeed],
            ["Max speed", trip.stats.maxSpeed],
            ["Idle time", trip.stats.idle],
            ["Fuel used", trip.stats.fuel],
            ["Stops", trip.stats.stops],
            ["Harsh events", trip.stats.harsh],
          ].map(([k, v]) => (
            <div key={k} className="flex justify-between">
              <dt className="text-slate-400">{k}</dt>
              <dd className="mono text-slate-100">{v}</dd>
            </div>
          ))}
        </dl>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────
// GEOFENCES
// ─────────────────────────────────────────────
function GeoPanel() {
  const events = [
    { icon: ArrowUpRight, type: "geofence_exit", label: "Geofence exit · Depot WAW", time: "09:14", color: "#B45309" },
    { icon: CheckCircle2, type: "site_arrival", label: "Site arrival · A-12", time: "10:22", color: "#10B981" },
    { icon: AlertTriangle, type: "speed_violation", label: "Speed > 90 km/h · 9F42", time: "10:47", color: "#DC2626" },
    { icon: ArrowUpRight, type: "geofence_exit", label: "Geofence exit · Site A-12", time: "11:38", color: "#B45309" },
    { icon: CheckCircle2, type: "site_arrival", label: "Site arrival · Depot WAW", time: "12:55", color: "#10B981" },
    { icon: Clock, type: "idle", label: "Idle > 10min · B871", time: "13:22", color: "#64748B" },
  ];

  // Warsaw area — Depot as circle, Site A-12 as polygon
  const depot: [number, number] = [20.98, 52.23];
  const sitePoly: [number, number][] = [
    [21.09, 52.28],
    [21.14, 52.29],
    [21.16, 52.26],
    [21.14, 52.23],
    [21.10, 52.22],
    [21.08, 52.25],
    [21.09, 52.28],
  ];

  return (
    <div className="h-[440px] grid grid-rows-1 grid-cols-[1fr_260px] text-slate-200">
      <div className="relative overflow-hidden">
        <TabMap
          center={[21.06, 52.245]}
          zoom={11.2}
          circles={[
            { id: "geo-depot", center: depot, radiusMeters: 900, color: "#2563EB", label: "Depot · WAW" },
          ]}
          polygons={[
            { id: "geo-site", coordinates: sitePoly, color: "#10B981", label: "Site A-12" },
          ]}
          routes={[
            {
              id: "geo-trail",
              color: "#B45309",
              dashed: true,
              width: 3,
              coordinates: [
                [20.98, 52.23],
                [21.02, 52.245],
                [21.06, 52.255],
                [21.10, 52.26],
                [21.12, 52.265],
              ],
            },
          ]}
          markers={[
            { lng: 21.12, lat: 52.265, label: "9F42", color: "#B45309", highlighted: true },
          ]}
        />
        <div className="absolute bottom-4 left-4 flex gap-2 z-10">
          <span className="inline-flex items-center px-2.5 py-1 rounded-full mono text-[10px] uppercase tracking-wider border" style={{ background: "rgba(15,23,42,0.85)", borderColor: "#22304C", color: "#94A3B8" }}>
            <span className="inline-block h-2 w-2 rounded-full bg-[#2563EB] mr-1.5" />Depot
          </span>
          <span className="inline-flex items-center px-2.5 py-1 rounded-full mono text-[10px] uppercase tracking-wider border" style={{ background: "rgba(15,23,42,0.85)", borderColor: "#22304C", color: "#94A3B8" }}>
            <span className="inline-block h-2 w-2 rounded-full bg-[#10B981] mr-1.5" />Site zone
          </span>
        </div>
      </div>

      <div className="border-l border-[#22304C] bg-[#0E1526] flex flex-col">
        <div className="px-4 py-2.5 border-b border-[#22304C] flex items-center justify-between">
          <span className="mono text-[10px] uppercase tracking-wider text-slate-400">Events · today</span>
          <span className="mono text-[10px] text-slate-100">{events.length}</span>
        </div>
        <ul className="flex-1 overflow-y-auto">
          {events.map((e, i) => {
            const Icon = e.icon;
            return (
              <li key={i} className="px-4 py-3 border-b border-[#1A2338] hover:bg-[#132043] transition-colors">
                <div className="flex items-start gap-2.5">
                  <div
                    className="h-6 w-6 rounded flex items-center justify-center shrink-0 mt-0.5"
                    style={{ background: `${e.color}22` }}
                  >
                    <Icon className="h-3.5 w-3.5" strokeWidth={1.75} style={{ color: e.color }} />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="text-[11px] text-slate-100 leading-snug">{e.label}</div>
                    <div className="mono text-[9px] uppercase tracking-wider text-slate-500 mt-0.5">
                      {e.type} · {e.time}
                    </div>
                  </div>
                  <ChevronRight className="h-3.5 w-3.5 text-slate-600 shrink-0 mt-1" strokeWidth={1.75} />
                </div>
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────
// REPORTS
// ─────────────────────────────────────────────
function ReportsPanel() {
  const days = ["M", "T", "W", "T", "F", "S", "S", "M", "T", "W", "T", "F", "S", "S"];
  const values = [420, 640, 510, 780, 660, 880, 710, 920, 600, 740, 830, 680, 790, 910];
  const data = values.map((v, i) => ({ day: days[i], distance: v, idx: i }));
  const target = 750;

  return (
    <div className="h-[440px] p-5 text-slate-200 flex flex-col gap-4 min-h-0">
      <div className="grid grid-cols-3 gap-3 shrink-0">
        {[
          { l: "Distance · 30d", v: "24,812", u: "km", trend: "+12.4%", color: "#10B981" },
          { l: "Idle · 30d", v: "42:18", u: "h", trend: "-8.1%", color: "#10B981" },
          { l: "Geofence events", v: "1,204", u: "", trend: "+3.2%", color: "#B45309" },
        ].map((s, i) => (
          <div key={i} className="rounded-lg border border-[#22304C] bg-[#0F172A] p-3.5">
            <div className="mono text-[9px] uppercase tracking-wider text-slate-400">{s.l}</div>
            <div className="mt-1 flex items-baseline gap-1.5">
              <span className="mono text-2xl text-slate-100 font-medium">{s.v}</span>
              {s.u && <span className="mono text-[10px] text-slate-500">{s.u}</span>}
            </div>
            <div className="mono text-[10px] mt-1" style={{ color: s.color }}>
              ▲ {s.trend} vs prev
            </div>
          </div>
        ))}
      </div>

      <div className="flex-1 min-h-0 rounded-lg border border-[#22304C] bg-[#0F172A] p-4 flex flex-col">
        <div className="flex items-center justify-between shrink-0">
          <div>
            <div className="text-slate-100 text-sm font-medium">Distance per day</div>
            <div className="mono text-[10px] text-slate-400 uppercase tracking-wider">Last 14 days</div>
          </div>
          <div className="flex gap-3 text-[10px] mono uppercase tracking-wider">
            <span className="text-slate-400 inline-flex items-center">
              <span className="inline-block h-2 w-2 rounded-sm bg-[#2563EB] mr-1.5" />Distance
            </span>
            <span className="text-slate-500 inline-flex items-center">
              <span className="inline-block h-[2px] w-3 bg-[#B45309] mr-1.5" />Target
            </span>
          </div>
        </div>
        <div className="flex-1 min-h-0 mt-3">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={data} margin={{ top: 4, right: 8, left: -12, bottom: 0 }}>
              <defs>
                <linearGradient id="bar-grad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#3a3b8f" />
                  <stop offset="100%" stopColor="#2563EB" />
                </linearGradient>
              </defs>
              <CartesianGrid stroke="#16213A" vertical={false} />
              <XAxis
                dataKey="day"
                stroke="#64748B"
                tick={{ fontSize: 10, fontFamily: "JetBrains Mono, ui-monospace, monospace" }}
                axisLine={{ stroke: "#22304C" }}
                tickLine={false}
              />
              <YAxis
                stroke="#64748B"
                tick={{ fontSize: 10, fontFamily: "JetBrains Mono, ui-monospace, monospace" }}
                axisLine={{ stroke: "#22304C" }}
                tickLine={false}
                width={40}
              />
              <Tooltip
                cursor={{ fill: "#132043" }}
                contentStyle={{
                  background: "#0B1020",
                  border: "1px solid #22304C",
                  borderRadius: 6,
                  fontSize: 11,
                  color: "#E2E8F0",
                }}
                labelStyle={{ color: "#94A3B8" }}
                formatter={(v: number) => [`${v} km`, "Distance"]}
              />
              <ReferenceLine y={target} stroke="#B45309" strokeDasharray="4 4" strokeWidth={1} />
              <Bar dataKey="distance" fill="url(#bar-grad)" radius={[3, 3, 0, 0]} maxBarSize={28} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────
// COMMANDS
// ─────────────────────────────────────────────
function CommandsPanel() {
  const queue = [
    { id: "cmd_01H7…9K", type: "immobilize", device: "353173094", status: "delivered", time: "10:22:15Z", color: "#10B981" },
    { id: "cmd_01H7…4M", type: "request-position", device: "353173094", status: "delivered", time: "10:24:02Z", color: "#10B981" },
    { id: "cmd_01H7…7P", type: "unlock-door", device: "358921471", status: "queued", time: "10:25:41Z", color: "#B45309" },
    { id: "cmd_01H7…2R", type: "output-set", device: "358921471", status: "failed", time: "10:19:08Z", color: "#DC2626" },
    { id: "cmd_01H7…8T", type: "engine-cut", device: "352094811", status: "delivered", time: "10:15:37Z", color: "#10B981" },
  ];
  return (
    <div className="h-[440px] grid grid-rows-1 grid-cols-[1fr_320px] text-slate-200">
      <div className="p-5 mono text-[12px] leading-relaxed overflow-hidden bg-[#080D1A]">
        <div className="text-slate-500">
          <span className="text-[#7C5CFC]">$</span> orbetra cmd send{" "}
          <span className="text-[#3a3b8f]">--device</span>{" "}
          <span className="text-[#B45309]">353173094</span>{" "}
          <span className="text-[#3a3b8f]">--type</span>{" "}
          <span className="text-slate-100">immobilize</span>
        </div>
        <div className="text-[#10B981] mt-1">
          → queued · awaiting device ack · id=cmd_01H7…9K
        </div>

        <div className="text-slate-500 mt-4">
          <span className="text-[#7C5CFC]">$</span> orbetra cmd status{" "}
          <span className="text-[#3a3b8f]">--id</span>{" "}
          <span className="text-slate-100">cmd_01H7…9K</span>
        </div>
        <div className="text-[#10B981] mt-1">
          → delivered · device ack at 10:22:15Z · rtt=1.4s
        </div>

        <div className="text-slate-500 mt-4">
          <span className="text-[#7C5CFC]">$</span> orbetra cmd send{" "}
          <span className="text-[#3a3b8f]">--device</span>{" "}
          <span className="text-[#B45309]">353173094</span>{" "}
          <span className="text-[#3a3b8f]">--type</span>{" "}
          <span className="text-slate-100">request-position</span>
        </div>
        <div className="text-[#10B981] mt-1">
          → delivered · position=(52.229, 21.012) · at 10:24:02Z
        </div>

        <div className="text-slate-500 mt-4">
          <span className="text-[#7C5CFC]">$</span> orbetra cmd list{" "}
          <span className="text-[#3a3b8f]">--device</span>{" "}
          <span className="text-[#B45309]">353173094</span>{" "}
          <span className="text-[#3a3b8f]">--last</span>{" "}
          <span className="text-slate-100">24h</span>
        </div>
        <div className="text-slate-300 mt-1">
          3 delivered · 0 pending · 0 failed
        </div>

        <div className="text-slate-500 mt-4 flex items-center">
          <span className="text-[#7C5CFC]">$</span>
          <span className="ml-2 inline-block h-3.5 w-1.5 bg-slate-300 animate-pulse-dot" />
        </div>
      </div>

      <div className="border-l border-[#22304C] bg-[#0E1526] flex flex-col">
        <div className="px-4 py-2.5 border-b border-[#22304C] flex items-center justify-between">
          <span className="mono text-[10px] uppercase tracking-wider text-slate-400">Command queue</span>
          <span className="mono text-[10px] text-slate-100">{queue.length}</span>
        </div>
        <ul className="flex-1 overflow-y-auto">
          {queue.map((q, i) => (
            <li key={i} className="px-4 py-3 border-b border-[#1A2338] hover:bg-[#132043] transition-colors">
              <div className="flex items-center justify-between">
                <span className="text-[11px] text-slate-100 font-medium">{q.type}</span>
                <span
                  className="mono text-[9px] uppercase tracking-wider px-2 py-0.5 rounded-full"
                  style={{ background: `${q.color}22`, color: q.color }}
                >
                  ● {q.status}
                </span>
              </div>
              <div className="mono text-[9px] text-slate-500 mt-1 flex justify-between">
                <span>{q.id}</span>
                <span>{q.time}</span>
              </div>
              <div className="mono text-[9px] text-slate-400 mt-0.5">imei: {q.device}</div>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
