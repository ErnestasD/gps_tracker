import { createFileRoute } from "@tanstack/react-router";
import * as React from "react";
import { useTranslation } from "react-i18next";
import { generateDevices, type Device } from "@/lib/admin-mock";
import { LANGUAGES, type Lang } from "@/lib/i18n";
import { Badge, AdminInput, AdminButton } from "@/components/admin/AdminKit";
import { Combobox } from "@/components/admin/Combobox";
import { DemoMap, type DemoMapControls, type DemoRoute, type DemoVehicle, type DemoZone } from "@/components/admin/DemoMap";
import { cityFor, routeSlice, type DemoCity, type LngLat } from "@/lib/demo-geo";
import { demoZones } from "@/lib/demo-zones";
import { contentFor } from "@/lib/demo-content";
import { SheetGrip, useSheet } from "@/components/admin/SheetGrip";
import {
  PanelLeft, Pause, Layers, Maximize2, Satellite, Power, Clock, ChevronRight,
  Activity, Radio, Signal, Play, ZoomIn, ZoomOut, Crosshair, MapPin, LocateFixed, Route as RouteIcon,
  Gauge, X, Bell, Terminal, SlidersHorizontal, Shield,
} from "lucide-react";
import { fmtDateTime } from "@/lib/admin-format";
import { demoDetail, deviceName, localizeEvents } from "@/lib/demo-events";

export const Route = createFileRoute("/app/map")({
  component: MapPage,
});

/** Mirrors the REAL live map (apps/web app/map): status-chip header strip, fleet list with
 * per-row telemetry, dark map with heading arrows, right inspector rail with metric tiles +
 * tabs + POZICIJA/telemetry/trip blocks, and the playback timeline docked at the bottom. */

/** Bearing (deg from north) from a to b — flat-earth atan2 is fine at city scale. */
function bearingDeg(a: LngLat, b: LngLat): number {
  const deg = (Math.atan2((b[0] - a[0]) * Math.cos((a[1] * Math.PI) / 180), b[1] - a[1]) * 180) / Math.PI;
  return (deg + 360) % 360;
}

/** Deterministic on-road placement: mock lat/lng is ignored — every device sits on a real
 * street of VILNIUS_LOOP (first 16) or KAUNAS_LOOP, heading toward the next route point. */
type Placement = { at: LngLat; headingDeg: number; loop: LngLat[]; idx: number };

/**
 * Where the demo fleet is, decided by the interface language.
 *
 * It used to be Vilnius for everyone, so a Polish visitor reading a Polish interface watched vans
 * circle a city they have no stake in — which quietly says the product is for somebody else. The
 * loops are real routed road geometry per city, so a van is never in a field whichever one it is.
 */
function placementsFor(city: DemoCity, devices: Device[]): Map<string, Placement> {
  return new Map<string, Placement>(
    devices.map((d, i) => {
      const loop = city.loops[i < 16 ? 0 : 1];
      const idx = (i * 17) % loop.length;
      const at = loop[idx];
      return [d.id, { at, headingDeg: bearingDeg(at, loop[(idx + 1) % loop.length]), loop, idx }];
    }),
  );
}

/** Live-map overlay zones — drawn dashed, as on the real dashboard. */
/**
 * Zones follow the fleet.
 *
 * They were fixed Vilnius geometry, so moving the vans to Warsaw would have left the geofences
 * behind in Lithuania — vehicles in one country, their zones in another, which reads as a broken
 * product rather than a localised one. Anchoring them to points ON the active loop keeps a depot
 * where the fleet actually drives, in every city.
 */
/**
 * The live map draws the SAME zones the geofences page lists, dashed as the product draws them.
 *
 * It used to draw two anonymous circles of its own while the geofences page listed three
 * differently-named zones somewhere else entirely — so an alert naming a zone pointed at a map
 * where no such zone existed. See demo-zones.
 */
function zonesFor(lang: string): DemoZone[] {
  return demoZones(lang).map((z) => ({
    id: z.id,
    color: z.color,
    ring: z.ring,
    line: z.line,
    corridorWidthPx: z.corridorWidthPx,
    dashed: true,
  }));
}

const TRACK_PTS = 60;

/**
 * The inspector's panels, in the real dashboard's order and with its own keys.
 *
 * The demo carried four of them and none of the four did anything — clicking "Parameters" on the
 * page whose subject is a vehicle's telemetry left the overview on screen. Settings and Zones were
 * missing outright, so the demo showed a device panel two tabs shorter than the product's.
 */
const INSPECTOR_TABS = [
  { id: "overview", key: "map.inspector.overview", icon: Activity },
  { id: "params", key: "map.inspector.params", icon: Radio },
  { id: "events", key: "map.inspector.events", icon: Bell },
  { id: "commands", key: "map.inspector.commands", icon: Terminal },
  { id: "settings", key: "map.inspector.settings", icon: SlidersHorizontal },
  { id: "fences", key: "map.inspector.fences", icon: Shield },
] as const;

type InspectorTab = (typeof INSPECTOR_TABS)[number]["id"];

/** The map's own control buttons: zoom, fit the fleet, centre on the selected vehicle. */
const MAP_CONTROLS = [
  { key: "map.ctl.zoomIn", icon: ZoomIn, run: (c: DemoMapControls | null) => c?.zoomIn() },
  { key: "map.ctl.zoomOut", icon: ZoomOut, run: (c: DemoMapControls | null) => c?.zoomOut() },
  { key: "map.ctl.fitAll", icon: Crosshair, run: (c: DemoMapControls | null) => c?.fitAll() },
  {
    key: "map.ctl.centerSelected",
    icon: MapPin,
    run: (c: DemoMapControls | null, at?: LngLat) => {
      if (at !== undefined) c?.flyTo(at);
      else c?.fitAll();
    },
  },
] as const;

