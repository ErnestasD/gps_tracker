import { createFileRoute } from "@tanstack/react-router";
import * as React from "react";
import { Fuel, Gauge, Pause, Play, SkipBack, SkipForward } from "lucide-react";
import { AdminButton, Badge, PageHeader } from "@/components/admin/AdminKit";
import { Combobox } from "@/components/admin/Combobox";
import { DatePicker } from "@/components/admin/DatePicker";
import { fmtDateTime } from "@/lib/admin-format";

export const Route = createFileRoute("/app/history")({
  component: HistoryPage,
});

// ---------------------------------------------------------------------------
// Static demo data — mirrors the real "Istorijos peržiūra" playback page
// ---------------------------------------------------------------------------

const DEVICES = [
  { id: "dev_0001", name: "Van 01", plate: "KLM 421" },
  { id: "dev_0002", name: "Van 02", plate: "JRE 208" },
  { id: "dev_0003", name: "Sprinter 03", plate: "BKT 617" },
  { id: "dev_0004", name: "Transit 04", plate: "FGD 934" },
  { id: "dev_0005", name: "Truck 05", plate: "HSN 152" },
];

// A day of positions: 240 samples, 90 s apart, starting 2026-08-31 05:12 UTC.
const N = 240;
const START_MS = Date.parse("2026-08-31T05:12:00Z");
const STEP_MS = 90_000;
const timeAt = (i: number) => new Date(START_MS + i * STEP_MS).toISOString();

// Deterministic speed profile (km/h): four runs with stops between them.
const SPEEDS: number[] = Array.from({ length: N }, (_, i) => {
  const t = i / (N - 1);
  const driving = Math.sin(t * Math.PI * 4) > -0.35 ? 1 : 0; // stop windows between trips
  const base = 44 + Math.sin(t * 9) * 24 + Math.sin(t * 27) * 9;
  return Math.max(0, Math.round(base * driving));
});

// Fuel level (%): slow decline over the day with mild sensor wobble.
const FUEL: number[] = Array.from({ length: N }, (_, i) => {
  const t = i / (N - 1);
  return Math.round((78 - t * 14 - Math.sin(t * 5) * 1.1) * 10) / 10;
});

const TRIP_COUNT = 4;
const TOTAL_DISTANCE = "56.3 km";

// ---------------------------------------------------------------------------
// Procedural route sketch (no map libs) — deterministic wandering polyline
// ---------------------------------------------------------------------------

