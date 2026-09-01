import { useState } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { Activity, AlertTriangle, Bell } from "lucide-react";

import { PageHeader, StatCard, Badge, AdminButton } from "@/components/admin/AdminKit";
import { fmtDateTime, fmtNumber } from "@/lib/admin-format";

/**
 * Apžvalga — DEMO mirror of the REAL dashboard (apps/web/src/routes/app/dashboard.tsx).
 * Same sections in the same order: stat row → fleet-activity area chart (7/30/90 d) +
 * events-by-kind donut → hourly histogram + latest-reporting devices → recent events.
 * All strings are the LT i18n values of the real page, hardcoded; all figures are static
 * believable data around 2026-09-01. Charts are the real page's hand-rolled SVGs
 * (ADR-028 — no chart runtime dep) restyled onto the site's --admin-* tokens.
 */

export const Route = createFileRoute("/app/")({
  component: OverviewPage,
});

/* ── static demo data ─────────────────────────────────────────────────────── */

const RANGES = [7, 30, 90] as const;
type RangeDays = (typeof RANGES)[number];
const RANGE_LABEL: Record<RangeDays, string> = { 7: "7 d.", 30: "30 d.", 90: "90 d." };

const BASE_UTC = Date.UTC(2026, 8, 1); // 2026-09-01 — "today" for the demo
const MS_DAY = 86_400_000;

/** Deterministic daily-km series ending today (weekend dips + gentle wiggle). */
function makeKmSeries(n: number): { day: string; km: number }[] {
  return Array.from({ length: n }, (_, i) => {
    const t = BASE_UTC - (n - 1 - i) * MS_DAY;
    const d = new Date(t);
    const dow = d.getUTCDay();
    const weekend = dow === 0 || dow === 6 ? 0.45 : 1;
    const km =
      i === n - 1
        ? 1246 // today matches the "Šiandien nuvažiuota" stat
        : Math.round((1180 + 260 * Math.sin(i * 0.9) + 90 * Math.sin(i * 0.37)) * weekend * 10) / 10;
    return { day: d.toISOString().slice(0, 10), km };
  });
}

const SERIES: Record<RangeDays, { day: string; km: number }[]> = {
  7: makeKmSeries(7),
  30: makeKmSeries(30),
  90: makeKmSeries(90),
};

/** Events by kind over 7 d — LT labels from events.k, sorted desc like the real breakdown. */
const BREAKDOWN = [
  { kind: "Geozona", count: 41 },
  { kind: "Greičio viršijimas", count: 29 },
  { kind: "Uždegimas", count: 22 },
  { kind: "Maitinimo nutrūkimas", count: 14 },
  { kind: "Žema baterija", count: 8 },
  { kind: "Kuro vagystė", count: 4 },
];
const EVENTS_7D_TOTAL = BREAKDOWN.reduce((s, b) => s + b.count, 0);

/** Events per hour of day (7 d) — morning + late-afternoon peaks. */
const HOURLY = [1, 0, 0, 1, 2, 5, 9, 14, 12, 8, 6, 5, 6, 7, 8, 10, 13, 15, 11, 7, 4, 3, 2, 1];

type DeviceStatus = "online" | "stale" | "offline";
const STATUS_LABEL: Record<DeviceStatus, string> = {
  online: "Prisijungęs",
  stale: "Atsijungęs",
  offline: "Nepasiekiamas",
};
const STATUS_TONE: Record<DeviceStatus, "success" | "warning" | "neutral"> = {
  online: "success",
  stale: "warning",
  offline: "neutral",
};

const LATEST: { name: string; sub: string; status: DeviceStatus }[] = [
  { name: "Krovininis 01", sub: "KRV 421 · 67 km/h", status: "online" },
  { name: "Vilkikas 07", sub: "VLK 208 · 89 km/h", status: "online" },
  { name: "Pikapas 02", sub: "PKP 133 · 54 km/h", status: "online" },
  { name: "Busiukas 03", sub: "BSK 512 · 0 km/h", status: "stale" },
  { name: "Priekaba 11", sub: "PRK 097", status: "offline" },
];

type Severity = "critical" | "warning" | "info";