/** Severity colour for the ticker's dot — the product carries the kind in words too, never colour alone. */
function eventTone(kind: string): string {
  if (kind === "panic" || kind === "power_cut" || kind === "fuel_theft") return "var(--admin-danger)";
  if (kind === "overspeed" || kind === "low_battery" || kind === "device_offline") return "var(--admin-warning)";
  return "var(--admin-ink-soft)";
}

/** The layer switches, in the dashboard's own order. */
const LAYER_KEYS = ["geofences", "trails", "labels", "heat"] as const;
type LayerState = Record<(typeof LAYER_KEYS)[number], boolean>;

/** The last few commands sent to a device, as the commands console lists them. */
const DEVICE_COMMANDS = [
  { cmd: "getinfo", status: "acked", tone: "success" as const },
  { cmd: "getgps", status: "acked", tone: "success" as const },
  { cmd: "setparam 2004:0", status: "sent", tone: "warning" as const },
  { cmd: "cpureset", status: "queued", tone: "neutral" as const },
];

/** What the device is configured to do — the same rows the product's settings panel drives. */
const DEVICE_SETTINGS = [
  { key: "devices.settings.key.movingSendPeriod", value: "60 s" },
  { key: "devices.settings.key.movingByTime", value: "30 s" },
  { key: "devices.settings.key.movingByDistance", value: "200 m" },
  { key: "devices.settings.key.movingByAngle", value: "30°" },
  { key: "devices.settings.key.parkedSendPeriod", value: "600 s" },
  { key: "devices.settings.key.parkedByTime", value: "300 s" },
];

/** The 24 h axis, one label every three hours. */
const AXIS_HOURS = ["15:00", "18:00", "21:00", "00:00", "03:00", "06:00", "09:00", "12:00"];

/** Room one "15:00" needs including its gap — below this the labels print on top of each other. */
const AXIS_LABEL_PX = 46;

/** Demo status → product status key (product only knows online/stale/offline). */
const STATUS_KEY: Record<Device["status"], string> = {
  active: "status.online",
  idle: "status.online",
  offline: "status.stale",
  maintenance: "status.offline",
};

/** Demo-invented relative-time snapshots — not in the product's admin namespace. */
const L: Record<Lang, { ago5s: string; ago4m: string; ago2h: string; ago3d: string }> = {
  lt: { ago5s: "prieš 5 sekundes", ago4m: "prieš 4 minutes", ago2h: "prieš 2 valandas", ago3d: "prieš 3 dienas" },
  en: { ago5s: "5 seconds ago", ago4m: "4 minutes ago", ago2h: "2 hours ago", ago3d: "3 days ago" },
  pl: { ago5s: "5 sekund temu", ago4m: "4 minuty temu", ago2h: "2 godziny temu", ago3d: "3 dni temu" },
  de: { ago5s: "vor 5 Sekunden", ago4m: "vor 4 Minuten", ago2h: "vor 2 Stunden", ago3d: "vor 3 Tagen" },
};

function relAgo(d: Device, l: (typeof L)[Lang]): string {
  if (d.status === "active") return l.ago5s;
  if (d.status === "idle") return l.ago4m;
  if (d.status === "maintenance") return l.ago2h;
  return l.ago3d;
}

/** GSM bars, derived from the same seed as the satellite count so the panels agree. */
function gsmOf(d: Device): number {
  return 3 + (satsOf(d) % 3);
}

/**
 * What this tracker is reporting, in the product's own vocabulary.
 *
 * The promoted scalars first (the pipeline lifts these out of `attrs`), then a handful of AVL
 * elements — including two undocumented ids, because that is what a real device sends and the
 * panel's footnote explains exactly that case.
 */
function paramsOf(d: Device, t: (k: string) => string): { label: string; value: string }[] {
  return [
    { label: t("info.satellites"), value: String(satsOf(d)) },
    { label: t("info.ignition"), value: d.status === "active" ? t("info.on") : t("info.off") },
    { label: t("map.inspector.movement"), value: d.status === "active" ? t("info.on") : t("info.off") },
    { label: t("map.inspector.odometer"), value: `${(d.odometer / 1000).toFixed(2)} km` },
    { label: t("map.inspector.altitude"), value: `${96 + (satsOf(d) % 40)}` },
    { label: t("devices.health.gsm"), value: String(gsmOf(d)) },
    { label: t("devices.health.extV"), value: "12.7 V" },
    { label: t("devices.health.battV"), value: "4.01 V" },
    { label: t("fleet.fuel"), value: `${d.fuel}%` },
    { label: "AVL 21", value: String(gsmOf(d)) },
    { label: "AVL 200", value: "0" },
  ];
}

function satsOf(d: Device): number {
  return 8 + (d.imei.charCodeAt(d.imei.length - 1) % 7);
}

