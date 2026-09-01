import { createFileRoute } from "@tanstack/react-router";
import * as React from "react";
import { useTranslation } from "react-i18next";
import { generateDevices, type Device } from "@/lib/admin-mock";
import { LANGUAGES, type Lang } from "@/lib/i18n";
import { Badge, AdminInput, AdminButton } from "@/components/admin/AdminKit";
import { Combobox } from "@/components/admin/Combobox";
import { DemoMap, type DemoRoute, type DemoVehicle, type DemoZone } from "@/components/admin/DemoMap";
import {
  VILNIUS_LOOP, KAUNAS_LOOP, DEPOT_POLYGON, SALDENE_CENTER, SALDENE_RADIUS_M,
  circleRing, routeSlice, type LngLat,
} from "@/lib/demo-geo";
import {
  PanelLeft, Pause, Layers, Maximize2, Satellite, Power, Clock, ChevronRight,
  Activity, Radio, Signal, Zap, Play, ZoomIn, ZoomOut, Crosshair, MapPin, LocateFixed, Route as RouteIcon,
} from "lucide-react";

export const Route = createFileRoute("/app/map")({
  component: MapPage,
});

/** Mirrors the REAL live map (apps/web app/map): status-chip header strip, fleet list with
 * per-row telemetry, dark map with heading arrows, right inspector rail with metric tiles +
 * tabs + POZICIJA/telemetry/trip blocks, and the playback timeline docked at the bottom. */
const ALL = generateDevices();

/** Bearing (deg from north) from a to b — flat-earth atan2 is fine at city scale. */
function bearingDeg(a: LngLat, b: LngLat): number {
  const deg = (Math.atan2((b[0] - a[0]) * Math.cos((a[1] * Math.PI) / 180), b[1] - a[1]) * 180) / Math.PI;
  return (deg + 360) % 360;
}

/** Deterministic on-road placement: mock lat/lng is ignored — every device sits on a real
 * street of VILNIUS_LOOP (first 16) or KAUNAS_LOOP, heading toward the next route point. */
type Placement = { at: LngLat; headingDeg: number; loop: LngLat[]; idx: number };
const PLACEMENTS = new Map<string, Placement>(
  ALL.map((d, i) => {
    const loop = i < 16 ? VILNIUS_LOOP : KAUNAS_LOOP;
    const idx = (i * 17) % loop.length;
    const at = loop[idx];
    return [d.id, { at, headingDeg: bearingDeg(at, loop[(idx + 1) % loop.length]), loop, idx }];
  }),
);

const FIT_ALL: LngLat[] = ALL.map((d) => PLACEMENTS.get(d.id)!.at);

/** Live-map overlay zones — drawn dashed, as on the real dashboard. */
const ZONES: DemoZone[] = [
  { id: "depot", color: "#4c4dcf", ring: DEPOT_POLYGON, dashed: true },
  { id: "saldene", color: "#7C5CFC", ring: circleRing(SALDENE_CENTER, SALDENE_RADIUS_M), dashed: true },
];

const TRACK_PTS = 60;

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

function satsOf(d: Device): number {
  return 8 + (d.imei.charCodeAt(d.imei.length - 1) % 7);
}