function mulberry32(seed: number) {
  return function () {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = seed;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const MAP_W = 1000;
const MAP_H = 400;
const ROUTE_PTS: [number, number][] = (() => {
  const r = mulberry32(29);
  const n = 12;
  const pts: [number, number][] = [];
  let y = MAP_H * 0.72;
  for (let i = 0; i < n; i++) {
    const x = MAP_W * 0.06 + (MAP_W * 0.88 * i) / (n - 1) + (r() - 0.5) * MAP_W * 0.03;
    y = Math.min(MAP_H * 0.88, Math.max(MAP_H * 0.12, y + (r() - 0.55) * MAP_H * 0.38));
    pts.push([x, y]);
  }
  return pts;
})();
const ROUTE_D = "M" + ROUTE_PTS.map(([x, y]) => `${x.toFixed(1)} ${y.toFixed(1)}`).join(" L");

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

function HistoryPage() {
  const [deviceId, setDeviceId] = React.useState(DEVICES[0].id);
  const [from, setFrom] = React.useState<Date | undefined>(new Date(2026, 7, 31));
  const [to, setTo] = React.useState<Date | undefined>(new Date(2026, 7, 31));
  const [index, setIndex] = React.useState(0);
  const [playing, setPlaying] = React.useState(false);
  const pathRef = React.useRef<SVGPathElement | null>(null);
  const [marker, setMarker] = React.useState<{ x: number; y: number }>({ x: ROUTE_PTS[0][0], y: ROUTE_PTS[0][1] });

  // "Groti": advance the scrub index ~5 positions/s; reaching the last point stops
  React.useEffect(() => {
    if (!playing) return;
    const iv = setInterval(() => setIndex((i) => (i >= N - 1 ? i : i + 1)), 200);
    return () => clearInterval(iv);
  }, [playing]);
  React.useEffect(() => {
    if (playing && index >= N - 1) setPlaying(false);
  }, [playing, index]);

  // the current-position marker follows the sketched route
  React.useEffect(() => {
    const path = pathRef.current;
    if (!path) return;
    const len = path.getTotalLength();
    const p = path.getPointAtLength((index / (N - 1)) * len);
    setMarker({ x: p.x, y: p.y });
  }, [index]);

  const device = DEVICES.find((d) => d.id === deviceId) ?? DEVICES[0];
  const speed = SPEEDS[Math.min(index, N - 1)];
  const fuel = FUEL[Math.min(index, N - 1)];
  const [sx, sy] = ROUTE_PTS[0];
  const [ex, ey] = ROUTE_PTS[ROUTE_PTS.length - 1];

  return (
    <div className="mx-auto w-full max-w-7xl space-y-4 p-4 md:p-6">
      <PageHeader title="Istorijos peržiūra" description="Kelionių atkūrimas su greičio ir kuro grafikais.">
        <div className="w-56">
          <Combobox
            value={deviceId}
            onChange={setDeviceId}
            options={DEVICES.map((d) => ({ value: d.id, label: d.name, hint: d.plate }))}
          />
        </div>
        <div className="w-40"><DatePicker value={from} onChange={setFrom} placeholder="Nuo" /></div>
        <div className="w-40"><DatePicker value={to} onChange={setTo} placeholder="Iki" /></div>
      </PageHeader>

      <div className="admin-card overflow-hidden">
        {/* map + floating current-position overlay */}
        <div className="relative h-[360px] md:h-[420px]" style={{ background: "var(--admin-surface-sunken)" }}>
          <svg viewBox={`0 0 ${MAP_W} ${MAP_H}`} className="h-full w-full">
            <defs>
              <pattern id="hgrid" width="40" height="40" patternUnits="userSpaceOnUse">
                <path d="M 40 0 L 0 0 0 40" fill="none" stroke="var(--admin-hairline)" strokeWidth="0.5" />
              </pattern>
            </defs>
            <rect width={MAP_W} height={MAP_H} fill="url(#hgrid)" />
            <path ref={pathRef} d={ROUTE_D} fill="none" stroke="var(--admin-brand)" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
            <circle cx={sx} cy={sy} r="6" fill="var(--admin-success)" stroke="#fff" strokeWidth="2" />
            <circle cx={ex} cy={ey} r="6" fill="var(--admin-danger)" stroke="#fff" strokeWidth="2" />
            <circle cx={marker.x} cy={marker.y} r="8" fill="var(--admin-brand)" stroke="#fff" strokeWidth="3" />
          </svg>
          <div className="admin-card absolute left-3 top-3 z-10 px-3 py-2">
            <div className="text-xs" style={{ color: "var(--admin-ink-soft)" }}>
              {device.name} · {fmtDateTime(timeAt(index))}
            </div>
            <div className="mt-1 flex items-center gap-3 text-sm" style={{ color: "var(--admin-ink)" }}>
              <span className="inline-flex items-center gap-1 tabular-nums">
                <Gauge className="h-3.5 w-3.5" style={{ color: "var(--admin-brand)" }} aria-hidden />
                {speed} km/val
              </span>
              <span className="inline-flex items-center gap-1 tabular-nums">
                <Fuel className="h-3.5 w-3.5" style={{ color: "var(--admin-brand)" }} aria-hidden />
                {fuel}%
              </span>
            </div>
          </div>
        </div>

        {/* transport controls + scrubber */}
        <div className="admin-hairline-t p-4">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-1">
              <AdminButton
                variant="ghost"
                size="sm"
                aria-label="Į pradžią"
                onClick={() => {
                  setPlaying(false);
                  setIndex(0);
                }}
              >
                <SkipBack className="h-4 w-4" aria-hidden />
              </AdminButton>
              <AdminButton
                size="sm"
                onClick={() => {
                  // Play at the last point restarts from the top
                  if (!playing && index >= N - 1) setIndex(0);
                  setPlaying((p) => !p);
                }}
              >
                {playing ? <Pause className="h-4 w-4" aria-hidden /> : <Play className="h-4 w-4" aria-hidden />}
                {playing ? "Pauzė" : "Groti"}
              </AdminButton>
              <AdminButton
                variant="ghost"
                size="sm"
                aria-label="Į pabaigą"
                onClick={() => {
                  setPlaying(false);
                  setIndex(N - 1);
                }}
              >
                <SkipForward className="h-4 w-4" aria-hidden />
              </AdminButton>
            </div>
            <div className="flex flex-wrap items-center gap-3 text-xs tabular-nums" style={{ color: "var(--admin-ink-soft)" }}>
              <span>taškas {index + 1} / {N}</span>
              <span>{TRIP_COUNT} kelionės</span>
              <span>{TOTAL_DISTANCE}</span>
            </div>
          </div>
          <input
            type="range"
            min={0}
            max={N - 1}
            value={index}
            onChange={(e) => setIndex(Number(e.target.value))}
            aria-label="Atkūrimo pozicija"
            className="w-full accent-[var(--admin-brand)]"
          />
        </div>
      </div>

      {/* chart cards: speed + fuel, both scrub-aware like the real playback page */}
      <div className="mt-4 grid gap-3 lg:grid-cols-2">
        <div className="admin-card p-3 md:p-4">
          <div className="mb-1 flex items-center justify-between text-xs">
            <span style={{ color: "var(--admin-ink-soft)" }}>Greitis</span>
            <Badge tone="brand"><span className="tabular-nums">{speed} km/val</span></Badge>
          </div>
          <SpeedChart speeds={SPEEDS} index={index} onScrub={setIndex} />
        </div>
        <div className="admin-card p-3 md:p-4">
          <div className="mb-1 flex items-center justify-between text-xs">
            <span style={{ color: "var(--admin-ink-soft)" }}>Kuro lygis</span>
            <Badge tone="brand"><span className="tabular-nums">{fuel}%</span></Badge>
          </div>
          <FuelChart levels={FUEL} index={index} />
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Hand-rolled SVG charts — same idiom as the real SpeedChart/FuelChart
// ---------------------------------------------------------------------------

const CW = 600;
const CPAD = 6;

function chartPath(values: readonly number[], h: number, zeroBase = true): string {
  if (values.length === 0) return "";
  const min = zeroBase ? 0 : Math.min(...values);
  const range = Math.max(1, Math.max(...values) - min);
  const innerW = CW - CPAD * 2;
  const innerH = h - CPAD * 2;
  const step = values.length > 1 ? innerW / (values.length - 1) : 0;
  return "M" + values.map((v, i) => `${(CPAD + i * step).toFixed(1)} ${(CPAD + innerH * (1 - (v - min) / range)).toFixed(1)}`).join(" L");
}

const cursorX = (i: number, n: number) => CPAD + (CW - CPAD * 2) * (n > 1 ? i / (n - 1) : 0);

const chartFrame: React.CSSProperties = { borderColor: "var(--admin-hairline)", background: "var(--admin-surface)" };

function SpeedChart({ speeds, index, onScrub }: { speeds: number[]; index: number; onScrub: (i: number) => void }) {
  const H = 120;
  const ref = React.useRef<SVGSVGElement>(null);
  const path = React.useMemo(() => chartPath(speeds, H), [speeds]);

  const scrubToClientX = (clientX: number) => {
    const svg = ref.current;
    if (svg === null || speeds.length === 0) return;
    const rect = svg.getBoundingClientRect();
    const ratio = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
    onScrub(Math.round(ratio * (speeds.length - 1)));
  };

  return (
    <svg
      ref={ref}
      viewBox={`0 0 ${CW} ${H}`}
      className="h-28 w-full cursor-crosshair select-none rounded-md border"
      style={chartFrame}
      role="slider"
      aria-label="Atkūrimo greičio laiko juosta"
      aria-valuenow={index}
      aria-valuemin={0}
      aria-valuemax={Math.max(0, speeds.length - 1)}
      onPointerDown={(e) => {
        e.currentTarget.setPointerCapture(e.pointerId);
        scrubToClientX(e.clientX);
      }}
      onPointerMove={(e) => {
        if (e.buttons === 1) scrubToClientX(e.clientX);
      }}
    >
      {path !== "" && <path d={path} fill="none" stroke="var(--admin-brand)" strokeWidth={1.5} />}
      <line x1={cursorX(index, speeds.length)} y1={CPAD} x2={cursorX(index, speeds.length)} y2={H - CPAD} stroke="var(--admin-info)" strokeWidth={1} />
    </svg>
  );
}

function FuelChart({ levels, index }: { levels: number[]; index: number }) {
  const H = 80;
  const path = React.useMemo(() => chartPath(levels, H, false), [levels]);
  return (
    <svg
      viewBox={`0 0 ${CW} ${H}`}
      className="h-20 w-full select-none rounded-md border"
      style={chartFrame}
      role="img"
      aria-label="Kuro lygio laiko juosta"
    >
      {path !== "" && <path d={path} fill="none" stroke="var(--admin-info)" strokeWidth={1.5} />}
      <line x1={cursorX(index, levels.length)} y1={CPAD} x2={cursorX(index, levels.length)} y2={H - CPAD} stroke="var(--admin-brand)" strokeWidth={1} />
    </svg>
  );
}
