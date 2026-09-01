import { createFileRoute } from "@tanstack/react-router";
import * as React from "react";
import { PageHeader, AdminButton, Badge } from "@/components/admin/AdminKit";
import { GripVertical, Plus, RotateCcw } from "lucide-react";

export const Route = createFileRoute("/app/routing")({
  component: RoutingPage,
});

/** Mirrors the real Maršrutų planuoklė (apps/web app/routing): stop list left, route map right. */
const STOPS = [
  { n: 1, name: "Sandėlis · Kirtimai", coord: "54.6360, 25.3080" },
  { n: 2, name: "Klientas · Lentvaris", coord: "54.6440, 25.0540" },
  { n: 3, name: "Klientas · Vievis", coord: "54.7710, 24.8090" },
  { n: 4, name: "Terminalas · Kaunas", coord: "54.8985, 23.9036" },
];

function RoutingPage() {
  return (
    <div className="p-4 md:p-8">
      <PageHeader
        title="Maršrutų planuoklė"
        description="Optimali iki 12 sustojimų aplankymo tvarka realiais keliais — visame pasaulyje."
      />
      <div className="mt-6 grid gap-4 lg:grid-cols-[24rem_1fr]">
        <div className="admin-card flex flex-col">
          <div className="admin-hairline-b flex items-center justify-between px-4 py-3">
            <span className="text-sm font-semibold" style={{ color: "var(--admin-ink)" }}>Sustojimai</span>
            <div className="flex gap-2">
              <AdminButton variant="secondary" size="sm"><RotateCcw className="h-3.5 w-3.5" /> Iš naujo</AdminButton>
              <AdminButton size="sm">Optimizuoti</AdminButton>
            </div>
          </div>
          <ul>
            {STOPS.map((s) => (
              <li key={s.n} className="admin-hairline-b flex items-center gap-3 px-4 py-3">
                <GripVertical className="h-4 w-4 opacity-40" style={{ color: "var(--admin-ink-soft)" }} />
                <span
                  className="grid h-6 w-6 shrink-0 place-items-center rounded-full text-xs font-semibold"
                  style={{ background: "var(--admin-brand-soft)", color: "var(--admin-brand)" }}
                >
                  {s.n}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-medium" style={{ color: "var(--admin-ink)" }}>{s.name}</div>
                  <div className="mono text-[11px]" style={{ color: "var(--admin-ink-soft)" }}>{s.coord}</div>
                </div>
              </li>
            ))}
            <li className="px-4 py-3">
              <button className="inline-flex cursor-pointer items-center gap-1.5 text-sm" style={{ color: "var(--admin-brand)" }}>
                <Plus className="h-3.5 w-3.5" /> Pridėti sustojimą
              </button>
            </li>
          </ul>
          <div className="admin-hairline-t mt-auto grid grid-cols-3 gap-2 p-4 text-center">
            {[["ATSTUMAS", "128 km"], ["TRUKMĖ", "1 val 52 min"], ["SUSTOJIMAI", "4"]].map(([k, v]) => (
              <div key={k} className="rounded-md py-2" style={{ background: "var(--admin-surface-sunken)" }}>
                <div className="text-[10px] uppercase tracking-wider" style={{ color: "var(--admin-ink-soft)" }}>{k}</div>
                <div className="text-sm font-semibold" style={{ color: "var(--admin-ink)" }}>{v}</div>
              </div>
            ))}
          </div>
        </div>
        <div className="admin-card relative min-h-[480px] overflow-hidden">
          <RouteSketch />
          <Badge tone="brand" className="absolute right-4 top-4">OSRM · realūs keliai</Badge>
        </div>
      </div>
    </div>
  );
}

function RouteSketch() {
  const PATH = "M 720 120 C 620 150, 520 210, 430 260 S 300 330, 240 370 S 140 420, 90 450";
  const pts = [
    { x: 720, y: 120, n: 4 },
    { x: 430, y: 260, n: 3 },
    { x: 240, y: 370, n: 2 },
    { x: 90, y: 450, n: 1 },
  ];
  return (
    <svg viewBox="0 0 800 560" preserveAspectRatio="xMidYMid slice" className="h-full w-full" style={{ background: "var(--admin-surface-sunken)" }}>
      <defs>
        <pattern id="rgrid" width="40" height="40" patternUnits="userSpaceOnUse">
          <path d="M 40 0 L 0 0 0 40" fill="none" stroke="var(--admin-hairline)" strokeWidth="0.5" />
        </pattern>
      </defs>
      <rect width="800" height="560" fill="url(#rgrid)" />
      <path d="M 0 200 L 800 260 M 300 0 L 380 560 M 0 480 L 800 380" fill="none" stroke="var(--admin-hairline)" strokeWidth="4" opacity="0.6" />
      <path d={PATH} fill="none" stroke="var(--admin-brand)" strokeWidth="3" strokeLinecap="round" opacity="0.9" />
      {pts.map((p) => (
        <g key={p.n}>
          <circle cx={p.x} cy={p.y} r="11" fill="var(--admin-brand)" stroke="#fff" strokeWidth="2" />
          <text x={p.x} y={p.y + 4} textAnchor="middle" fontSize="11" fontWeight="700" fill="#fff">{p.n}</text>
        </g>
      ))}
    </svg>
  );
}
