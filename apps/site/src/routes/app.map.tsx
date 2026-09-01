import { createFileRoute } from "@tanstack/react-router";
import * as React from "react";
import { generateDevices, type Device } from "@/lib/admin-mock";
import { Badge, AdminInput, AdminButton } from "@/components/admin/AdminKit";
import { Combobox } from "@/components/admin/Combobox";
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

const STATUS_LT: Record<Device["status"], string> = {
  active: "Prisijungęs",
  idle: "Prisijungęs",
  offline: "Atsijungęs",
  maintenance: "Nepasiekiamas",
};

function relAgo(d: Device): string {
  if (d.status === "active") return "prieš 5 sekundes";
  if (d.status === "idle") return "prieš 4 minutes";
  if (d.status === "maintenance") return "prieš 2 valandas";
  return "prieš 3 dienas";
}

function satsOf(d: Device): number {
  return 8 + (d.imei.charCodeAt(d.imei.length - 1) % 7);
}

function MapPage() {
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
  const online = ALL.filter((d) => d.status === "active" || d.status === "idle").length;
  const offline = ALL.filter((d) => d.status === "offline").length;
  const unreachable = ALL.filter((d) => d.status === "maintenance").length;

  return (
    <div className="flex h-[calc(100vh-3.5rem)] flex-col">
      {/* header strip — live status chips, exactly the real page's furniture */}
      <div className="admin-hairline-b flex flex-wrap items-center gap-2 px-4 py-2.5 md:px-6">
        <PanelLeft className="h-4 w-4" style={{ color: "var(--admin-ink-soft)" }} />
        <span className="text-sm font-semibold" style={{ color: "var(--admin-ink)" }}>Gyvas žemėlapis</span>
        <Badge tone="success">Gyvai</Badge>
        <StatusChip color="var(--admin-success)" label={`${online} Prisijungę`} />
        <StatusChip color="var(--admin-warning)" label={`${offline} Atsijungę`} />
        <StatusChip color="var(--admin-ink-soft)" label={`${unreachable} Nepasiekiami`} />
        <StatusChip color="var(--admin-ink-soft)" label="0 Niekada nepranešė" />
        <div className="flex-1" />
        <AdminButton variant="secondary" size="sm"><Pause className="h-3.5 w-3.5" /> Stabdyti</AdminButton>
        <AdminButton variant="secondary" size="sm"><Layers className="h-3.5 w-3.5" /> Sluoksniai</AdminButton>
        <AdminButton variant="secondary" size="sm" aria-label="Per visą ekraną"><Maximize2 className="h-3.5 w-3.5" /></AdminButton>
      </div>

      <div className="flex min-h-0 flex-1">
        {/* fleet list */}
        <aside className="admin-hairline-r flex w-[21rem] shrink-0 flex-col" style={{ background: "var(--admin-surface)" }}>
          <div className="space-y-2 p-3">
            <AdminInput placeholder="Ieškoti įrenginių..." value={q} onChange={(e) => setQ(e.target.value)} />
            <div className="flex items-center gap-3 text-xs" style={{ color: "var(--admin-ink-soft)" }}>
              <span>{filtered.length} iš {ALL.length}</span>
              <label className="flex items-center gap-1.5">
                <input type="checkbox" className="h-3.5 w-3.5" /> Sekti
              </label>
              <div className="ml-auto w-36">
                <Combobox
                  value={status}
                  onChange={setStatus}
                  options={[
                    { value: "", label: "Pagal būseną" },
                    { value: "active", label: "Prisijungę" },
                    { value: "offline", label: "Atsijungę" },
                    { value: "maintenance", label: "Nepasiekiami" },
                  ]}
                  placeholder="Pagal būseną"
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
                      <span className="inline-flex items-center gap-1"><Activity className="h-3 w-3" /> {on ? d.speed : 0} km/val</span>
                      <span className="inline-flex items-center gap-1"><Clock className="h-3 w-3" /> {relAgo(d)}</span>
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
          <DarkMap devices={filtered} activeId={active?.id} onSelect={setSelected} />
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
            <span className="inline-flex items-center gap-1.5"><Dot c="#7C7DF5" /> Prisijungęs</span>
            <span className="inline-flex items-center gap-1.5"><Dot c="#8A93A6" /> Atsijungęs</span>
            <span className="inline-flex items-center gap-1.5"><Dot c="#B9C0D0" /> Nepasiekiamas</span>
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
                <Badge tone={active.status === "offline" ? "neutral" : "success"}>{STATUS_LT[active.status]}</Badge>
              </div>
              <div className="mono mt-1 text-[11px]" style={{ color: "var(--admin-ink-soft)" }}>
                {active.plate} · IMEI {active.imei}
              </div>

              <div className="mt-3 grid grid-cols-4 gap-1.5">
                <MetricTile icon={Activity} value={`${active.status === "active" ? active.speed : 0} km…`} label="GREITIS" />
                <MetricTile icon={Satellite} value={String(satsOf(active))} label="PALYDOVAI" />
                <MetricTile icon={Signal} value={String(3 + (satsOf(active) % 3))} label="GSM SIGNAL" />
                <MetricTile icon={Zap} value="12.7 V" label="EXTERNAL V…" />
              </div>

              <div className="admin-hairline-b mt-3 flex gap-4 text-sm">
                {([["overview", "Apžvalga", Activity], ["params", "Parametrai", Radio], ["events", "Įvykiai", Signal], ["commands", "Komandos", ChevronRight]] as const).map(([id, label]) => (
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
                <div className="text-[11px] font-semibold uppercase tracking-wider" style={{ color: "var(--admin-ink)" }}>Pozicija</div>
                <div className="mt-2 grid grid-cols-2 gap-x-4 gap-y-2 text-xs">
                  <KV k="KOORDINATĖS" v={`${active.lat.toFixed(5)}, ${active.lng.toFixed(5)}`} mono />
                  <KV k="PASKUTINIS PAKETAS" v="2026-09-01 13:51" mono />
                  <KV k="KRYPTIS" v="295°" />
                  <KV k="DEGIMAS" v={active.status === "active" ? "Įjungtas" : "Išjungtas"} />
                </div>
                <div className="mt-2 text-[11px]" style={{ color: "var(--admin-ink-soft)" }}>{relAgo(active)}</div>
              </div>

              <div className="admin-card mt-3 p-3">
                <div className="text-[11px] font-semibold uppercase tracking-wider" style={{ color: "var(--admin-ink)" }}>
                  <Radio className="mr-1 inline h-3.5 w-3.5" /> Pagrindinė telemetrija
                </div>
                <TelemetryBar label="GSM Signal" value={`${3 + (satsOf(active) % 3)}`} pct={((3 + (satsOf(active) % 3)) / 5) * 100} />
                <div className="mt-2 flex items-center justify-between text-xs">
                  <span style={{ color: "var(--admin-ink-soft)" }}>External Voltage</span>
                  <span className="mono font-medium" style={{ color: "var(--admin-ink)" }}>12.7 V</span>
                </div>
                <div className="mt-1.5 flex items-center justify-between text-xs">
                  <span style={{ color: "var(--admin-ink-soft)" }}>Kuras</span>
                  <span className="mono font-medium" style={{ color: "var(--admin-ink)" }}>{active.fuel}%</span>
                </div>
              </div>

              <div className="admin-card mt-3 p-3">
                <div className="text-[11px] font-semibold uppercase tracking-wider" style={{ color: "var(--admin-ink)" }}>
                  <RouteIcon className="mr-1 inline h-3.5 w-3.5" /> Paskutinės kelionės
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
                <AdminButton variant="secondary" size="sm"><LocateFixed className="h-3.5 w-3.5" /> Sekti</AdminButton>
                <AdminButton variant="secondary" size="sm"><RouteIcon className="h-3.5 w-3.5" /> Pėdsakas</AdminButton>
              </div>
            </div>
          </aside>
        )}
      </div>

      {/* playback timeline — the real page's bottom dock */}
      <div className="admin-hairline-t flex items-center gap-3 px-4 py-2 md:px-6" style={{ background: "var(--admin-surface)" }}>
        <AdminButton variant="secondary" size="sm" aria-label="Groti"><Play className="h-3.5 w-3.5" /></AdminButton>
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
        <span className="mono text-[11px]" style={{ color: "var(--admin-ink-soft)" }}>24 val.</span>
        {["-24 val.", "-12 val.", "-6 val.", "-1 val."].map((l) => (
          <button key={l} className="mono cursor-pointer text-[11px]" style={{ color: "var(--admin-ink-soft)" }}>{l}</button>
        ))}
        <span className="mono rounded px-2 py-0.5 text-[11px] font-semibold" style={{ background: "var(--admin-brand)", color: "#fff" }}>dabar</span>
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

function DarkMap({ devices, activeId, onSelect }: { devices: Device[]; activeId?: string; onSelect: (id: string) => void }) {
  const W = 1000, H = 700;
  const minLng = 21.5, maxLng = 27.0, minLat = 53.9, maxLat = 55.6;
  const proj = (lat: number, lng: number) => ({
    x: ((lng - minLng) / (maxLng - minLng)) * W,
    y: H - ((lat - minLat) / (maxLat - minLat)) * H,
  });
  return (
    <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="xMidYMid slice" className="h-full w-full" style={{ background: "var(--admin-surface-sunken)" }}>
      <defs>
        <pattern id="mgrid" width="40" height="40" patternUnits="userSpaceOnUse">
          <path d="M 40 0 L 0 0 0 40" fill="none" stroke="var(--admin-hairline)" strokeWidth="0.5" />
        </pattern>
      </defs>
      <rect width={W} height={H} fill="url(#mgrid)" />
      {/* the A1 + A2 corridors, like the real basemap's highway lattice */}
      <path d="M 0 380 C 200 340 340 420 500 360 S 800 340 1000 380" fill="none" stroke="var(--admin-hairline)" strokeWidth="6" />
      <path d="M 400 0 C 380 200 460 340 420 500 S 460 660 480 700" fill="none" stroke="var(--admin-hairline)" strokeWidth="5" />
      {/* the selected vehicle's 24h track — the orange history line every screenshot shows */}
      <path d="M 690 470 C 640 440 560 430 500 400 S 430 370 400 340" fill="none" stroke="#F2A93B" strokeWidth="2.5" strokeLinecap="round" opacity="0.9" />
      {/* a dashed geofence, as on the real map's overlay layer */}
      <path d="M 560 300 L 660 280 L 700 340 L 640 400 L 560 380 Z" fill="rgba(76,77,207,0.08)" stroke="#4c4dcf" strokeOpacity="0.6" strokeWidth="1.5" strokeDasharray="5 5" />
      {[
        { name: "Vilnius", lat: 54.687, lng: 25.283 },
        { name: "Kaunas", lat: 54.898, lng: 23.9 },
        { name: "Klaipėda", lat: 55.71, lng: 21.13 },
        { name: "Šiauliai", lat: 55.93, lng: 23.31 },
        { name: "Panevėžys", lat: 55.73, lng: 24.36 },
      ].map((c) => {
        const p = proj(c.lat, c.lng);
        return (
          <g key={c.name}>
            <circle cx={p.x} cy={p.y} r={2} fill="var(--admin-ink-soft)" />
            <text x={p.x + 8} y={p.y + 3} fontSize="11" fill="var(--admin-ink-soft)">{c.name}</text>
          </g>
        );
      })}
      {devices.map((d, i) => {
        const p = proj(d.lat, d.lng);
        const on = d.status === "active" || d.status === "idle";
        const color = on ? "#7C7DF5" : d.status === "offline" ? "#8A93A6" : "#B9C0D0";
        const isActive = d.id === activeId;
        const angle = (i * 47) % 360;
        return (
          <g key={d.id} style={{ cursor: "pointer" }} onClick={() => onSelect(d.id)} transform={`translate(${p.x}, ${p.y})`}>
            {isActive && <circle r={16} fill="#7C5CFC" opacity={0.22} />}
            {/* heading arrow, like the real device marker */}
            <g transform={`rotate(${angle})`}>
              <path d="M 0 -9 L 6 7 L 0 4 L -6 7 Z" fill={color} stroke="#fff" strokeWidth={1.4} strokeLinejoin="round" />
            </g>
          </g>
        );
      })}
    </svg>
  );
}
