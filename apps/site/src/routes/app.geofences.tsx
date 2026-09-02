import { createFileRoute } from "@tanstack/react-router";
import * as React from "react";
import { useTranslation } from "react-i18next";
import { Check, Circle as CircleIcon, Hexagon, MousePointerClick, Pencil, Route as RouteIcon, Search, Trash2, X } from "lucide-react";
import { PageHeader, AdminButton, Badge, AdminInput, AdminLabel } from "@/components/admin/AdminKit";
import { fmtDate } from "@/lib/admin-format";
import { DemoMap, type DemoZone } from "@/components/admin/DemoMap";
import { circleRing, type LngLat } from "@/lib/demo-geo";
import { demoZones, type DemoZoneDef, type DemoZoneKind } from "@/lib/demo-zones";

export const Route = createFileRoute("/app/geofences")({
  component: GeofencesPage,
});

// ── Demo mirror of the real app/geofences page: list + map, and a WORKING drawing tool ──
//
// The three mode buttons used to be decoration ("demo: static") while every hint string the tool
// needs — click each corner, close on the first point, drag to size the circle — was already
// translated into all four languages and shown nowhere. A visitor clicking "Polygon" on the page
// whose whole subject is drawing got no cursor, no shape and no message: the demo silently claimed
// the feature does not work. Drawing is the most-demonstrated thing this product does, so it is
// the last one that should be mimed.
//
// This is the demo's scale of the real tool, not a port of it: place points, close the ring, name
// it, save. What the product adds on top — dragging the vertices of a saved zone, refusing a
// self-intersecting ring, buffering a corridor server-side — is deliberately not here.

const KIND_ICON: Record<DemoZoneKind, typeof Hexagon> = {
  polygon: Hexagon,
  circle: CircleIcon,
  corridor: RouteIcon,
};

/** The reference palette — the same swatch row as the product's draft panel. */
const COLORS = ["#7C5CFC", "#059669", "#B45309", "#DC2626", "#0891B2", "#DB2777"];

/** Click the first vertex again to close the ring; "the same point" is a SCREEN distance. */
const CLOSE_PX = 14;

const zoneCoords = (z: DemoZoneDef): LngLat[] => z.ring ?? z.line ?? [];

