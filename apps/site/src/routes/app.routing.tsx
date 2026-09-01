import { createFileRoute } from "@tanstack/react-router";
import { PageHeader, AdminButton, Badge } from "@/components/admin/AdminKit";
import { GripVertical, Plus, RotateCcw } from "lucide-react";
import { DemoMap, type DemoPin } from "@/components/admin/DemoMap";
import { A1_CORRIDOR } from "@/lib/demo-geo";

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

// Planned route along the REAL A1 motorway centre-line (Kaunas → Vilnius direction).
const PLAN_ROUTE = [...A1_CORRIDOR].reverse();

// Stop markers snapped to actual A1_CORRIDOR vertices near each stop's described place.
const STOP_PINS: DemoPin[] = [
  { id: "stop-1", at: A1_CORRIDOR[0], label: "1", color: "#7C7DF5" }, // Vilnius end
  { id: "stop-2", at: A1_CORRIDOR[21], label: "2", color: "#7C7DF5" }, // by Lentvaris
  { id: "stop-3", at: A1_CORRIDOR[34], label: "3", color: "#7C7DF5" }, // by Vievis
  { id: "stop-4", at: A1_CORRIDOR[A1_CORRIDOR.length - 1], label: "4", color: "#7C7DF5" }, // Kaunas
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
          <DemoMap
            className="h-full w-full min-h-[480px]"
            fit={PLAN_ROUTE}
            routes={[{ id: "plan", coords: PLAN_ROUTE, color: "#7C7DF5", widthPx: 3.5 }]}
            pins={STOP_PINS}
          />
          <Badge tone="brand" className="absolute right-4 top-4 z-10">OSRM · realūs keliai</Badge>
        </div>
      </div>
    </div>
  );
}