const RECENT: { id: string; severity: Severity; summary: string; device: string; at: string; kind: string }[] = [
  { id: "e1", severity: "critical", summary: "SOS pavojaus signalas", device: "Krovininis 01", at: "2026-09-01T07:42:00Z", kind: "Pavojaus mygtukas" },
  { id: "e2", severity: "warning", summary: "97 km/h > 90 km/h", device: "Vilkikas 07", at: "2026-09-01T07:18:00Z", kind: "Greičio viršijimas" },
  { id: "e3", severity: "info", summary: "Terminalas Kaunas · įvažiavimas", device: "Pikapas 02", at: "2026-09-01T06:55:00Z", kind: "Geozona" },
  { id: "e4", severity: "info", summary: "degimas įjungtas", device: "Busiukas 03", at: "2026-09-01T06:31:00Z", kind: "Uždegimas" },
  { id: "e5", severity: "critical", summary: "dingo išorinis maitinimas", device: "Priekaba 11", at: "2026-08-31T22:14:00Z", kind: "Maitinimo nutrūkimas" },
  { id: "e6", severity: "warning", summary: "3.6 V < 3.8 V", device: "Vilkikas 04", at: "2026-08-31T21:02:00Z", kind: "Žema baterija" },
];

const SEVERITY_ICON: Record<Severity, typeof Bell> = { critical: Bell, warning: AlertTriangle, info: Activity };

/* ── hand-rolled SVG charts (mirrors of apps/web Charts.tsx on --admin-* tokens) ── */

/** Fixed categorical rotation for donut segments + legend. */
const KIND_COLORS = [
  "var(--admin-brand)",
  "var(--admin-info)",
  "var(--admin-success)",
  "var(--admin-warning)",
  "var(--admin-danger)",
  "var(--admin-ink-soft)",
] as const;
const kindColor = (i: number): string => KIND_COLORS[i % KIND_COLORS.length];

function round2(n: number): number {
  const v = Math.round(n * 100) / 100;
  return v === 0 ? 0 : v;
}

/** Smooth (Catmull-Rom → cubic bézier) line + closed area for a series in a w×h box. */
function areaPath(values: number[], w: number, h: number): { line: string; area: string } {
  const n = values.length;
  if (n === 0) return { line: "", area: "" };
  const max = Math.max(...values, 1);
  const pts = values.map((v, i) => [n === 1 ? w / 2 : (i / (n - 1)) * w, h - (v / max) * h] as const);
  const clampY = (y: number): number => Math.min(h, Math.max(0, y));
  let line = `M${round2(pts[0][0])},${round2(pts[0][1])}`;
  for (let i = 0; i < n - 1; i++) {
    const p0 = pts[i - 1] ?? pts[i];
    const p1 = pts[i];
    const p2 = pts[i + 1];
    const p3 = pts[i + 2] ?? p2;
    const c1y = clampY(p1[1] + (p2[1] - p0[1]) / 6);
    const c2y = clampY(p2[1] - (p3[1] - p1[1]) / 6);
    line += ` C${round2(p1[0] + (p2[0] - p0[0]) / 6)},${round2(c1y)} ${round2(p2[0] - (p3[0] - p1[0]) / 6)},${round2(c2y)} ${round2(p2[0])},${round2(p2[1])}`;
  }
  return { line, area: `${line} L${round2(w)},${round2(h)} L0,${round2(h)} Z` };
}

const W = 640;
const H = 240;
const ML = 40;
const MT = 10;
const MR = 10;
const MB = 22;
const PW = W - ML - MR;
const PH = H - MT - MB;

