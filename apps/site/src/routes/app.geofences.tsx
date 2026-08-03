import { createFileRoute } from "@tanstack/react-router";
import { fmtDate } from "@/lib/admin-format";
import * as React from "react";
import { Plus, Hexagon, Circle as CircleIcon, Route as RouteIcon, Trash2, Check, X, Search, Undo2 } from "lucide-react";
import { generateGeofences, type Geofence } from "@/lib/admin-mock";
import { PageHeader, AdminButton, Badge, AdminInput, AdminLabel, AdminRadio } from "@/components/admin/AdminKit";
import { toast } from "sonner";

export const Route = createFileRoute("/app/geofences")({
  component: GeofencesPage,
});

const SEED = generateGeofences();

// Map projection (approx. Lithuania) — shared with app.map.tsx.
const W = 1000;
const H = 700;
const minLng = 21.5, maxLng = 27.0, minLat = 53.9, maxLat = 55.6;
const proj = (lat: number, lng: number) => ({
  x: ((lng - minLng) / (maxLng - minLng)) * W,
  y: H - ((lat - minLat) / (maxLat - minLat)) * H,
});
const unproj = (x: number, y: number) => ({
  lng: minLng + (x / W) * (maxLng - minLng),
  lat: minLat + ((H - y) / H) * (maxLat - minLat),
});

type DraftType = "polygon" | "circle" | "corridor";
type Draft = {
  name: string;
  type: DraftType;
  color: string;
  points: { lat: number; lng: number }[];
  center?: { lat: number; lng: number };
  radiusKm?: number;
};

const COLORS = ["#4F46E5", "#059669", "#B45309", "#E11D48", "#0284C7", "#7C3AED"];

