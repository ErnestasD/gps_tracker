import { createFileRoute } from "@tanstack/react-router";
import * as React from "react";
import { Circle as CircleIcon, Hexagon, Pencil, Route as RouteIcon, Search, Trash2 } from "lucide-react";
import { PageHeader, AdminButton, Badge, AdminInput } from "@/components/admin/AdminKit";
import { fmtDate } from "@/lib/admin-format";

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
  /** polygon ring or corridor centre-line */
  points?: { lat: number; lng: number }[];
  center?: { lat: number; lng: number };
  radiusKm?: number;
};

const KIND_LABEL: Record<ZoneKind, string> = {
  polygon: "Poligonas",
  circle: "Apskritimas",
  corridor: "Koridorius",
};
const KIND_ICON: Record<ZoneKind, typeof Hexagon> = {
  polygon: Hexagon,
  circle: CircleIcon,
  corridor: RouteIcon,
};

const ZONES: Zone[] = [
  {
    id: "gf_stl",
    name: "STL bazė",
    kind: "polygon",
    color: "#4F46E5",
    created: "2026-06-11T09:24:00Z",
    points: [
      { lat: 54.712, lng: 25.09 },
      { lat: 54.728, lng: 25.185 },
      { lat: 54.688, lng: 25.235 },
      { lat: 54.648, lng: 25.175 },
      { lat: 54.662, lng: 25.08 },
    ],
  },
  {
    id: "gf_saldene",
    name: "Saldėnė",
    kind: "circle",
    color: "#059669",
    created: "2026-07-02T14:05:00Z",
    center: { lat: 54.925, lng: 23.955 },
    radiusKm: 7,
  },
  {
    id: "gf_a1",
    name: "Vilnius–Kaunas koridorius",
    kind: "corridor",
    color: "#B45309",
    created: "2026-07-19T07:48:00Z",
    points: [
      { lat: 54.687, lng: 25.279 },
      { lat: 54.732, lng: 25.05 },
      { lat: 54.771, lng: 24.808 },
      { lat: 54.787, lng: 24.655 },
      { lat: 54.808, lng: 24.442 },
      { lat: 54.856, lng: 24.2 },
      { lat: 54.898, lng: 23.96 },
    ],
  },
];