function AreaChartSvg({ series, unit }: { series: { day: string; km: number }[]; unit: string }) {
  const values = series.map((s) => s.km);
  const max = Math.max(...values, 1);
  const { line, area } = areaPath(values, PW, PH);
  const n = series.length;
  const labelStep = Math.max(1, Math.ceil(n / 8));
  const x = (i: number): number => (n === 1 ? PW / 2 : (i / (n - 1)) * PW);
  const lastY = PH - (values[n - 1] / max) * PH;
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label="Parko aktyvumas">
      <defs>
        <linearGradient id="dashAreaFill" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="var(--admin-brand)" stopOpacity={0.35} />
          <stop offset="100%" stopColor="var(--admin-brand)" stopOpacity={0} />
        </linearGradient>
      </defs>
      {[0, 0.25, 0.5, 0.75, 1].map((f) => {
        const gy = MT + PH - f * PH;
        return (
          <g key={f}>
            <line x1={ML} y1={gy} x2={W - MR} y2={gy} stroke="var(--admin-hairline-soft)" strokeWidth={1} />
            <text x={ML - 6} y={gy + 3} textAnchor="end" fontSize={10} fill="var(--admin-ink-soft)">
              {Math.round(max * f)}
            </text>
          </g>
        );
      })}
      <g transform={`translate(${ML},${MT})`}>
        <path d={area} fill="url(#dashAreaFill)" />
        <path d={line} fill="none" stroke="var(--admin-brand)" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
        <circle cx={x(n - 1)} cy={lastY} r={3.5} fill="var(--admin-brand)" stroke="var(--admin-surface)" strokeWidth={2} />
        {series.map((s, i) => (
          <g key={s.day}>
            <rect x={x(i) - PW / Math.max(1, n) / 2} y={0} width={PW / Math.max(1, n)} height={PH} fill="transparent">
              <title>{`${s.day} · ${s.km} ${unit}`}</title>
            </rect>
            {i % labelStep === 0 && (
              <text x={x(i)} y={PH + 15} textAnchor="middle" fontSize={9} fill="var(--admin-ink-soft)">
                {s.day.slice(5)}
              </text>
            )}
          </g>
        ))}
      </g>
    </svg>
  );
}

function DonutSvg({
  breakdown,
  centerValue,
  centerLabel,
}: {
  breakdown: { kind: string; count: number }[];
  centerValue: string;
  centerLabel: string;
}) {
  const R = 62;
  const total = breakdown.reduce((s, b) => s + b.count, 0);
  const C = 2 * Math.PI * R;
  const gap = breakdown.length > 1 ? 2 : 0;
  let start = 0;
  const segments = breakdown.map((b) => {
    const len = (b.count / Math.max(1, total)) * C;
    const visible = round2(Math.max(0.5, len - gap));
    const seg = { ...b, dash: `${visible} ${round2(C - visible)}`, offset: round2(-start) };
    start += len;
    return seg;
  });
  return (
    <svg viewBox="0 0 168 168" className="mx-auto h-44 w-44" role="img" aria-label="Įvykiai (7 d.)">
      <g transform="rotate(-90 84 84)">
        {segments.map((s, i) => (
          <circle key={s.kind} cx={84} cy={84} r={R} fill="none" stroke={kindColor(i)} strokeWidth={20} strokeDasharray={s.dash} strokeDashoffset={s.offset}>
            <title>{`${s.kind} · ${s.count}`}</title>
          </circle>
        ))}
      </g>
      <text x={84} y={82} textAnchor="middle" fontSize={26} fontWeight={600} fill="var(--admin-ink)" className="display">
        {centerValue}
      </text>
      <text x={84} y={100} textAnchor="middle" fontSize={10} fill="var(--admin-ink-soft)">
        {centerLabel}
      </text>
    </svg>
  );
}

const BW = 480;
const BH = 150;
const BPH = 118;
const BT = 6;

function HourlyBarsSvg({ buckets, unit }: { buckets: number[]; unit: string }) {
  const max = Math.max(...buckets, 1);
  const base = BT + BPH;
  return (
    <svg viewBox={`0 0 ${BW} ${BH}`} className="w-full" role="img" aria-label="Įvykiai pagal paros valandą">
      {[0.5, 1].map((f) => (
        <line key={f} x1={0} y1={base - f * BPH} x2={BW} y2={base - f * BPH} stroke="var(--admin-hairline-soft)" strokeWidth={1} />
      ))}
      <line x1={0} y1={base} x2={BW} y2={base} stroke="var(--admin-hairline)" strokeWidth={1} />
      {buckets.map((v, h) => {
        const bh = v === 0 ? 0 : Math.max(3, (v / max) * BPH);
        return (
          <g key={h}>
            <rect x={h * 20} y={BT} width={20} height={BPH} fill="transparent">
              <title>{`${String(h).padStart(2, "0")}:00 · ${v} ${unit}`}</title>
            </rect>
            {v > 0 && <rect x={h * 20 + 4} y={base - bh} width={12} height={bh} rx={3} fill="var(--admin-brand)" opacity={0.85} pointerEvents="none" />}
            {h % 3 === 0 && (
              <text x={h * 20 + 10} y={BH - 4} textAnchor="middle" fontSize={9} fill="var(--admin-ink-soft)">
                {String(h).padStart(2, "0")}
              </text>
            )}
          </g>
        );
      })}
    </svg>
  );
}