function GeofencesPage() {
  const [zones, setZones] = React.useState<Geofence[]>(SEED);
  const [selectedId, setSelectedId] = React.useState<string | null>(SEED[0]?.id ?? null);
  const [q, setQ] = React.useState("");
  const [draft, setDraft] = React.useState<Draft | null>(null);

  const filtered = zones.filter((z) => !q || z.name.toLowerCase().includes(q.toLowerCase()));
  const selected = zones.find((z) => z.id === selectedId) ?? null;

  const startDraft = () => {
    setDraft({ name: "", type: "polygon", color: COLORS[0], points: [] });
    setSelectedId(null);
  };
  const cancelDraft = () => setDraft(null);
  const finishDraft = () => {
    if (!draft) return;
    if (!draft.name.trim()) {
      toast.error("Įveskite pavadinimą");
      return;
    }
    if (draft.type === "circle" && (!draft.center || !draft.radiusKm)) {
      toast.error("Pažymėkite centrą ir spindulį");
      return;
    }
    if (draft.type !== "circle" && draft.points.length < (draft.type === "polygon" ? 3 : 2)) {
      toast.error(draft.type === "polygon" ? "Reikia bent 3 taškų" : "Reikia bent 2 taškų");
      return;
    }
    const id = `geo_${Date.now()}`;
    const newZone: Geofence = {
      id,
      name: draft.name.trim(),
      type: draft.type,
      color: draft.color,
      devices: 0,
      triggers: 0,
      created: new Date().toISOString(),
      points: draft.type !== "circle" ? draft.points : undefined,
      center: draft.type === "circle" ? draft.center : undefined,
      radiusKm: draft.type === "circle" ? draft.radiusKm : undefined,
    };
    setZones((zs) => [newZone, ...zs]);
    setSelectedId(id);
    setDraft(null);
    toast.success("Geozona sukurta (demo)");
  };

  const removeZone = (id: string) => {
    setZones((zs) => zs.filter((z) => z.id !== id));
    if (selectedId === id) setSelectedId(null);
    toast("Geozona pašalinta");
  };

  return (
    <div className="flex h-[calc(100vh-3.5rem)] flex-col">
      <div className="px-4 pt-4 pb-3 md:px-8">
        <PageHeader
          title="Geozonos"
          description="Braižomos zonos, kurios trigerina taisykles ir įvykius."
          className="mb-0"
        >
          {draft ? (
            <>
              <AdminButton variant="secondary" onClick={cancelDraft}>
                <X className="h-4 w-4" />Atšaukti
              </AdminButton>
              <AdminButton onClick={finishDraft}>
                <Check className="h-4 w-4" />Išsaugoti
              </AdminButton>
            </>
          ) : (
            <AdminButton onClick={startDraft}>
              <Plus className="h-4 w-4" />Nauja geozona
            </AdminButton>
          )}
        </PageHeader>
      </div>

      <div className="flex flex-1 min-h-0 flex-col md:flex-row md:gap-4 md:px-8 md:pb-8">
        {/* Left pane */}
        <aside className="admin-card flex flex-col md:w-96 md:shrink-0 mx-4 md:mx-0 mb-3 md:mb-0 min-h-0">
          {draft ? (
            <DraftPanel draft={draft} setDraft={setDraft} />
          ) : (
            <>
              <div className="admin-hairline-b p-3">
                <div className="relative">
                  <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 opacity-60" />
                  <AdminInput
                    placeholder="Ieškoti geozonos…"
                    value={q}
                    onChange={(e) => setQ(e.target.value)}
                    className="pl-8"
                  />
                </div>
              </div>
              <ul className="flex-1 overflow-y-auto">
                {filtered.map((z) => {
                  const isSel = z.id === selectedId;
                  return (
                    <li key={z.id}>
                      <button
                        onClick={() => setSelectedId(z.id)}
                        className="w-full px-3 py-2.5 text-left admin-hairline-b"
                        style={{ background: isSel ? "var(--admin-brand-soft)" : "transparent" }}
                      >
                        <div className="flex items-start justify-between gap-2">
                          <div className="flex min-w-0 flex-1 items-start gap-2.5">
                            <span className="mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-md" style={{ background: z.color + "22", color: z.color }}>
                              {z.type === "polygon" ? <Hexagon className="h-3.5 w-3.5" /> : z.type === "circle" ? <CircleIcon className="h-3.5 w-3.5" /> : <RouteIcon className="h-3.5 w-3.5" />}
                            </span>
                            <div className="min-w-0">
                              <div className="truncate text-sm font-medium" style={{ color: isSel ? "var(--admin-brand)" : "var(--admin-ink)" }}>
                                {z.name}
                              </div>
                              <div className="truncate text-xs" style={{ color: "var(--admin-ink-soft)" }}>
                                {z.devices} įrenginiai · {z.triggers} trigerių
                              </div>
                            </div>
                          </div>
                          <Badge tone="neutral">{z.type}</Badge>
                        </div>
                      </button>
                    </li>
                  );
                })}
                {filtered.length === 0 && (
                  <li className="p-6 text-center text-sm" style={{ color: "var(--admin-ink-soft)" }}>
                    Nieko nerasta
                  </li>
                )}
              </ul>
            </>
          )}
        </aside>

        {/* Map + details */}
        <div className="admin-card relative flex-1 overflow-hidden mx-4 md:mx-0 min-h-[400px]">
          <GeoMap
            zones={draft ? [] : zones}
            selectedId={selectedId}
            onSelect={setSelectedId}
            draft={draft}
            setDraft={setDraft}
          />

          {/* Detail card */}
          {!draft && selected && (
            <div className="absolute bottom-4 left-4 right-4 md:right-auto md:w-96">
              <div className="admin-card p-4" style={{ boxShadow: "var(--admin-shadow-lg)" }}>
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="font-semibold" style={{ color: "var(--admin-ink)" }}>{selected.name}</div>
                    <div className="text-xs" style={{ color: "var(--admin-ink-soft)" }}>
                      Sukurta {fmtDate(selected.created)} · {selected.type}
                    </div>
                  </div>
                  <button
                    onClick={() => removeZone(selected.id)}
                    className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs"
                    style={{ color: "var(--admin-danger)", background: "color-mix(in oklab, var(--admin-danger) 12%, transparent)" }}
                  >
                    <Trash2 className="h-3 w-3" /> Šalinti
                  </button>
                </div>
                <div className="mt-3 grid grid-cols-3 gap-2 text-center">
                  <Metric label="Įrenginiai" value={String(selected.devices)} />
                  <Metric label="Trigeriai" value={String(selected.triggers)} />
                  <Metric label={selected.type === "circle" ? "Spindulys" : "Taškai"} value={selected.type === "circle" ? `${selected.radiusKm ?? 0} km` : String(selected.points?.length ?? 0)} />
                </div>
              </div>
            </div>
          )}

          {/* Draw hint */}
          {draft && (
            <div className="pointer-events-none absolute left-4 top-4 rounded-md px-3 py-2 text-xs" style={{ background: "var(--admin-surface)", color: "var(--admin-ink)", boxShadow: "var(--admin-shadow)" }}>
              {draft.type === "circle"
                ? draft.center
                  ? "Spustelėkite dar kartą — nustatykite spindulį"
                  : "Spustelėkite žemėlapyje — pažymėkite centrą"
                : draft.type === "polygon"
                  ? `Spustelėkite žemėlapyje — pridėkite taškus (${draft.points.length})`
                  : `Spustelėkite — pridėkite maršruto tašką (${draft.points.length})`}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md py-1.5" style={{ background: "var(--admin-surface-sunken)" }}>
      <div className="text-[10px] uppercase tracking-wider" style={{ color: "var(--admin-ink-soft)" }}>{label}</div>
      <div className="text-sm font-semibold" style={{ color: "var(--admin-ink)" }}>{value}</div>
    </div>
  );
}

function DraftPanel({ draft, setDraft }: { draft: Draft; setDraft: (d: Draft | null) => void }) {
  const undoPoint = () => setDraft({ ...draft, points: draft.points.slice(0, -1) });
  const clearGeom = () => setDraft({ ...draft, points: [], center: undefined, radiusKm: undefined });
  return (
    <div className="flex flex-col gap-4 p-4">
      <div>
        <div className="text-sm font-semibold" style={{ color: "var(--admin-ink)" }}>Nauja geozona</div>
        <div className="text-xs" style={{ color: "var(--admin-ink-soft)" }}>Užpildykite duomenis ir braižykite žemėlapyje.</div>
      </div>
      <div>
        <AdminLabel>Pavadinimas</AdminLabel>
        <AdminInput
          placeholder="pvz. Vilnius Depot"
          value={draft.name}
          onChange={(e) => setDraft({ ...draft, name: e.target.value })}
        />
      </div>
      <div>
        <AdminLabel>Tipas</AdminLabel>
        <AdminRadio
          name="gtype"
          value={draft.type}
          onChange={(v) => setDraft({ ...draft, type: v as DraftType, points: [], center: undefined, radiusKm: undefined })}
          options={[
            { value: "polygon", label: "Poligonas", hint: "≥3 taškai" },
            { value: "circle", label: "Apskritimas", hint: "centras + spindulys" },
            { value: "corridor", label: "Koridorius", hint: "maršruto linija" },
          ]}
        />
      </div>
      <div>
        <AdminLabel>Spalva</AdminLabel>
        <div className="flex gap-2">
          {COLORS.map((c) => (
            <button
              key={c}
              type="button"
              onClick={() => setDraft({ ...draft, color: c })}
              className="h-7 w-7 rounded-full transition-transform"
              style={{
                background: c,
                outline: draft.color === c ? `2px solid ${c}` : "none",
                outlineOffset: 2,
                transform: draft.color === c ? "scale(1.08)" : "scale(1)",
              }}
              aria-label={c}
            />
          ))}
        </div>
      </div>
      <div className="flex gap-2">
        <AdminButton type="button" variant="secondary" onClick={undoPoint} disabled={draft.points.length === 0}>
          <Undo2 className="h-3.5 w-3.5" />Atšaukti tašką
        </AdminButton>
        <AdminButton type="button" variant="secondary" onClick={clearGeom}>
          Išvalyti
        </AdminButton>
      </div>
      <div className="rounded-md p-2 text-xs" style={{ background: "var(--admin-surface-sunken)", color: "var(--admin-ink-soft)" }}>
        {draft.type === "circle"
          ? draft.center && draft.radiusKm
            ? `Centras nustatytas, spindulys ${draft.radiusKm} km.`
            : draft.center
              ? "Centras nustatytas. Spustelėkite dar — pasirinkite spindulį."
              : "Spustelėkite žemėlapyje — pažymėkite centrą."
          : draft.type === "polygon"
            ? `Taškai: ${draft.points.length}. Reikia ≥3.`
            : `Maršruto taškai: ${draft.points.length}. Reikia ≥2.`}
      </div>
    </div>
  );
}

function GeoMap({
  zones,
  selectedId,
  onSelect,
  draft,
  setDraft,
}: {
  zones: Geofence[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  draft: Draft | null;
  setDraft: (d: Draft) => void;
}) {
  const svgRef = React.useRef<SVGSVGElement>(null);

  const handleClick = (e: React.MouseEvent<SVGSVGElement>) => {
    if (!draft) return;
    const svg = svgRef.current;
    if (!svg) return;
    const rect = svg.getBoundingClientRect();
    // Map click coords to viewBox coords, accounting for slice preserveAspectRatio.
    const scale = Math.max(W / rect.width, H / rect.height);
    const drawW = rect.width * scale;
    const drawH = rect.height * scale;
    const offX = (drawW - W) / 2;
    const offY = (drawH - H) / 2;
    const localX = (e.clientX - rect.left) * scale - offX;
    const localY = (e.clientY - rect.top) * scale - offY;
    const { lat, lng } = unproj(localX, localY);

    if (draft.type === "circle") {
      if (!draft.center) {
        setDraft({ ...draft, center: { lat, lng } });
      } else {
        // Radius = distance from center to click (approx km via degrees).
        const dLat = lat - draft.center.lat;
        const dLng = (lng - draft.center.lng) * Math.cos((draft.center.lat * Math.PI) / 180);
        const km = Math.max(1, Math.round(Math.sqrt(dLat * dLat + dLng * dLng) * 111));
        setDraft({ ...draft, radiusKm: km });
      }
    } else {
      setDraft({ ...draft, points: [...draft.points, { lat, lng }] });
    }
  };

  return (
    <svg
      ref={svgRef}
      viewBox={`0 0 ${W} ${H}`}
      preserveAspectRatio="xMidYMid slice"
      className="h-full w-full"
      style={{ background: "var(--admin-surface-sunken)", cursor: draft ? "crosshair" : "default" }}
      onClick={handleClick}
    >
      <defs>
        <pattern id="geo-grid" width="40" height="40" patternUnits="userSpaceOnUse">
          <path d="M 40 0 L 0 0 0 40" fill="none" stroke="var(--admin-hairline)" strokeWidth="0.5" />
        </pattern>
      </defs>
      <rect width={W} height={H} fill="url(#geo-grid)" />
      {/* fake highways */}
      <path d="M 0 380 C 200 340 340 420 500 360 S 800 340 1000 380" fill="none" stroke="var(--admin-hairline)" strokeWidth="6" />
      <path d="M 400 0 C 380 200 460 340 420 500 S 460 660 480 700" fill="none" stroke="var(--admin-hairline)" strokeWidth="5" />
      {/* City labels */}
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

      {/* Existing zones */}
      {zones.map((z) => (
        <ZoneShape key={z.id} zone={z} isSelected={z.id === selectedId} onClick={() => onSelect(z.id)} />
      ))}

      {/* Draft preview */}
      {draft && <DraftShape draft={draft} />}
    </svg>
  );
}

function ZoneShape({ zone, isSelected, onClick }: { zone: Geofence; isSelected: boolean; onClick: () => void }) {
  const opacity = isSelected ? 0.35 : 0.18;
  const strokeWidth = isSelected ? 2.5 : 1.5;
  if (zone.type === "circle" && zone.center && zone.radiusKm) {
    const c = proj(zone.center.lat, zone.center.lng);
    // Approximate radius in SVG units (1 lat degree ≈ 111 km → map that ratio).
    const kmToUnits = (H / (maxLat - minLat)) / 111;
    const r = zone.radiusKm * kmToUnits;
    return (
      <g style={{ cursor: "pointer" }} onClick={(e) => { e.stopPropagation(); onClick(); }}>
        <circle cx={c.x} cy={c.y} r={r} fill={zone.color} opacity={opacity} />
        <circle cx={c.x} cy={c.y} r={r} fill="none" stroke={zone.color} strokeWidth={strokeWidth} />
        <circle cx={c.x} cy={c.y} r={3} fill={zone.color} />
        <text x={c.x + 6} y={c.y - 6} fontSize="11" fill="var(--admin-ink)" fontFamily="Inter" style={{ pointerEvents: "none" }}>{zone.name}</text>
      </g>
    );
  }
  if (!zone.points || zone.points.length === 0) return null;
  const pts = zone.points.map((p) => proj(p.lat, p.lng));
  const d = pts.map((p, i) => `${i === 0 ? "M" : "L"}${p.x},${p.y}`).join(" ");
  const label = pts[0];
  if (zone.type === "corridor") {
    return (
      <g style={{ cursor: "pointer" }} onClick={(e) => { e.stopPropagation(); onClick(); }}>
        <path d={d} fill="none" stroke={zone.color} strokeWidth={isSelected ? 14 : 10} opacity={opacity} strokeLinecap="round" strokeLinejoin="round" />
        <path d={d} fill="none" stroke={zone.color} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" />
        <text x={label.x + 6} y={label.y - 6} fontSize="11" fill="var(--admin-ink)" fontFamily="Inter" style={{ pointerEvents: "none" }}>{zone.name}</text>
      </g>
    );
  }
  return (
    <g style={{ cursor: "pointer" }} onClick={(e) => { e.stopPropagation(); onClick(); }}>
      <path d={d + " Z"} fill={zone.color} opacity={opacity} />
      <path d={d + " Z"} fill="none" stroke={zone.color} strokeWidth={strokeWidth} strokeLinejoin="round" />
      <text x={label.x + 6} y={label.y - 6} fontSize="11" fill="var(--admin-ink)" fontFamily="Inter" style={{ pointerEvents: "none" }}>{zone.name}</text>
    </g>
  );
}

function DraftShape({ draft }: { draft: Draft }) {
  if (draft.type === "circle") {
    if (!draft.center) return null;
    const c = proj(draft.center.lat, draft.center.lng);
    const kmToUnits = (H / (maxLat - minLat)) / 111;
    const r = (draft.radiusKm ?? 0) * kmToUnits;
    return (
      <g>
        {r > 0 && <>
          <circle cx={c.x} cy={c.y} r={r} fill={draft.color} opacity={0.25} />
          <circle cx={c.x} cy={c.y} r={r} fill="none" stroke={draft.color} strokeWidth={2} strokeDasharray="6 4" />
        </>}
        <circle cx={c.x} cy={c.y} r={4} fill={draft.color} stroke="#fff" strokeWidth={1.5} />
      </g>
    );
  }
  if (draft.points.length === 0) return null;
  const pts = draft.points.map((p) => proj(p.lat, p.lng));
  const d = pts.map((p, i) => `${i === 0 ? "M" : "L"}${p.x},${p.y}`).join(" ");
  const closed = draft.type === "polygon" && draft.points.length >= 3;
  return (
    <g>
      {draft.type === "polygon" ? (
        <path d={closed ? d + " Z" : d} fill={closed ? draft.color : "none"} fillOpacity={0.2} stroke={draft.color} strokeWidth={2} strokeDasharray="6 4" strokeLinejoin="round" />
      ) : (
        <path d={d} fill="none" stroke={draft.color} strokeWidth={3} strokeDasharray="6 4" strokeLinecap="round" strokeLinejoin="round" />
      )}
      {pts.map((p, i) => (
        <circle key={i} cx={p.x} cy={p.y} r={4} fill="#fff" stroke={draft.color} strokeWidth={2} />
      ))}
    </g>
  );
}
