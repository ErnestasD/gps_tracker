import { createFileRoute } from "@tanstack/react-router";
import * as React from "react";
import { useTranslation } from "react-i18next";
import { Circle as CircleIcon, Hexagon, Pencil, Route as RouteIcon, Search, Trash2 } from "lucide-react";
import { PageHeader, AdminButton, Badge, AdminInput } from "@/components/admin/AdminKit";
import { fmtDate } from "@/lib/admin-format";
import { DemoMap, type DemoZone } from "@/components/admin/DemoMap";
import { A1_CORRIDOR, DEPOT_POLYGON, SALDENE_CENTER, SALDENE_RADIUS_M, circleRing, type LngLat } from "@/lib/demo-geo";

export const Route = createFileRoute("/app/geofences")({
  component: GeofencesPage,
});

// ── Demo mirror of the real app/geofences page (list + map, zones drawn SOLID) ──

type ZoneKind = "polygon" | "circle" | "corridor";
type Zone = {
  id: string;
  name: string;
  kind: ZoneKind;
  color: string;
  created: string;
  /** closed ring for polygons/circles */
  ring?: LngLat[];
  /** centre-line for corridors, drawn as a wide band */
  line?: LngLat[];
  corridorWidthPx?: number;
};

const KIND_ICON: Record<ZoneKind, typeof Hexagon> = {
  polygon: Hexagon,
  circle: CircleIcon,
  corridor: RouteIcon,
};

const SALDENE_RING = circleRing(SALDENE_CENTER, SALDENE_RADIUS_M);

const ZONES: Zone[] = [
  {
    id: "gf_stl",
    name: "STL bazė",
    kind: "polygon",
    color: "#4F46E5",
    created: "2026-06-11T09:24:00Z",
    ring: DEPOT_POLYGON,
  },
  {
    id: "gf_saldene",
    name: "Saldėnė",
    kind: "circle",
    color: "#059669",
    created: "2026-07-02T14:05:00Z",
    ring: SALDENE_RING,
  },
  {
    id: "gf_a1",
    name: "Vilnius–Kaunas koridorius",
    kind: "corridor",
    color: "#B45309",
    created: "2026-07-19T07:48:00Z",
    line: A1_CORRIDOR,
    corridorWidthPx: 12,
  },
];

const zoneCoords = (z: Zone): LngLat[] => z.ring ?? z.line ?? [];