/** Metres between two coordinates (haversine) — the circle tool's radius readout. */
function metres(a: LngLat, b: LngLat): number {
  const R = 6_371_000;
  const f1 = (a[1] * Math.PI) / 180;
  const f2 = (b[1] * Math.PI) / 180;
  const df = f2 - f1;
  const dl = ((b[0] - a[0]) * Math.PI) / 180;
  const h = Math.sin(df / 2) ** 2 + Math.cos(f1) * Math.cos(f2) * Math.sin(dl / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

function GeofencesPage() {
  const { t, i18n } = useTranslation("admin");
  const lang = i18n.language;
  const kindLabel = (k: DemoZoneKind): string => t(`geofences.${k}`);

  // the seeded zones follow the city the fleet drives in — a Warsaw map carrying a "Vilniaus bazė"
  // is the same mismatch the map page had, one screen further in
  const seeded = React.useMemo(() => demoZones(lang), [lang]);
  const [drawn, setDrawn] = React.useState<DemoZoneDef[]>([]);
  const [removed, setRemoved] = React.useState<string[]>([]);
  // Re-seeding on a language switch KEEPS what the visitor drew and deleted. Their own zone
  // vanishing because they changed language would be a worse bug than the one this page fixes.
  const zones = React.useMemo(
    () => [...seeded.filter((z) => !removed.includes(z.id)), ...drawn.filter((z) => !removed.includes(z.id))],
    [seeded, drawn, removed],
  );

  const [selectedId, setSelectedId] = React.useState<string | null>(null);
  const [q, setQ] = React.useState("");

  // ── the drawing tool ──
  const [draftKind, setDraftKind] = React.useState<DemoZoneKind | null>(null);
  const [pts, setPts] = React.useState<LngLat[]>([]);
  const [hover, setHover] = React.useState<LngLat | null>(null);
  const [hoverPx, setHoverPx] = React.useState<{ x: number; y: number } | null>(null);
  const [centre, setCentre] = React.useState<LngLat | null>(null);
  const [radiusM, setRadiusM] = React.useState(0);
  const [ready, setReady] = React.useState(false); // shape finished, waiting for a name + Save
  const [name, setName] = React.useState("");
  const [color, setColor] = React.useState(COLORS[0]);
  const [bufferM, setBufferM] = React.useState(150);
  const projectRef = React.useRef<((at: LngLat) => { x: number; y: number }) | null>(null);

  const drawing = draftKind !== null;

  const resetShape = React.useCallback(() => {
    setPts([]);
    setCentre(null);
    setRadiusM(0);
    setReady(false);
    setHover(null);
  }, []);

  const exitDraft = React.useCallback(() => {
    setDraftKind(null);
    resetShape();
    setName("");
  }, [resetShape]);

  const startDraft = (k: DemoZoneKind) => {
    setSelectedId(null);
    setDraftKind(k);
    resetShape();
    setName("");
    setColor(COLORS[zones.length % COLORS.length]);
  };

  // Escape wipes the sketch but stays in draft mode — the standard drawing-tool contract, and the
  // one the already-translated hint strings promise ("Esc — draw again")
  React.useEffect(() => {
    if (!drawing) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") resetShape();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [drawing, resetShape]);

  const onMapClick = (at: LngLat, point: { x: number; y: number }) => {
    if (!drawing || ready) return;
    if (draftKind === "circle") {
      // two clicks: the centre, then the edge — with the circle growing under the cursor between them
      if (centre === null) {
        setCentre(at);
        setRadiusM(0);
      } else if (radiusM > 0) {
        setReady(true);
      }
      return;
    }
    if (draftKind === "polygon" && pts.length >= 3) {
      const first = projectRef.current?.(pts[0]);
      if (first && Math.hypot(first.x - point.x, first.y - point.y) <= CLOSE_PX) {
        setReady(true);
        return;
      }
    }
    setPts((cur) => [...cur, at]);
  };

  const onMapMove = (at: LngLat, point: { x: number; y: number }) => {
    if (!drawing || ready) return;
    setHover(at);
    setHoverPx(point);
    if (draftKind === "circle" && centre !== null) setRadiusM(metres(centre, at));
  };

  const onMapDblClick = () => {
    if (!drawing || ready) return;
    if (draftKind === "polygon" && pts.length >= 3) setReady(true);
    if (draftKind === "corridor" && pts.length >= 2) setReady(true);
  };

  /** The shape as drawn so far, with the rubber-band segment out to the cursor. */
  const draftRing = React.useMemo<LngLat[] | null>(() => {
    if (draftKind === "circle" && centre !== null && radiusM > 0) return circleRing(centre, radiusM);
    if (draftKind === "polygon" && pts.length >= 2) {
      const live = ready || hover === null ? pts : [...pts, hover];
      return [...live, live[0]];
    }
    return null;
  }, [draftKind, centre, radiusM, pts, hover, ready]);

  const draftLine = React.useMemo<LngLat[] | null>(() => {
    if (draftKind !== "corridor" || pts.length === 0) return null;
    return ready || hover === null ? pts : [...pts, hover];
  }, [draftKind, pts, hover, ready]);

  const corridorWidth = Math.max(6, Math.round(bufferM / 25));

  const save = () => {
    const label = name.trim();
    if (label === "" || !ready || draftKind === null) return;
    const shape =
      draftKind === "circle" && centre !== null
        ? { ring: circleRing(centre, radiusM), radiusM: Math.round(radiusM) }
        : draftKind === "polygon"
          ? { ring: [...pts, pts[0]] }
          : { line: pts, corridorWidthPx: corridorWidth };
    const zone: DemoZoneDef = {
      id: `gf_${Date.now().toString(36)}`,
      name: label,
      kind: draftKind,
      color,
      created: new Date().toISOString(),
      ...shape,
    };
    setDrawn((cur) => [...cur, zone]);
    setSelectedId(zone.id);
    exitDraft();
  };

  const removeZone = (id: string) => {
    setRemoved((cur) => (cur.includes(id) ? cur : [...cur, id]));
    setSelectedId((cur) => (cur === id ? null : cur));
  };

  const filtered = zones.filter((z) => q.trim() === "" || z.name.toLowerCase().includes(q.trim().toLowerCase()));
  const selected = zones.find((z) => z.id === selectedId) ?? null;

  // solid editor-style zones (the live map draws them dashed; here they are the subject)
  const overlay: DemoZone[] = zones.map((z) => ({
    id: z.id,
    color: z.color,
    ring: z.ring,
    line: z.line,
    corridorWidthPx: z.corridorWidthPx,
    selected: z.id === selectedId,
  }));
  if (draftRing) overlay.push({ id: "draft-ring", color, ring: draftRing, selected: true });
  if (draftLine) overlay.push({ id: "draft-line", color, line: draftLine, corridorWidthPx: corridorWidth, selected: true });

  // frame the selected zone, or everything at once — but NEVER while drawing, which would yank the
  // map out from under the hand placing points
  const fit: LngLat[] = drawing ? [] : selected !== null ? zoneCoords(selected) : zones.flatMap(zoneCoords);

  return (
    <div className="flex h-[calc(100vh-3.5rem)] flex-col gap-3 p-4 md:p-6">
      <PageHeader title={t("geofences.title")} description={t("geofences.desc")} className="mb-0">
        <div className="flex gap-1">
          {(["polygon", "circle", "corridor"] as const).map((k) => (
            <AdminButton
              key={k}
              variant={draftKind === k ? "primary" : "secondary"}
              size="sm"
              onClick={() => (draftKind === k ? exitDraft() : startDraft(k))}
            >
              {t(`geofences.${k}`)}
            </AdminButton>
          ))}
        </div>
      </PageHeader>

      <div className="grid min-h-0 flex-1 grid-cols-1 gap-3 lg:grid-cols-[minmax(0,22rem)_1fr]">
        {/* aside: the draft panel while drawing, the zone list otherwise — the product's idiom.
            A sheet would cover the very map the user has to draw on. */}
        <aside className="admin-card flex min-h-0 flex-col overflow-hidden">
          {draftKind !== null ? (
            <div className="flex min-h-0 flex-col">
              <div className="admin-hairline-b p-3">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-semibold" style={{ color: "var(--admin-ink)" }}>{t("geofences.new")}</span>
                  <button
                    type="button"
                    onClick={exitDraft}
                    aria-label={t("admin.cancel")}
                    className="grid h-7 w-7 place-items-center rounded-md transition-colors hover:bg-[var(--admin-hairline)]"
                    style={{ color: "var(--admin-ink-soft)" }}
                  >
                    <X className="h-3.5 w-3.5" aria-hidden />
                  </button>
                </div>
                <p className="mt-1 text-xs" style={{ color: "var(--admin-ink-soft)" }}>{t("geofences.draftHint")}</p>
              </div>

              <div className="min-h-0 flex-1 space-y-3 overflow-auto p-3">
                <div
                  className="flex items-start gap-2 rounded-md p-2 text-xs"
                  style={{ background: "var(--admin-brand-soft)", color: "var(--admin-brand)" }}
                >
                  <MousePointerClick className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
                  <span>{t(`geofences.hint.${draftKind}`)}</span>
                </div>

                <div>
                  <AdminLabel htmlFor="gf-name">{t("geofences.name")}</AdminLabel>
                  <AdminInput id="gf-name" value={name} onChange={(e) => setName(e.target.value)} />
                </div>

                <div>
                  <AdminLabel>{t("geofences.color")}</AdminLabel>
                  <div className="mt-1 flex gap-1.5">
                    {COLORS.map((c) => (
                      <button
                        key={c}
                        type="button"
                        aria-label={c}
                        onClick={() => setColor(c)}
                        className="h-6 w-6 rounded-full transition-transform hover:scale-110"
                        style={{ background: c, outline: c === color ? "2px solid var(--admin-ink)" : "none", outlineOffset: "2px" }}
                      />
                    ))}
                  </div>
                </div>

                {draftKind === "circle" && ready && (
                  <div>
                    <AdminLabel htmlFor="gf-radius">{t("geofences.radius")}</AdminLabel>
                    <AdminInput
                      id="gf-radius"
                      type="number"
                      min={50}
                      step={50}
                      value={Math.round(radiusM)}
                      onChange={(e) => setRadiusM(Math.max(50, Number(e.target.value) || 0))}
                    />
                  </div>
                )}

                {draftKind === "corridor" && (
                  <div>
                    <AdminLabel htmlFor="gf-buffer">{t("geofences.buffer")}</AdminLabel>
                    <AdminInput
                      id="gf-buffer"
                      type="number"
                      min={25}
                      step={25}
                      value={bufferM}
                      onChange={(e) => setBufferM(Math.max(25, Number(e.target.value) || 0))}
                    />
                  </div>
                )}

                <div className="rounded-md p-2 text-xs" style={{ background: "var(--admin-hairline)", color: "var(--admin-ink-soft)" }}>
                  <div className="font-medium" style={{ color: "var(--admin-ink)" }}>
                    {ready ? t("geofences.drawnTitle") : t("geofences.drawing")}
                  </div>
                  <div className="mt-0.5">
                    {ready
                      ? name.trim() === ""
                        ? t("geofences.drawnNeedName")
                        : t("geofences.drawnReady")
                      : t(`geofences.typeHint.${draftKind}`)}
                  </div>
                </div>
              </div>

              <div className="admin-hairline-t flex gap-2 p-3">
                <AdminButton size="sm" onClick={save} disabled={!ready || name.trim() === ""}>
                  <Check className="h-3.5 w-3.5" aria-hidden />
                  {t("geofences.save")}
                </AdminButton>
                <AdminButton size="sm" variant="secondary" onClick={resetShape}>
                  {t("geofences.clear")}
                </AdminButton>
              </div>
            </div>
          ) : (
            <>
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
            </>
          )}
        </aside>

        {/* map panel */}
        <div className="admin-card relative min-h-[320px] overflow-hidden lg:min-h-0">
          <DemoMap
            className="h-full w-full min-h-[480px]"
            zones={overlay}
            handles={drawing ? (draftKind === "circle" ? (centre === null ? [] : [centre]) : pts) : []}
            fit={fit}
            fitPadding={60}
            drawing={drawing && !ready}
            projectRef={projectRef}
            onMapClick={onMapClick}
            onMapMove={onMapMove}
            onMapDblClick={onMapDblClick}
          />

          {/* the radius under the cursor, as the circle hint promises it */}
          {drawing && draftKind === "circle" && centre !== null && !ready && hoverPx !== null && radiusM > 0 && (
            <div
              className="pointer-events-none absolute z-10 rounded px-1.5 py-0.5 text-xs font-medium"
              style={{
                left: hoverPx.x + 14,
                top: hoverPx.y + 14,
                background: "var(--admin-surface)",
                color: "var(--admin-ink)",
                boxShadow: "var(--admin-shadow-lg)",
              }}
            >
              {radiusM >= 1000 ? `${(radiusM / 1000).toFixed(2)} km` : `${Math.round(radiusM)} m`}
            </div>
          )}

          {/* floating detail card for the selected zone */}
          {selected !== null && !drawing && (
            <div className="absolute bottom-4 left-4 right-4 z-10 md:right-auto md:w-80">
              <div className="admin-card p-4" style={{ boxShadow: "var(--admin-shadow-lg)" }}>
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="truncate font-semibold" style={{ color: "var(--admin-ink)" }}>{selected.name}</div>
                    <div className="text-xs" style={{ color: "var(--admin-ink-soft)" }}>
                      {t("geofences.createdAt", { date: fmtDate(selected.created) })} · {kindLabel(selected.kind)}
                      {selected.radiusM === undefined ? "" : ` · ${selected.radiusM} m`}
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