function MapPage() {
  const { t, i18n } = useTranslation("admin");
  // the dock is a static mock; the picker is real enough to open, which is what a demo needs
  const [demoDay, setDemoDay] = React.useState(0);
  const lang = (i18n.resolvedLanguage ?? "lt").slice(0, 2) as Lang;
  const l = L[LANGUAGES.includes(lang) ? lang : "lt"];
  // the fleet drives where the reader is — see cityFor()
  const city = cityFor(lang);
  // the crew travels with the fleet: drivers, plates and the towns they run between come from the
  // city's own pools, so a Warsaw map is not staffed by Lithuanians holding LT licences
  const ALL = React.useMemo(() => generateDevices(contentFor(lang)), [lang]);
  const PLACEMENTS = React.useMemo(() => placementsFor(city, ALL), [city, ALL]);
  const FIT_ALL = React.useMemo<LngLat[]>(() => ALL.map((d) => PLACEMENTS.get(d.id)!.at), [ALL, PLACEMENTS]);
  const ZONES = React.useMemo(() => zonesFor(lang), [lang]);

  /**
   * How many hour labels the track can actually hold.
   *
   * They sat at fixed 12.5 % steps, which is fine on a wide workspace and a smear the moment the
   * panel narrows — the founder's screenshot shows "15:0018:0021:0000:00…" run together. Measuring
   * lets the axis drop to every second or fourth label instead of overprinting.
   */
  const trackRef = React.useRef<HTMLDivElement | null>(null);
  const [trackWidth, setTrackWidth] = React.useState(0);
  React.useLayoutEffect(() => {
    const el = trackRef.current;
    if (el === null || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(([entry]) => setTrackWidth(entry?.contentRect.width ?? 0));
    ro.observe(el);
    setTrackWidth(el.getBoundingClientRect().width);
    return () => ro.disconnect();
  }, []);
  const labelEvery = React.useMemo(() => {
    if (trackWidth <= 0) return 1;
    const room = Math.max(1, Math.floor(trackWidth / AXIS_LABEL_PX));
    let every = 1;
    while (AXIS_HOURS.length / every > room) every *= 2;
    return every;
  }, [trackWidth]);
  const [q, setQ] = React.useState("");
  const [status, setStatus] = React.useState<string>("");
  const [selected, setSelected] = React.useState<string | null>(ALL[0]?.id ?? null);
  const [tab, setTab] = React.useState<InspectorTab>("overview");
  const [paramQ, setParamQ] = React.useState("");
  /** zones the operator has switched OFF — the fences panel drives the map, not just itself */
  const [hiddenFences, setHiddenFences] = React.useState<ReadonlySet<string>>(new Set());
  const [layersOpen, setLayersOpen] = React.useState(false);
  /** the layer switches the product's own menu carries — every one of them changes the map */
  const [layers, setLayers] = React.useState<LayerState>({ geofences: true, trails: true, labels: true, heat: false });
  const mapWrapRef = React.useRef<HTMLDivElement | null>(null);
  const mapControls = React.useRef<DemoMapControls | null>(null);
  /** the inspector sheet's height below xl — dragged, remembered, clamped to the map area */
  const bodyRef = React.useRef<HTMLDivElement | null>(null);
  const { sheet, container: sheetContainer, toggle: toggleSheet, gripProps } = useSheet(bodyRef, true);

  const toggleFence = React.useCallback((id: string) => {
    setHiddenFences((cur) => {
      const next = new Set(cur);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  /** Real fullscreen, not a mimed one — the button asks the browser, as the dashboard's does. */
  const toggleFullscreen = () => {
    const el = mapWrapRef.current;
    if (el === null) return;
    if (document.fullscreenElement === null) void el.requestFullscreen?.().catch(() => undefined);
    else void document.exitFullscreen?.().catch(() => undefined);
  };

  const filtered = ALL.filter(
    (d) =>
      (!q || `${d.name} ${d.plate} ${d.driver}`.toLowerCase().includes(q.toLowerCase())) &&
      (!status || d.status === status),
  );
  const active = filtered.find((d) => d.id === selected) ?? null;

  /** Zone id → the name the geofences page and the alerts use, so no panel invents its own. */
  const zoneNames = React.useMemo(
    () => Object.fromEntries(demoZones(lang).map((z) => [z.id, z.name])) as Record<string, string>,
    [lang],
  );
  /** This device's events, from the one shared feed the events page and the bell read. */
  const deviceEvents = React.useMemo(() => {
    if (active === null) return [];
    const all = localizeEvents(lang);
    // the feed carries four device ids of its own; map this vehicle onto one deterministically so
    // every vehicle has a plausible history rather than three of them having none
    const key = `dev_${(ALL.findIndex((d) => d.id === active.id) % 4) + 1}`;
    return all.filter((e) => e.deviceId === key).slice(0, 6);
  }, [active, lang, ALL]);
  /** The whole fleet's latest events — the ticker, mirroring the dashboard's live feed. */
  const feed = React.useMemo(() => localizeEvents(lang).slice(0, 8), [lang]);
  const coordsOf = (id: string): string => {
    const at = PLACEMENTS.get(id)?.at;
    return at === undefined ? "—" : `${at[1].toFixed(5)}, ${at[0].toFixed(5)}`;
  };

  const vehicles: DemoVehicle[] = filtered.map((d) => {
    const p = PLACEMENTS.get(d.id)!;
    const on = d.status === "active" || d.status === "idle";
    return {
      id: d.id,
      at: p.at,
      headingDeg: p.headingDeg,
      color: on ? "#7C7DF5" : d.status === "offline" ? "#8A93A6" : "#B9C0D0",
      selected: d.id === active?.id,
      label: layers.labels ? d.name : undefined,
    };
  });

  // the selected vehicle's 24h track — the orange history line, ending at its position
  const trackRoutes: DemoRoute[] = React.useMemo(() => {
    if (!active) return [];
    const p = PLACEMENTS.get(active.id)!;
    const start = (((p.idx - (TRACK_PTS - 1)) % p.loop.length) + p.loop.length) % p.loop.length;
    return [{ id: `track:${active.id}`, coords: routeSlice(p.loop, start, TRACK_PTS), color: "#F2A93B", widthPx: 2.5 }];
  }, [active]);

  const online = ALL.filter((d) => d.status === "active" || d.status === "idle").length;
  const offline = ALL.filter((d) => d.status === "offline").length;
  const unreachable = ALL.filter((d) => d.status === "maintenance").length;

  return (
    <div className="flex h-[calc(100vh-3.5rem)] flex-col">
      {/* header strip — live status chips, exactly the real page's furniture */}
      <div className="admin-hairline-b flex flex-wrap items-center gap-2 px-4 py-2.5 md:px-6">
        <PanelLeft className="h-4 w-4" style={{ color: "var(--admin-ink-soft)" }} />
        <span className="text-sm font-semibold" style={{ color: "var(--admin-ink)" }}>{t("map.title")}</span>
        <Badge tone="success">{t("map.live")}</Badge>
        <StatusChip color="var(--admin-success)" label={`${online} ${t("deviceList.filter.online")}`} />
        <StatusChip color="var(--admin-warning)" label={`${offline} ${t("deviceList.filter.stale")}`} />
        <StatusChip color="var(--admin-ink-soft)" label={`${unreachable} ${t("deviceList.filter.offline")}`} />
        <StatusChip color="var(--admin-ink-soft)" label={`0 ${t("deviceList.filter.silent")}`} />
        <div className="flex-1" />
        <AdminButton variant="secondary" size="sm"><Pause className="h-3.5 w-3.5" /> {t("map.pause")}</AdminButton>
        <div className="relative">
          <AdminButton variant={layersOpen ? "primary" : "secondary"} size="sm" onClick={() => setLayersOpen((v) => !v)}>
            <Layers className="h-3.5 w-3.5" /> {t("map.layers.title")}
          </AdminButton>
          {layersOpen && (
            <LayersMenu
              layers={layers}
              onChange={setLayers}
              zones={ZONES}
              zoneNames={zoneNames}
              hidden={hiddenFences}
              onToggleZone={toggleFence}
              onClose={() => setLayersOpen(false)}
            />
          )}
        </div>
        <AdminButton variant="secondary" size="sm" aria-label={t("map.fullscreen")} onClick={toggleFullscreen}>
          <Maximize2 className="h-3.5 w-3.5" />
        </AdminButton>
      </div>

      <div ref={bodyRef} className="relative flex min-h-0 flex-1">
        {/* fleet list */}
        <aside className="admin-hairline-r flex w-[21rem] shrink-0 flex-col" style={{ background: "var(--admin-surface)" }}>
          <div className="space-y-2 p-3">
            <AdminInput placeholder={t("deviceList.search")} value={q} onChange={(e) => setQ(e.target.value)} />
            <div className="flex items-center gap-3 text-xs" style={{ color: "var(--admin-ink-soft)" }}>
              <span>{t("deviceList.count", { shown: filtered.length, total: ALL.length })}</span>
              <label className="flex items-center gap-1.5">
                <input type="checkbox" className="h-3.5 w-3.5" /> {t("info.follow")}
              </label>
              <div className="ml-auto w-36">
                <Combobox
                  value={status}
                  onChange={setStatus}
                  options={[
                    { value: "", label: t("deviceList.sort.status") },
                    { value: "active", label: t("deviceList.filter.online") },
                    { value: "offline", label: t("deviceList.filter.stale") },
                    { value: "maintenance", label: t("deviceList.filter.offline") },
                  ]}
                  placeholder={t("deviceList.sort.status")}
                />
              </div>
            </div>
          </div>
          <ul className="min-h-0 flex-1 overflow-y-auto">
            {filtered.map((d) => {
              const isSel = d.id === active?.id;
              const on = d.status === "active" || d.status === "idle";
              return (
                <li key={d.id}>
                  <button
                    onClick={() => setSelected(d.id)}
                    className="w-full cursor-pointer px-3 py-2.5 text-left transition-colors admin-hairline-b"
                    style={{
                      background: isSel ? "var(--admin-brand-soft)" : "transparent",
                      boxShadow: isSel ? "inset 2px 0 0 var(--admin-brand)" : undefined,
                    }}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex min-w-0 items-center gap-2">
                        <StatusDot status={d.status} />
                        <span className="truncate text-sm font-medium" style={{ color: "var(--admin-ink)" }}>
                          {d.name} ({d.plate})
                        </span>
                      </div>
                      <ChevronRight className="h-4 w-4 shrink-0" style={{ color: "var(--admin-ink-soft)" }} />
                    </div>
                    <div className="mt-0.5 pl-4 text-xs" style={{ color: "var(--admin-ink-soft)" }}>{d.plate}</div>
                    <div className="mt-1 flex items-center gap-3 pl-4 text-[11px]" style={{ color: "var(--admin-ink-soft)" }}>
                      <span className="inline-flex items-center gap-1"><Activity className="h-3 w-3" /> {on ? d.speed : 0} {t("units.kmh")}</span>
                      <span className="inline-flex items-center gap-1"><Clock className="h-3 w-3" /> {relAgo(d, l)}</span>
                      <span className="inline-flex items-center gap-1"><Satellite className="h-3 w-3" /> {satsOf(d)}</span>
                      <Power className="h-3 w-3" style={{ color: on ? "var(--admin-success)" : "var(--admin-ink-soft)" }} />
                    </div>
                  </button>
                </li>
              );
            })}
          </ul>
        </aside>

        {/* map */}
        <div ref={mapWrapRef} className="relative min-w-0 flex-1 overflow-hidden">
          <DemoMap
            className="h-full w-full"
            zones={layers.geofences ? ZONES.filter((z) => !hiddenFences.has(z.id)) : []}
            routes={layers.trails ? trackRoutes : []}
            vehicles={vehicles}
            heat={layers.heat ? vehicles.map((v) => v.at) : []}
            fit={FIT_ALL}
            fitPadding={80}
            onVehicleClick={setSelected}
            controlsRef={mapControls}
          />
          <div className="absolute right-3 top-3 flex flex-col gap-1.5">
            {/* zoom, fit-the-fleet, centre-on-selection — the four verbs the product's own map
                buttons perform. They were handler-less `<button>`s: the first control anyone tries
                on a map, doing nothing. */}
            {MAP_CONTROLS.map(({ icon: Icon, key, run }) => (
              <button
                key={key}
                type="button"
                aria-label={t(key)}
                onClick={() => run(mapControls.current, active === null ? undefined : PLACEMENTS.get(active.id)?.at)}
                className="grid h-8 w-8 cursor-pointer place-items-center rounded-md border backdrop-blur transition-colors hover:bg-[var(--admin-hairline)]"
                style={{ borderColor: "var(--admin-hairline)", background: "color-mix(in oklab, var(--admin-surface) 90%, transparent)", color: "var(--admin-ink)" }}
              >
                <Icon className="h-4 w-4" />
              </button>
            ))}
          </div>
          <div
            className="absolute bottom-3 left-3 flex items-center gap-3 rounded-md border px-3 py-1.5 text-[11px] backdrop-blur"
            style={{ borderColor: "var(--admin-hairline)", background: "color-mix(in oklab, var(--admin-surface) 88%, transparent)", color: "var(--admin-ink-soft)" }}
          >
            <span className="inline-flex items-center gap-1.5"><Dot c="#7C7DF5" /> {t("status.online")}</span>
            <span className="inline-flex items-center gap-1.5"><Dot c="#8A93A6" /> {t("status.stale")}</span>
            <span className="inline-flex items-center gap-1.5"><Dot c="#B9C0D0" /> {t("status.offline")}</span>
          </div>

          {/* The event ticker the real map carries bottom-right, on the same 2xl breakpoint: on a
              narrower screen it would sit on top of the legend and the map controls. Reads the one
              shared feed, so it can never name an event the events page does not have. */}
          <div
            className="admin-card absolute bottom-3 right-3 hidden w-72 overflow-hidden 2xl:block"
            style={{ background: "color-mix(in oklab, var(--admin-surface) 92%, transparent)" }}
            data-testid="event-ticker"
          >
            <div className="admin-hairline-b flex items-center gap-2 px-3 py-1.5">
              <Bell className="h-3.5 w-3.5" style={{ color: "var(--admin-ink-soft)" }} aria-hidden />
              <span className="text-[11px] font-medium" style={{ color: "var(--admin-ink)" }}>{t("map.eventFeed")}</span>
            </div>
            <ul className="max-h-48 overflow-y-auto">
              {feed.map((e) => (
                <li key={e.id} className="admin-hairline-b px-3 py-1.5 text-[11px] last:border-b-0">
                  <div className="flex items-center gap-1.5">
                    <span className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: eventTone(e.kind) }} aria-hidden />
                    <span className="min-w-0 flex-1 truncate font-medium" style={{ color: "var(--admin-ink)" }}>{deviceName(e.deviceId)}</span>
                    <span className="mono shrink-0" style={{ color: "var(--admin-ink-soft)" }}>{fmtDateTime(e.at)}</span>
                  </div>
                  <div className="line-clamp-2 pl-3" style={{ color: "var(--admin-ink-soft)" }}>
                    <span style={{ color: "var(--admin-ink)" }}>{t(`events.k.${e.kind}`)}</span> · {demoDetail(t, e)}
                  </div>
                </li>
              ))}
            </ul>
          </div>
        </div>

        {/*
          * The inspector: a RAIL from xl, a BOTTOM SHEET below it.
          *
          * It used to be `hidden xl:flex` — so on any screen under 1280 px you could pick a vehicle
          * and nothing appeared. The real dashboard hit this exact bug and fixed it the same way;
          * its own comment says docking at lg squeezes the map column to ~164 px, which is why the
          * sheet, not an earlier breakpoint, is the answer.
          */}
        {active && (
          <aside
            /* The height below xl is the reader's — a fixed 60 % covers most of a 1024–1279 px
               laptop, so reading a vehicle's parameters hid the vehicle. It rides a CSS VARIABLE
               rather than an inline `height`: an inline height beats every class, so `xl:h-auto`
               could not undo it and the desktop rail would inherit the sheet's pixels. */
            className="absolute inset-x-0 bottom-0 z-20 flex h-[var(--sheet-h,60%)] flex-col overflow-hidden border-t xl:static xl:inset-auto xl:z-auto xl:h-auto xl:w-[23rem] xl:shrink-0 xl:border-l xl:border-t-0"
            style={{
              background: "var(--admin-surface)",
              borderColor: "var(--admin-hairline)",
              ...(sheet.heightPx > 0 ? ({ "--sheet-h": `${sheet.heightPx}px` } as React.CSSProperties) : {}),
            }}
            data-sheet-peek={sheet.peek ? "true" : "false"}
            data-testid="inspector-rail"
          >
            <SheetGrip sheet={sheet} container={sheetContainer} gripProps={gripProps} onToggle={toggleSheet} />
            <div className="min-h-0 flex-1 overflow-y-auto p-4">
              <div className="flex items-center justify-between gap-2">
                <div className="flex min-w-0 items-center gap-2">
                  <StatusDot status={active.status} />
                  <span className="truncate font-semibold" style={{ color: "var(--admin-ink)" }}>{active.name} ({active.plate})</span>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <Badge tone={active.status === "offline" ? "neutral" : "success"}>{t(STATUS_KEY[active.status])}</Badge>
                  <button
                    type="button"
                    onClick={() => setSelected(null)}
                    aria-label={t("info.close")}
                    className="grid h-7 w-7 place-items-center rounded-md transition-colors hover:bg-[var(--admin-hairline)]"
                    style={{ color: "var(--admin-ink-soft)" }}
                  >
                    <X className="h-3.5 w-3.5" aria-hidden />
                  </button>
                </div>
              </div>
              <div className="mono mt-1 text-[11px]" style={{ color: "var(--admin-ink-soft)" }}>
                {active.plate} · IMEI {active.imei}
              </div>

              <div className="mt-3 grid grid-cols-4 gap-1.5">
                <MetricTile icon={Activity} value={`${active.status === "active" ? active.speed : 0} km/h`} label={t("info.speed").toUpperCase()} />
                <MetricTile icon={Satellite} value={String(satsOf(active))} label={t("info.satellites").toUpperCase()} />
                <MetricTile icon={Gauge} value={`${(active.odometer / 1000).toFixed(1)} km`} label={t("map.inspector.odometer").toUpperCase()} />
                <MetricTile icon={Signal} value={String(gsmOf(active))} label={t("devices.health.gsm").toUpperCase()} />
              </div>

              {/* Six tabs, and each one now RENDERS something. They were four decorative buttons:
                  clicking "Parameters" on the page whose subject is a vehicle's telemetry left the
                  same overview on screen, so the demo said the product has no parameters view. */}
              {/* the product's own strip: icon + label, compact, scrolled rather than wrapped —
                  six labels do not fit a 23rem rail in any of the four languages, and the real
                  dashboard solved that the same way (with the scrollbar hidden) */}
              <div className="admin-hairline-b scroll-strip mt-3 flex shrink-0 gap-1 overflow-x-auto" role="tablist" aria-label={t("map.inspector.tabs")}>
                {INSPECTOR_TABS.map(({ id, key, icon: TabIcon }) => (
                  <button
                    key={id}
                    role="tab"
                    aria-selected={tab === id}
                    onClick={() => setTab(id)}
                    className="flex shrink-0 cursor-pointer items-center gap-1.5 whitespace-nowrap px-2.5 py-1.5 text-xs font-medium transition-colors"
                    style={{
                      color: tab === id ? "var(--admin-brand)" : "var(--admin-ink-soft)",
                      boxShadow: tab === id ? "inset 0 -2px 0 var(--admin-brand)" : undefined,
                    }}
                  >
                    <TabIcon className="h-3.5 w-3.5" aria-hidden />
                    {t(key)}
                  </button>
                ))}
              </div>

              {tab === "overview" && (
                <>
                  <div className="admin-card mt-3 p-3">
                    <div className="text-[11px] font-semibold uppercase tracking-wider" style={{ color: "var(--admin-ink)" }}>{t("map.inspector.position")}</div>
                    <div className="mt-2 grid grid-cols-2 gap-x-4 gap-y-2 text-xs">
                      {/* the PLACEMENT's coordinates, not the mock's own: the mock still carries the
                          Lithuanian lat/lng it was generated with, so after the fleet moved to Warsaw
                          the inspector read 54.36, 23.83 beside a map of Poland */}
                      <KV k={t("map.inspector.coords").toUpperCase()} v={coordsOf(active.id)} mono />
                      <KV k={t("map.inspector.lastPacket").toUpperCase()} v="2026-09-01 13:51" mono />
                      <KV k={t("map.inspector.heading").toUpperCase()} v={`${Math.round(PLACEMENTS.get(active.id)?.headingDeg ?? 0)}°`} />
                      <KV k={t("info.ignition").toUpperCase()} v={active.status === "active" ? t("info.on") : t("info.off")} />
                    </div>
                    <div className="mt-2 text-[11px]" style={{ color: "var(--admin-ink-soft)" }}>{relAgo(active, l)}</div>
                  </div>

                  <div className="admin-card mt-3 p-3">
                    <div className="text-[11px] font-semibold uppercase tracking-wider" style={{ color: "var(--admin-ink)" }}>
                      <Radio className="mr-1 inline h-3.5 w-3.5" /> {t("map.inspector.telemetry")}
                    </div>
                    <TelemetryBar label={t("devices.health.gsm")} value={String(gsmOf(active))} pct={(gsmOf(active) / 5) * 100} />
                    <div className="mt-2 flex items-center justify-between text-xs">
                      <span style={{ color: "var(--admin-ink-soft)" }}>{t("devices.health.extV")}</span>
                      <span className="mono font-medium" style={{ color: "var(--admin-ink)" }}>12.7 V</span>
                    </div>
                    <div className="mt-1.5 flex items-center justify-between text-xs">
                      <span style={{ color: "var(--admin-ink-soft)" }}>{t("fleet.fuel")}</span>
                      <span className="mono font-medium" style={{ color: "var(--admin-ink)" }}>{active.fuel}%</span>
                    </div>
                  </div>

                  <div className="admin-card mt-3 p-3">
                    <div className="text-[11px] font-semibold uppercase tracking-wider" style={{ color: "var(--admin-ink)" }}>
                      <RouteIcon className="mr-1 inline h-3.5 w-3.5" /> {t("map.inspector.recentTrips")}
                    </div>
                    <ul className="mt-2 space-y-1.5 text-xs">
                      {[["2026-09-01 12:50", "8.4 km"], ["2026-09-01 08:02", "1.7 km"], ["2026-08-31 20:50", "1.6 km"], ["2026-08-31 08:00", "1.7 km"]].map(([ts, km]) => (
                        <li key={ts} className="flex items-center justify-between">
                          <span className="mono" style={{ color: "var(--admin-ink-soft)" }}>{ts}</span>
                          <span className="mono font-medium" style={{ color: "var(--admin-ink)" }}>{km}</span>
                        </li>
                      ))}
                    </ul>
                  </div>

                  <div className="mt-3 flex gap-2">
                    <AdminButton variant="secondary" size="sm"><LocateFixed className="h-3.5 w-3.5" /> {t("info.follow")}</AdminButton>
                    <AdminButton variant="secondary" size="sm"><RouteIcon className="h-3.5 w-3.5" /> {t("info.trail")}</AdminButton>
                  </div>
                </>
              )}

              {tab === "params" && (
                <div className="mt-3">
                  <p className="text-[11px]" style={{ color: "var(--admin-ink-soft)" }}>
                    {t("map.inspector.paramsAt", { when: "2026-09-01 13:51" })}
                  </p>
                  <AdminInput
                    className="mt-2"
                    placeholder={t("map.inspector.paramsSearch")}
                    value={paramQ}
                    onChange={(e) => setParamQ(e.target.value)}
                    aria-label={t("map.inspector.paramsSearch")}
                  />
                  <ul className="admin-card mt-2 divide-y" style={{ borderColor: "var(--admin-hairline)" }}>
                    {paramsOf(active, t).filter((r) => paramQ.trim() === "" || r.label.toLowerCase().includes(paramQ.trim().toLowerCase())).map((r) => (
                      <li key={r.label} className="flex items-center justify-between gap-3 px-3 py-1.5 text-xs" style={{ borderColor: "var(--admin-hairline)" }}>
                        <span className="min-w-0 truncate" style={{ color: "var(--admin-ink-soft)" }}>{r.label}</span>
                        <span className="mono shrink-0 font-medium" style={{ color: "var(--admin-ink)" }}>{r.value}</span>
                      </li>
                    ))}
                  </ul>
                  <p className="mt-2 text-[11px]" style={{ color: "var(--admin-ink-soft)" }}>{t("map.inspector.paramsUndocumented")}</p>
                </div>
              )}

              {tab === "events" && (
                <div className="mt-3 space-y-1.5">
                  {deviceEvents.length === 0 ? (
                    <p className="py-6 text-center text-xs" style={{ color: "var(--admin-ink-soft)" }}>{t("map.inspector.noEvents")}</p>
                  ) : (
                    deviceEvents.map((e) => (
                      <div key={e.id} className="admin-card p-2.5 text-xs">
                        <div className="flex items-center justify-between gap-2">
                          <span className="font-medium" style={{ color: "var(--admin-ink)" }}>{t(`events.k.${e.kind}`)}</span>
                          <span className="mono shrink-0 text-[11px]" style={{ color: "var(--admin-ink-soft)" }}>{fmtDateTime(e.at)}</span>
                        </div>
                        <div className="mt-0.5" style={{ color: "var(--admin-ink-soft)" }}>{demoDetail(t, e)}</div>
                      </div>
                    ))
                  )}
                </div>
              )}

              {tab === "commands" && (
                <div className="mt-3 space-y-1.5">
                  {DEVICE_COMMANDS.map((c) => (
                    <div key={c.cmd} className="admin-card flex items-center justify-between gap-2 p-2.5 text-xs">
                      <span className="mono min-w-0 truncate" style={{ color: "var(--admin-ink)" }}>{c.cmd}</span>
                      <Badge tone={c.tone}>{t(`devices.cmd.st.${c.status}`)}</Badge>
                    </div>
                  ))}
                </div>
              )}

              {tab === "settings" && (
                <div className="admin-card mt-3 divide-y p-0" style={{ borderColor: "var(--admin-hairline)" }}>
                  {DEVICE_SETTINGS.map((row) => (
                    <div key={row.key} className="flex items-center justify-between gap-3 px-3 py-2 text-xs" style={{ borderColor: "var(--admin-hairline)" }}>
                      <span className="min-w-0" style={{ color: "var(--admin-ink-soft)" }}>{t(row.key)}</span>
                      <span className="mono shrink-0 font-medium" style={{ color: "var(--admin-ink)" }}>{row.value}</span>
                    </div>
                  ))}
                </div>
              )}

              {tab === "fences" && (
                <div className="mt-3 space-y-2">
                  <p className="text-[11px]" style={{ color: "var(--admin-ink-soft)" }}>{t("map.inspector.fencesHint")}</p>
                  {ZONES.map((z) => (
                    <label key={z.id} className="admin-card flex cursor-pointer items-center gap-2 p-2.5 text-xs">
                      <input
                        type="checkbox"
                        checked={hiddenFences.has(z.id) === false}
                        onChange={() => toggleFence(z.id)}
                        className="h-3.5 w-3.5"
                        style={{ accentColor: "var(--admin-brand)" }}
                      />
                      <span className="h-2.5 w-2.5 shrink-0 rounded-sm" style={{ background: z.color }} aria-hidden />
                      <span className="min-w-0 flex-1 truncate" style={{ color: "var(--admin-ink)" }}>{zoneNames[z.id] ?? z.id}</span>
                    </label>
                  ))}
                </div>
              )}
            </div>
          </aside>
        )}
      </div>

      {/* playback timeline — the real page's bottom dock */}
      <div className="admin-hairline-t flex flex-wrap items-center gap-x-3 gap-y-2 px-4 py-2 md:flex-nowrap md:px-6" style={{ background: "var(--admin-surface)" }}>
        <AdminButton variant="secondary" size="sm" aria-label={t("playback.play")}><Play className="h-3.5 w-3.5" /></AdminButton>
        <span className="mono rounded border px-1.5 py-0.5 text-[11px]" style={{ borderColor: "var(--admin-hairline)", color: "var(--admin-ink-soft)" }}>60×</span>
        <div ref={trackRef} className="relative h-8 min-w-0 flex-1">
          <div className="absolute inset-x-0 top-1/2 h-px" style={{ background: "var(--admin-hairline)" }} />
          {AXIS_HOURS.filter((_, i) => i % labelEvery === 0).map((h) => (
            <span
              key={h}
              className="mono absolute top-1/2 mt-1.5 -translate-x-1/2 text-[10px]"
              style={{ left: `${6 + AXIS_HOURS.indexOf(h) * 12.5}%`, color: "var(--admin-ink-soft)" }}
            >
              {h}
            </span>
          ))}
          {[34, 58, 91].map((x) => (
            <span key={x} className="absolute top-1/2 h-3 w-0.5 -translate-y-1/2" style={{ left: `${x}%`, background: "var(--admin-danger)" }} />
          ))}
          <span className="absolute top-1/2 h-4 w-1 -translate-y-1/2 rounded" style={{ left: "96%", background: "var(--admin-brand)" }} />
        </div>
        {/* Day picker — the demo's answer to the first question anyone asks of a tracking product:
            "can I go back and see where it was on Tuesday". The dock mirrored the real page's zoom
            and quick-jumps but not this, so the demo showed a product that could only look at now. */}
        <Combobox
          value={String(demoDay)}
          onChange={(v) => setDemoDay(Number(v))}
          width={150}
          aria-label={t("map.timeline.day.label")}
          options={Array.from({ length: 8 }, (_, back) => ({
            value: String(back),
            label: back === 0 ? t("map.timeline.day.today") : new Date(Date.now() - back * 86_400_000).toLocaleDateString(i18n.language, { month: "short", day: "numeric" }),
          }))}
        />
        <span className="mono hidden text-[11px] lg:inline" style={{ color: "var(--admin-ink-soft)" }}>{t("map.timeline.span", { hours: 24 })}</span>
        {/* the quick jumps go below md, as they do on the real dock — four more chips is the
            difference between a tidy row and one that eats the track they scrub */}
        <div className="hidden shrink-0 items-center gap-3 md:flex">
          {[24, 12, 6, 1].map((h) => (
            <button key={h} className="mono cursor-pointer text-[11px]" style={{ color: "var(--admin-ink-soft)" }}>{t("map.timeline.quick.hours", { hours: h })}</button>
          ))}
        </div>
        <span className="mono rounded px-2 py-0.5 text-[11px] font-semibold" style={{ background: "var(--admin-brand)", color: "#fff" }}>{t("map.timeline.now")}</span>
      </div>
    </div>
  );
}

/**
 * The layers menu, which the button used to promise and not open.
 *
 * Every switch here changes the map — zones, trails and device labels come off, the density layer
 * comes on — and the zone list underneath is the same set the geofences page lists. A menu whose
 * checkboxes did nothing would be a more elaborate version of the bug it replaced.
 */
function LayersMenu({
  layers,
  onChange,
  zones,
  zoneNames,
  hidden,
  onToggleZone,
  onClose,
}: {
  layers: LayerState;
  onChange: (v: LayerState) => void;
  zones: DemoZone[];
  zoneNames: Record<string, string>;
  hidden: ReadonlySet<string>;
  onToggleZone: (id: string) => void;
  onClose: () => void;
}) {
  const { t } = useTranslation("admin");
  return (
    <>
      <div className="fixed inset-0 z-30" onClick={onClose} aria-hidden />
      <div
        className="admin-card absolute right-0 top-10 z-40 w-64 p-3"
        role="dialog"
        aria-label={t("map.layers.title")}
        style={{ boxShadow: "var(--admin-shadow-lg)" }}
      >
        <div className="mb-2 flex items-center justify-between">
          <span className="text-xs font-semibold" style={{ color: "var(--admin-ink)" }}>{t("map.layers.title")}</span>
          <button type="button" onClick={onClose} aria-label={t("info.close")} style={{ color: "var(--admin-ink-soft)" }}>
            <X className="h-3.5 w-3.5" aria-hidden />
          </button>
        </div>
        <div className="space-y-2">
          {LAYER_KEYS.map((key) => (
            <label key={key} className="flex cursor-pointer items-center justify-between gap-2 text-xs" style={{ color: "var(--admin-ink)" }}>
              <span>{t(`map.layers.${key}`)}</span>
              <input
                type="checkbox"
                checked={layers[key]}
                onChange={() => onChange({ ...layers, [key]: !layers[key] })}
                className="h-3.5 w-3.5"
                style={{ accentColor: "var(--admin-brand)" }}
              />
            </label>
          ))}
        </div>
        {zones.length > 0 && (
          <div className="admin-hairline-t mt-3 pt-2">
            <div className="mb-1.5 text-[11px] font-medium" style={{ color: "var(--admin-ink-soft)" }}>{t("map.layers.fenceVisibility")}</div>
            <div className="max-h-40 space-y-1.5 overflow-y-auto">
              {zones.map((z) => (
                <label key={z.id} className="flex cursor-pointer items-center gap-2 text-xs" style={{ color: "var(--admin-ink)" }}>
                  <input
                    type="checkbox"
                    checked={!hidden.has(z.id)}
                    onChange={() => onToggleZone(z.id)}
                    className="h-3.5 w-3.5"
                    style={{ accentColor: "var(--admin-brand)" }}
                  />
                  <span className="h-2 w-2 shrink-0 rounded-sm" style={{ background: z.color }} aria-hidden />
                  <span className="truncate">{zoneNames[z.id] ?? z.id}</span>
                </label>
              ))}
            </div>
          </div>
        )}
      </div>
    </>
  );
}

function StatusChip({ color, label }: { color: string; label: string }) {
  return (
    <span
      className="inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs"
      style={{ borderColor: "var(--admin-hairline)", color: "var(--admin-ink-soft)" }}
    >
      <span className="h-1.5 w-1.5 rounded-full" style={{ background: color }} />
      {label}
    </span>
  );
}

function Dot({ c }: { c: string }) {
  return <span className="h-1.5 w-1.5 rounded-full" style={{ background: c }} />;
}

function StatusDot({ status }: { status: Device["status"] }) {
  const color =
    status === "active" || status === "idle" ? "var(--admin-success)" :
    status === "offline" ? "var(--admin-warning)" : "var(--admin-ink-soft)";
  return <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: color }} />;
}

function MetricTile({ icon: Icon, value, label }: { icon: React.ComponentType<{ className?: string; style?: React.CSSProperties }>; value: string; label: string }) {
  return (
    <div className="rounded-md border px-1.5 py-2 text-center" style={{ borderColor: "var(--admin-hairline)", background: "var(--admin-surface-sunken)" }}>
      <Icon className="mx-auto h-3.5 w-3.5" style={{ color: "var(--admin-ink-soft)" }} />
      <div className="mt-1 truncate text-sm font-bold" style={{ color: "var(--admin-ink)" }}>{value}</div>
      <div className="mono mt-0.5 truncate text-[8.5px] tracking-wider" style={{ color: "var(--admin-ink-soft)" }}>{label}</div>
    </div>
  );
}

function KV({ k, v, mono }: { k: string; v: string; mono?: boolean }) {
  return (
    <div>
      <div className="mono text-[9.5px] tracking-wider" style={{ color: "var(--admin-ink-soft)" }}>{k}</div>
      <div className={`${mono ? "mono " : ""}mt-0.5 text-xs font-medium`} style={{ color: "var(--admin-ink)" }}>{v}</div>
    </div>
  );
}

function TelemetryBar({ label, value, pct }: { label: string; value: string; pct: number }) {
  return (
    <div className="mt-2">
      <div className="flex items-center justify-between text-xs">
        <span style={{ color: "var(--admin-ink-soft)" }}>{label}</span>
        <span className="mono font-medium" style={{ color: "var(--admin-ink)" }}>{value}</span>
      </div>
      <div className="mt-1 h-1 overflow-hidden rounded-full" style={{ background: "var(--admin-surface-sunken)" }}>
        <div className="h-full rounded-full" style={{ width: `${pct}%`, background: "var(--admin-brand)" }} />
      </div>
    </div>
  );
}