function GeofencesPage() {
  const { t } = useTranslation("admin");
  const kindLabel = (k: ZoneKind): string => t(`geofences.${k}`);
  const [zones, setZones] = React.useState<Zone[]>(ZONES);
  const [selectedId, setSelectedId] = React.useState<string | null>(null);
  const [q, setQ] = React.useState("");

  const filtered = zones.filter((z) => q.trim() === "" || z.name.toLowerCase().includes(q.trim().toLowerCase()));
  const selected = zones.find((z) => z.id === selectedId) ?? null;

  const removeZone = (id: string) => {
    setZones((zs) => zs.filter((z) => z.id !== id));
    setSelectedId((cur) => (cur === id ? null : cur));
  };

  // solid editor-style zones (the live map draws them dashed; here they're the subject)
  const demoZones: DemoZone[] = zones.map((z) => ({
    id: z.id,
    color: z.color,
    ring: z.ring,
    line: z.line,
    corridorWidthPx: z.corridorWidthPx,
    selected: z.id === selectedId,
  }));

  // frame the selected zone, or everything at once
  const fit: LngLat[] = selected !== null ? zoneCoords(selected) : zones.flatMap(zoneCoords);

  return (
    <div className="flex h-[calc(100vh-3.5rem)] flex-col gap-3 p-4 md:p-6">
      <PageHeader title={t("geofences.title")} description={t("geofences.desc")} className="mb-0">
        <div className="flex gap-1">
          {/* mode buttons double as draft entry points in the real app (demo: static) */}
          <AdminButton variant="secondary" size="sm">{t("geofences.polygon")}</AdminButton>
          <AdminButton variant="secondary" size="sm">{t("geofences.circle")}</AdminButton>
          <AdminButton variant="secondary" size="sm">{t("geofences.corridor")}</AdminButton>
        </div>
      </PageHeader>

      <div className="grid min-h-0 flex-1 grid-cols-1 gap-3 lg:grid-cols-[minmax(0,22rem)_1fr]">
        {/* aside: search + zone list */}
        <aside className="admin-card flex min-h-0 flex-col overflow-hidden">
          <div className="admin-hairline-b p-3">
            <div className="relative">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 opacity-60" aria-hidden />
              <AdminInput
                placeholder={t("geofences.search")}
                value={q}
                onChange={(e) => setQ(e.target.value)}
                className="pl-8"
                aria-label={t("geofences.search")}
              />
            </div>
          </div>
          <div className="min-h-0 flex-1 overflow-auto p-2">
            {zones.length === 0 ? (
              <p className="py-8 text-center text-sm" style={{ color: "var(--admin-ink-soft)" }}>
                {t("geofences.empty")}
              </p>
            ) : filtered.length === 0 ? (
              <p className="py-8 text-center text-sm" style={{ color: "var(--admin-ink-soft)" }}>
                {t("admin.nothingFound")}
              </p>
            ) : (
              <ul className="space-y-1">
                {filtered.map((z) => {
                  const KindIcon = KIND_ICON[z.kind];
                  const isSel = z.id === selectedId;
                  return (
                    <li
                      key={z.id}
                      className="flex cursor-pointer items-center gap-2 rounded-md border p-2 text-sm transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--admin-brand)]"
                      style={{
                        borderColor: isSel ? "var(--admin-brand)" : "var(--admin-hairline)",
                        background: isSel ? "var(--admin-brand-soft)" : "transparent",
                        color: isSel ? "var(--admin-brand)" : "var(--admin-ink)",
                      }}
                      onClick={() => setSelectedId((cur) => (cur === z.id ? null : z.id))}
                      tabIndex={0}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" || e.key === " ") {
                          e.preventDefault();
                          setSelectedId((cur) => (cur === z.id ? null : z.id));
                        }
                      }}
                      aria-selected={isSel}
                    >
                      {/* tinted icon chip by kind */}
                      <span className="grid h-7 w-7 shrink-0 place-items-center rounded-md" style={{ background: `${z.color}22`, color: z.color }} aria-hidden>
                        <KindIcon className="h-3.5 w-3.5" />
                      </span>
                      <span className="truncate font-medium">{z.name}</span>
                      <Badge tone="neutral" className="ml-auto">{kindLabel(z.kind)}</Badge>
                      <button
                        type="button"
                        aria-label={t("geofences.edit")}
                        className="grid h-7 w-7 shrink-0 place-items-center rounded-md transition-colors hover:bg-[var(--admin-brand-soft)]"
                        style={{ color: "var(--admin-ink-soft)" }}
                        onClick={(e) => {
                          e.stopPropagation();
                          setSelectedId(z.id);
                        }}
                      >
                        <Pencil className="h-3.5 w-3.5" aria-hidden />
                      </button>
                      <button
                        type="button"
                        aria-label={t("geofences.delete")}
                        className="grid h-7 w-7 shrink-0 place-items-center rounded-md transition-colors hover:bg-[var(--admin-danger-soft)]"
                        style={{ color: "var(--admin-danger)" }}
                        onClick={(e) => {
                          e.stopPropagation();
                          removeZone(z.id);
                        }}
                      >
                        <Trash2 className="h-3.5 w-3.5" aria-hidden />
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </aside>

        {/* map panel */}
        <div className="admin-card relative min-h-[320px] overflow-hidden lg:min-h-0">
          <DemoMap className="h-full w-full min-h-[480px]" zones={demoZones} fit={fit} fitPadding={60} />

          {/* floating detail card for the selected zone */}
          {selected !== null && (
            <div className="absolute bottom-4 left-4 right-4 z-10 md:right-auto md:w-80">
              <div className="admin-card p-4" style={{ boxShadow: "var(--admin-shadow-lg)" }}>
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="truncate font-semibold" style={{ color: "var(--admin-ink)" }}>{selected.name}</div>
                    <div className="text-xs" style={{ color: "var(--admin-ink-soft)" }}>
                      {t("geofences.createdAt", { date: fmtDate(selected.created) })} · {kindLabel(selected.kind)}
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => removeZone(selected.id)}
                    className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs transition-colors hover:bg-[var(--admin-danger-soft)]"
                    style={{ color: "var(--admin-danger)" }}
                  >
                    <Trash2 className="h-3 w-3" aria-hidden />
                    {t("geofences.delete")}
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