function GeofencesPage() {
  const [zones, setZones] = React.useState<Zone[]>(ZONES);
  const [selectedId, setSelectedId] = React.useState<string | null>(null);
  const [q, setQ] = React.useState("");

  const filtered = zones.filter((z) => q.trim() === "" || z.name.toLowerCase().includes(q.trim().toLowerCase()));
  const selected = zones.find((z) => z.id === selectedId) ?? null;

  const removeZone = (id: string) => {
    setZones((zs) => zs.filter((z) => z.id !== id));
    setSelectedId((cur) => (cur === id ? null : cur));
  };

  return (
    <div className="flex h-[calc(100vh-3.5rem)] flex-col gap-3 p-4 md:p-6">
      <PageHeader title="Geozonos" description="Braižomos zonos, kurios aktyvuoja taisykles ir įvykius." className="mb-0">
        <div className="flex gap-1">
          {/* mode buttons double as draft entry points in the real app (demo: static) */}
          <AdminButton variant="secondary" size="sm">Poligonas</AdminButton>
          <AdminButton variant="secondary" size="sm">Apskritimas</AdminButton>
          <AdminButton variant="secondary" size="sm">Koridorius</AdminButton>
        </div>
      </PageHeader>

      <div className="grid min-h-0 flex-1 grid-cols-1 gap-3 lg:grid-cols-[minmax(0,22rem)_1fr]">
        {/* aside: search + zone list */}
        <aside className="admin-card flex min-h-0 flex-col overflow-hidden">
          <div className="admin-hairline-b p-3">
            <div className="relative">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 opacity-60" aria-hidden />
              <AdminInput
                placeholder="Ieškoti geozonos…"
                value={q}
                onChange={(e) => setQ(e.target.value)}
                className="pl-8"
                aria-label="Ieškoti geozonos…"
              />
            </div>
          </div>
          <div className="min-h-0 flex-1 overflow-auto p-2">
            {zones.length === 0 ? (
              <p className="py-8 text-center text-sm" style={{ color: "var(--admin-ink-soft)" }}>
                Geozonų dar nėra — nubraižykite žemėlapyje.
              </p>
            ) : filtered.length === 0 ? (
              <p className="py-8 text-center text-sm" style={{ color: "var(--admin-ink-soft)" }}>
                Nieko nerasta
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
                      <Badge tone="neutral" className="ml-auto">{KIND_LABEL[z.kind]}</Badge>
                      <button
                        type="button"
                        aria-label="Redaguoti"
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
                        aria-label="Šalinti"
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
          <GeoMap zones={zones} selectedId={selectedId} onSelect={(id) => setSelectedId((cur) => (cur === id ? null : id))} />

          {/* floating detail card for the selected zone */}
          {selected !== null && (
            <div className="absolute bottom-4 left-4 right-4 z-10 md:right-auto md:w-80">
              <div className="admin-card p-4" style={{ boxShadow: "var(--admin-shadow-lg)" }}>
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="truncate font-semibold" style={{ color: "var(--admin-ink)" }}>{selected.name}</div>
                    <div className="text-xs" style={{ color: "var(--admin-ink-soft)" }}>
                      Sukurta {fmtDate(selected.created)} · {KIND_LABEL[selected.kind]}
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => removeZone(selected.id)}
                    className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs transition-colors hover:bg-[var(--admin-danger-soft)]"
                    style={{ color: "var(--admin-danger)" }}
                  >
                    <Trash2 className="h-3 w-3" aria-hidden />
                    Šalinti
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

// ── Procedural map sketch (approx. Lithuania), shared projection idiom with app.map.tsx ──

const W = 1000;
const H = 700;
const minLng = 21.5, maxLng = 27.0, minLat = 53.9, maxLat = 55.6;
const proj = (lat: number, lng: number) => ({
  x: ((lng - minLng) / (maxLng - minLng)) * W,
  y: H - ((lat - minLat) / (maxLat - minLat)) * H,
});
const kmToUnits = (H / (maxLat - minLat)) / 111;

function GeoMap({ zones, selectedId, onSelect }: { zones: Zone[]; selectedId: string | null; onSelect: (id: string) => void }) {
  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      preserveAspectRatio="xMidYMid slice"
      className="h-full w-full"
      style={{ background: "var(--admin-surface-sunken)" }}
      role="img"
      aria-label="Geozonų žemėlapis"
    >
      <defs>
        <pattern id="geo-grid" width="40" height="40" patternUnits="userSpaceOnUse">
          <path d="M 40 0 L 0 0 0 40" fill="none" stroke="var(--admin-hairline)" strokeWidth="0.5" />
        </pattern>
      </defs>
      <rect width={W} height={H} fill="url(#geo-grid)" />
      {/* faint roads */}
      <path d="M 0 380 C 200 340 340 420 500 360 S 800 340 1000 380" fill="none" stroke="var(--admin-hairline)" strokeWidth="6" />
      <path d="M 400 0 C 380 200 460 340 420 500 S 460 660 480 700" fill="none" stroke="var(--admin-hairline)" strokeWidth="5" />
      {/* city labels */}
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
            <text x={p.x + 8} y={p.y + 3} fontSize="11" fill="var(--admin-ink-soft)" fontFamily="Inter">{c.name}</text>
          </g>
        );
      })}

      {/* zones — SOLID fill + outline, thicker outline when selected (the editor idiom) */}
      {zones.map((z) => (
        <ZoneShape key={z.id} zone={z} isSelected={z.id === selectedId} onClick={() => onSelect(z.id)} />
      ))}
    </svg>
  );
}

function ZoneShape({ zone, isSelected, onClick }: { zone: Zone; isSelected: boolean; onClick: () => void }) {
  const strokeWidth = isSelected ? 4 : 2;
  if (zone.kind === "circle" && zone.center && zone.radiusKm) {
    const c = proj(zone.center.lat, zone.center.lng);
    const r = zone.radiusKm * kmToUnits;
    return (
      <g style={{ cursor: "pointer" }} onClick={(e) => { e.stopPropagation(); onClick(); }}>
        <circle cx={c.x} cy={c.y} r={r} fill={zone.color} opacity={0.15} />
        <circle cx={c.x} cy={c.y} r={r} fill="none" stroke={zone.color} strokeWidth={strokeWidth} />
      </g>
    );
  }
  if (!zone.points || zone.points.length === 0) return null;
  const pts = zone.points.map((p) => proj(p.lat, p.lng));
  const d = pts.map((p, i) => `${i === 0 ? "M" : "L"}${p.x},${p.y}`).join(" ");
  if (zone.kind === "corridor") {
    // the server stores a corridor as its buffered polygon — sketch that as a solid band
    return (
      <g style={{ cursor: "pointer" }} onClick={(e) => { e.stopPropagation(); onClick(); }}>
        <path d={d} fill="none" stroke={zone.color} strokeWidth={16} opacity={0.15} strokeLinecap="round" strokeLinejoin="round" />
        <path d={d} fill="none" stroke={zone.color} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" />
      </g>
    );
  }
  return (
    <g style={{ cursor: "pointer" }} onClick={(e) => { e.stopPropagation(); onClick(); }}>
      <path d={`${d} Z`} fill={zone.color} opacity={0.15} />
      <path d={`${d} Z`} fill="none" stroke={zone.color} strokeWidth={strokeWidth} strokeLinejoin="round" />
    </g>
  );
}