function MapPage() {
  const { t, i18n } = useTranslation("admin");
  // the dock is a static mock; the picker is real enough to open, which is what a demo needs
  const [demoDay, setDemoDay] = React.useState(0);
  const lang = (i18n.resolvedLanguage ?? "lt").slice(0, 2) as Lang;
  const l = L[LANGUAGES.includes(lang) ? lang : "lt"];
  const [q, setQ] = React.useState("");
  const [status, setStatus] = React.useState<string>("");
  const [selected, setSelected] = React.useState<string | null>(ALL[0]?.id ?? null);
  const [tab, setTab] = React.useState<"overview" | "params" | "events" | "commands">("overview");

  const filtered = ALL.filter(
    (d) =>
      (!q || `${d.name} ${d.plate} ${d.driver}`.toLowerCase().includes(q.toLowerCase())) &&
      (!status || d.status === status),
  );
  const active = filtered.find((d) => d.id === selected) ?? null;

  const vehicles: DemoVehicle[] = filtered.map((d) => {
    const p = PLACEMENTS.get(d.id)!;
    const on = d.status === "active" || d.status === "idle";
    return {
      id: d.id,
      at: p.at,
      headingDeg: p.headingDeg,
      color: on ? "#7C7DF5" : d.status === "offline" ? "#8A93A6" : "#B9C0D0",
      selected: d.id === active?.id,
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
        <AdminButton variant="secondary" size="sm"><Layers className="h-3.5 w-3.5" /> {t("map.layers.title")}</AdminButton>
        <AdminButton variant="secondary" size="sm" aria-label={t("map.fullscreen")}><Maximize2 className="h-3.5 w-3.5" /></AdminButton>
      </div>

      <div className="flex min-h-0 flex-1">
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
        <div className="relative min-w-0 flex-1 overflow-hidden">
          <DemoMap
            className="h-full w-full"
            zones={ZONES}
            routes={trackRoutes}
            vehicles={vehicles}
            fit={FIT_ALL}
            fitPadding={80}
            onVehicleClick={setSelected}
          />
          <div className="absolute right-3 top-3 flex flex-col gap-1.5">
            {[ZoomIn, ZoomOut, Crosshair, MapPin].map((Icon, i) => (
              <button
                key={i}
                className="grid h-8 w-8 cursor-pointer place-items-center rounded-md border backdrop-blur"
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
        </div>

        {/* inspector rail */}
        {active && (
          <aside className="admin-hairline-l hidden w-[23rem] shrink-0 flex-col overflow-y-auto xl:flex" style={{ background: "var(--admin-surface)" }}>
            <div className="p-4">
              <div className="flex items-center justify-between gap-2">
                <div className="flex min-w-0 items-center gap-2">
                  <StatusDot status={active.status} />
                  <span className="truncate font-semibold" style={{ color: "var(--admin-ink)" }}>{active.name} ({active.plate})</span>
                </div>
                <Badge tone={active.status === "offline" ? "neutral" : "success"}>{t(STATUS_KEY[active.status])}</Badge>
              </div>
              <div className="mono mt-1 text-[11px]" style={{ color: "var(--admin-ink-soft)" }}>
                {active.plate} · IMEI {active.imei}
              </div>

              <div className="mt-3 grid grid-cols-4 gap-1.5">
                <MetricTile icon={Activity} value={`${active.status === "active" ? active.speed : 0} km…`} label={t("info.speed").toUpperCase()} />
                <MetricTile icon={Satellite} value={String(satsOf(active))} label={t("info.satellites").toUpperCase()} />
                <MetricTile icon={Signal} value={String(3 + (satsOf(active) % 3))} label={t("devices.health.gsm").toUpperCase()} />
                <MetricTile icon={Zap} value="12.7 V" label={t("devices.health.extV").toUpperCase()} />
              </div>

              <div className="admin-hairline-b mt-3 flex gap-4 text-sm">
                {([["overview", t("map.inspector.overview"), Activity], ["params", t("map.inspector.params"), Radio], ["events", t("map.inspector.events"), Signal], ["commands", t("map.inspector.commands"), ChevronRight]] as const).map(([id, label]) => (
                  <button
                    key={id}
                    onClick={() => setTab(id)}
                    className="cursor-pointer pb-2"
                    style={{
                      color: tab === id ? "var(--admin-brand)" : "var(--admin-ink-soft)",
                      boxShadow: tab === id ? "inset 0 -2px 0 var(--admin-brand)" : undefined,
                      fontWeight: tab === id ? 600 : 400,
                    }}
                  >
                    {label}
                  </button>
                ))}
              </div>

              <div className="admin-card mt-3 p-3">
                <div className="text-[11px] font-semibold uppercase tracking-wider" style={{ color: "var(--admin-ink)" }}>{t("map.inspector.position")}</div>
                <div className="mt-2 grid grid-cols-2 gap-x-4 gap-y-2 text-xs">
                  <KV k={t("map.inspector.coords").toUpperCase()} v={`${active.lat.toFixed(5)}, ${active.lng.toFixed(5)}`} mono />
                  <KV k={t("map.inspector.lastPacket").toUpperCase()} v="2026-09-01 13:51" mono />
                  <KV k={t("map.inspector.heading").toUpperCase()} v="295°" />
                  <KV k={t("info.ignition").toUpperCase()} v={active.status === "active" ? t("info.on") : t("info.off")} />
                </div>
                <div className="mt-2 text-[11px]" style={{ color: "var(--admin-ink-soft)" }}>{relAgo(active, l)}</div>
              </div>

              <div className="admin-card mt-3 p-3">
                <div className="text-[11px] font-semibold uppercase tracking-wider" style={{ color: "var(--admin-ink)" }}>
                  <Radio className="mr-1 inline h-3.5 w-3.5" /> {t("map.inspector.telemetry")}
                </div>
                <TelemetryBar label={t("devices.health.gsm")} value={`${3 + (satsOf(active) % 3)}`} pct={((3 + (satsOf(active) % 3)) / 5) * 100} />
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
            </div>
          </aside>
        )}
      </div>

      {/* playback timeline — the real page's bottom dock */}
      <div className="admin-hairline-t flex items-center gap-3 px-4 py-2 md:px-6" style={{ background: "var(--admin-surface)" }}>
        <AdminButton variant="secondary" size="sm" aria-label={t("playback.play")}><Play className="h-3.5 w-3.5" /></AdminButton>
        <span className="mono rounded border px-1.5 py-0.5 text-[11px]" style={{ borderColor: "var(--admin-hairline)", color: "var(--admin-ink-soft)" }}>60×</span>
        <div className="relative h-8 min-w-0 flex-1">
          <div className="absolute inset-x-0 top-1/2 h-px" style={{ background: "var(--admin-hairline)" }} />
          {["15:00", "18:00", "21:00", "00:00", "03:00", "06:00", "09:00", "12:00"].map((h, i) => (
            <span key={h} className="mono absolute top-1/2 mt-1.5 -translate-x-1/2 text-[10px]" style={{ left: `${6 + i * 12.5}%`, color: "var(--admin-ink-soft)" }}>{h}</span>
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
        <span className="mono text-[11px]" style={{ color: "var(--admin-ink-soft)" }}>{t("map.timeline.span", { hours: 24 })}</span>
        {[24, 12, 6, 1].map((h) => (
          <button key={h} className="mono cursor-pointer text-[11px]" style={{ color: "var(--admin-ink-soft)" }}>{t("map.timeline.quick.hours", { hours: h })}</button>
        ))}
        <span className="mono rounded px-2 py-0.5 text-[11px] font-semibold" style={{ background: "var(--admin-brand)", color: "#fff" }}>{t("map.timeline.now")}</span>
      </div>
    </div>
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