/* ── page ─────────────────────────────────────────────────────────────────── */

function OverviewPage() {
  const navigate = useNavigate();
  const [rangeDays, setRangeDays] = useState<RangeDays>(7);
  const series = SERIES[rangeDays];
  const rangeKm = Math.round(series.reduce((s, d) => s + d.km, 0));

  return (
    <div className="mx-auto max-w-7xl space-y-4 p-4 md:p-6">
      <PageHeader title="Apžvalga" description="Parkas iš pirmo žvilgsnio — būsena, įvykiai ir rida.">
        <AdminButton variant="secondary" onClick={() => void navigate({ to: "/app/reports" })}>Ataskaitos</AdminButton>
        <AdminButton onClick={() => void navigate({ to: "/app/map" })}>Žemėlapis</AdminButton>
      </PageHeader>

      {/* ── stat row ──────────────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard
          label="Aktyvūs įrenginiai"
          value={<><span>14</span><span className="text-base font-normal opacity-50"> / 16</span></>}
          hint="2 atsijungę"
          spark={[12, 13, 14, 13, 15, 14, 14]}
        />
        <StatCard
          label="Šiandien nuvažiuota"
          value={<>{fmtNumber(1246)} <span className="text-base font-normal opacity-50">km</span></>}
          delta={{ value: "+18%", tone: "up" }}
          hint="vs. vakar"
          spark={[988, 1102, 946, 1180, 1214, 1056, 1246]}
        />
        <StatCard
          label="Įvykiai (24 val.)"
          value="42"
          delta={{ value: "+9", tone: "flat" }}
          hint="vs. ankstesnės 24 val."
          spark={[31, 28, 36, 33, 40, 38, 42]}
        />
        <StatCard
          label="Kritiniai (24 val.)"
          value="3"
          delta={{ value: "−2", tone: "down" }}
          hint="vs. ankstesnės 24 val."
          spark={[5, 4, 6, 3, 5, 4, 3]}
        />
      </div>

      {/* ── fleet activity (area, 7/30/90 d) + events-by-kind donut ───────── */}
      <div className="grid gap-4 lg:grid-cols-3">
        <section className="admin-card lg:col-span-2">
          <div className="admin-hairline-b flex flex-wrap items-center justify-between gap-2 px-4 py-3">
            <div>
              <h2 className="text-sm font-semibold" style={{ color: "var(--admin-ink)" }}>Parko aktyvumas</h2>
              <p className="text-xs" style={{ color: "var(--admin-ink-soft)" }}>Nuvažiuoti kilometrai per dieną</p>
            </div>
            <div className="flex items-center gap-2">
              <Badge tone="brand">{fmtNumber(rangeKm)} km</Badge>
              <div className="flex gap-1">
                {RANGES.map((r) => (
                  <button
                    key={r}
                    type="button"
                    onClick={() => setRangeDays(r)}
                    aria-pressed={rangeDays === r}
                    className="rounded-md px-2.5 py-1 text-xs transition-colors"
                    style={{
                      background: rangeDays === r ? "var(--admin-brand-soft)" : "transparent",
                      color: rangeDays === r ? "var(--admin-brand)" : "var(--admin-ink-soft)",
                      fontWeight: rangeDays === r ? 600 : 500,
                    }}
                  >
                    {RANGE_LABEL[r]}
                  </button>
                ))}
              </div>
            </div>
          </div>
          <div className="p-4">
            <AreaChartSvg series={series} unit="km" />
          </div>
        </section>

        <section className="admin-card">
          <div className="admin-hairline-b px-4 py-3">
            <h2 className="text-sm font-semibold" style={{ color: "var(--admin-ink)" }}>Įvykiai (7 d.)</h2>
            <p className="text-xs" style={{ color: "var(--admin-ink-soft)" }}>Pagal tipą</p>
          </div>
          <div className="p-4">
            <DonutSvg breakdown={BREAKDOWN} centerValue={String(EVENTS_7D_TOTAL)} centerLabel="iš viso" />
            <ul className="mt-3 space-y-1.5">
              {BREAKDOWN.map((b, i) => (
                <li key={b.kind} className="flex items-center justify-between gap-2 text-xs">
                  <span className="flex min-w-0 items-center gap-2" style={{ color: "var(--admin-ink)" }}>
                    <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: kindColor(i) }} />
                    <span className="truncate">{b.kind}</span>
                  </span>
                  <span className="mono" style={{ color: "var(--admin-ink-soft)" }}>{b.count}</span>
                </li>
              ))}
            </ul>
          </div>
        </section>
      </div>

      {/* ── events by hour of day + latest-reporting devices ──────────────── */}
      <div className="grid gap-4 lg:grid-cols-3">
        <section className="admin-card lg:col-span-2">
          <div className="admin-hairline-b px-4 py-3">
            <h2 className="text-sm font-semibold" style={{ color: "var(--admin-ink)" }}>Aktyvumas per parą</h2>
            <p className="text-xs" style={{ color: "var(--admin-ink-soft)" }}>Įvykiai pagal paros valandą</p>
          </div>
          <div className="p-4">
            <HourlyBarsSvg buckets={HOURLY} unit="įvyk." />
          </div>
        </section>

        <section className="admin-card overflow-hidden">
          <div className="admin-hairline-b flex items-center justify-between px-4 py-3">
            <h2 className="text-sm font-semibold" style={{ color: "var(--admin-ink)" }}>Paskutiniai pranešę</h2>
            <AdminButton variant="ghost" size="sm" onClick={() => void navigate({ to: "/app/devices" })}>Rodyti visus</AdminButton>
          </div>
          <ul>
            {LATEST.map((d) => (
              <li key={d.name} className="admin-hairline-b flex items-center justify-between gap-3 px-4 py-2.5 text-sm last:border-b-0">
                <div className="min-w-0">
                  <div className="truncate font-medium" style={{ color: "var(--admin-ink)" }}>{d.name}</div>
                  <div className="truncate text-xs" style={{ color: "var(--admin-ink-soft)" }}>{d.sub}</div>
                </div>
                <Badge tone={STATUS_TONE[d.status]}>
                  <span className="h-1.5 w-1.5 rounded-full" style={{ background: "currentColor" }} aria-hidden />
                  {STATUS_LABEL[d.status]}
                </Badge>
              </li>
            ))}
          </ul>
        </section>
      </div>

      {/* ── recent events (severity icon + summary + kind badge + time) ───── */}
      <section className="admin-card overflow-hidden">
        <div className="admin-hairline-b flex items-center justify-between px-4 py-3">
          <h2 className="text-sm font-semibold" style={{ color: "var(--admin-ink)" }}>Paskutiniai įvykiai</h2>
          <AdminButton variant="ghost" size="sm" onClick={() => void navigate({ to: "/app/events" })}>Rodyti visus</AdminButton>
        </div>
        <ul>
          {RECENT.map((e) => {
            const Icon = SEVERITY_ICON[e.severity];
            return (
              <li key={e.id} className="admin-hairline-b flex items-center gap-3 px-4 py-2.5 text-sm last:border-b-0">
                <span
                  className="grid h-8 w-8 shrink-0 place-items-center rounded-full"
                  style={{
                    background: e.severity === "critical" ? "var(--admin-danger-soft)" : e.severity === "warning" ? "var(--admin-warning-soft)" : "var(--admin-info-soft)",
                    color: e.severity === "critical" ? "var(--admin-danger)" : e.severity === "warning" ? "var(--admin-warning)" : "var(--admin-info)",
                  }}
                  aria-hidden
                >
                  <Icon className="h-3.5 w-3.5" />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="truncate" style={{ color: "var(--admin-ink)" }}>{e.summary}</div>
                  <div className="truncate text-xs" style={{ color: "var(--admin-ink-soft)" }}>
                    {e.device} · {fmtDateTime(e.at)}
                  </div>
                </div>
                <Badge tone={e.severity === "critical" ? "danger" : e.severity === "warning" ? "warning" : "info"}>{e.kind}</Badge>
              </li>
            );
          })}
        </ul>
      </section>
    </div>
  );
}
