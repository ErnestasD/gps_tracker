import { useEffect, useRef, useState } from "react";
import "maplibre-gl/dist/maplibre-gl.css";

// Free, CORS-friendly dark vector style (Carto Dark Matter).
const DEFAULT_STYLE =
  (import.meta as any).env?.VITE_TILES_STYLE_URL ||
  "https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json";

export interface TabMapProps {
  styleUrl?: string | Record<string, any>;
  center: [number, number]; // [lng, lat]
  zoom?: number;
  markers?: Array<{
    lng: number;
    lat: number;
    label: string;
    color: string;
    highlighted?: boolean;
  }>;
  routes?: Array<{
    id: string;
    coordinates: [number, number][];
    color: string;
    dashed?: boolean;
    width?: number;
  }>;
  circles?: Array<{
    id: string;
    center: [number, number];
    radiusMeters: number;
    color: string;
    label?: string;
  }>;
  polygons?: Array<{
    id: string;
    coordinates: [number, number][]; // ring
    color: string;
    label?: string;
  }>;
  animatedVehicles?: Array<{
    id: string;
    path: [number, number][];
    currentPosition?: [number, number];
    color: string;
    label: string;
    highlighted?: boolean;
    /** seconds to traverse the full path once (loops) */
    durationSec?: number;
    /** show the underlying corridor as a faint dashed line */
    showTrail?: boolean;
  }>;
  showZoomControls?: boolean;
  className?: string;
}

function metersToPixelsAtLat(meters: number, lat: number, zoom: number) {
  const earth = 40075016.686;
  return (meters / (earth * Math.cos((lat * Math.PI) / 180))) * Math.pow(2, zoom + 8);
}

// Render (or re-render) a chip marker's inner HTML based on current color / highlighted.
function renderChip(
  el: HTMLElement,
  opts: { color: string; label: string; highlighted?: boolean; ringSize?: number },
) {
  const { color, label, highlighted } = opts;
  const chipShadow = highlighted
    ? `box-shadow:0 0 0 2px ${color}77, 0 0 18px ${color}aa, 0 4px 14px rgba(0,0,0,0.5);`
    : `box-shadow:0 4px 12px rgba(0,0,0,0.4);`;
  const chipBackground = highlighted
    ? `linear-gradient(180deg, ${color}2e, rgba(15,23,42,0.98))`
    : `#0F172A`;
  el.innerHTML = `
    <span style="position:absolute;left:0;top:0;transform:translate(-11px,-50%);display:inline-flex;align-items:center;gap:6px;padding:4px 8px;border-radius:6px;background:${chipBackground};border:${highlighted ? "1.5px" : "1.25px"} solid ${color};font-family:'JetBrains Mono',ui-monospace,monospace;font-size:10px;color:${color};white-space:nowrap;transition:box-shadow 120ms ease, background 120ms ease;${chipShadow}">
      <span style="display:inline-block;width:6px;height:6px;border-radius:999px;background:${color};${highlighted ? `box-shadow:0 0 8px ${color};animation:tabmap-pulse-dot 1.4s ease-in-out infinite;` : ""}"></span>${label}
    </span>`;
}

function sClamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function nearestDistanceOnPath(
  path: [number, number][],
  segLens: number[],
  point: [number, number],
) {
  let bestDistance = 0;
  let bestSq = Number.POSITIVE_INFINITY;
  let walked = 0;

  for (let i = 0; i < path.length - 1; i++) {
    const [ax, ay] = path[i];
    const [bx, by] = path[i + 1];
    const vx = bx - ax;
    const vy = by - ay;
    const segSq = vx * vx + vy * vy;
    const t = segSq > 0 ? sClamp(((point[0] - ax) * vx + (point[1] - ay) * vy) / segSq, 0, 1) : 0;
    const px = ax + vx * t;
    const py = ay + vy * t;
    const sq = (point[0] - px) ** 2 + (point[1] - py) ** 2;

    if (sq < bestSq) {
      bestSq = sq;
      bestDistance = walked + (segLens[i] ?? 0) * t;
    }
    walked += segLens[i] ?? 0;
  }

  return bestDistance;
}

function pointAtDistance(
  path: [number, number][],
  segLens: number[],
  dist: number,
): [number, number] {
  let d = sClamp(dist, 0, segLens.reduce((a, b) => a + b, 0));
  for (let i = 0; i < segLens.length; i++) {
    if (d <= segLens[i] || i === segLens.length - 1) {
      const t = segLens[i] > 0 ? d / segLens[i] : 0;
      const [ax, ay] = path[i];
      const [bx, by] = path[i + 1];
      return [ax + (bx - ax) * t, ay + (by - ay) * t];
    }
    d -= segLens[i];
  }
  return path[path.length - 1];
}

export function TabMap({
  styleUrl,
  center,
  zoom = 6,
  markers = [],
  routes = [],
  circles = [],
  polygons = [],
  animatedVehicles = [],
  showZoomControls = false,
  className,
}: TabMapProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<any>(null);
  const rafRef = useRef<number | null>(null);
  const [ready, setReady] = useState(false);

  // Refs to marker DOM elements keyed by id/label so we can restyle without
  // rebuilding the map when only `highlighted`/`color` change.
  const staticElsRef = useRef<Record<string, HTMLElement>>({});
  const animElsRef = useRef<Record<string, HTMLElement>>({});

  // Keep the latest props visible to the persistent animation loop.
  const animPropsRef = useRef(animatedVehicles);
  animPropsRef.current = animatedVehicles;
  const markerPropsRef = useRef(markers);
  markerPropsRef.current = markers;

  // Build a "structural" signature so the map only rebuilds when things that
  // actually require re-init change (paths, positions, labels), NOT when
  // `highlighted`/`color` flip on selection.
  const markersSig = JSON.stringify(markers.map((m) => ({ l: m.label, x: m.lng, y: m.lat })));
  const animSig = JSON.stringify(
    animatedVehicles.map((v) => ({ id: v.id, l: v.label, p: v.path, cp: v.currentPosition, d: v.durationSec, t: v.showTrail })),
  );

  useEffect(() => {
    if (typeof window === "undefined") return;
    let mounted = true;
    let map: any = null;

    (async () => {
      const maplibregl = (await import("maplibre-gl")).default;
      if (!mounted || !containerRef.current) return;

      map = new maplibregl.Map({
        container: containerRef.current,
        style: styleUrl || DEFAULT_STYLE,
        center,
        zoom,
        attributionControl: false,
        interactive: true,
        dragRotate: false,
        pitchWithRotate: false,
      });
      map.scrollZoom.disable();
      map.touchZoomRotate.disableRotation();

      mapRef.current = map;

      // Inject shared keyframes for highlighted marker pulse (once).
      if (typeof document !== "undefined" && !document.getElementById("tabmap-pulse-kf")) {
        const s = document.createElement("style");
        s.id = "tabmap-pulse-kf";
        s.textContent = `
@keyframes tabmap-pulse-dot {
  0%, 100% { transform: scale(1); }
  50% { transform: scale(1.35); }
}`;
        document.head.appendChild(s);
      }

      map.on("load", () => {
        // Routes
        routes.forEach((r) => {
          map.addSource(r.id, {
            type: "geojson",
            data: {
              type: "Feature",
              properties: {},
              geometry: { type: "LineString", coordinates: r.coordinates },
            },
          });
          map.addLayer({
            id: `${r.id}-line`,
            type: "line",
            source: r.id,
            layout: { "line-cap": "round", "line-join": "round" },
            paint: {
              "line-color": r.color,
              "line-width": r.width ?? 3,
              ...(r.dashed ? { "line-dasharray": [2, 1.5] } : {}),
            },
          });
        });

        // Polygons
        polygons.forEach((p) => {
          map.addSource(p.id, {
            type: "geojson",
            data: {
              type: "Feature",
              properties: {},
              geometry: { type: "Polygon", coordinates: [p.coordinates] },
            },
          });
          map.addLayer({
            id: `${p.id}-fill`,
            type: "fill",
            source: p.id,
            paint: { "fill-color": p.color, "fill-opacity": 0.18 },
          });
          map.addLayer({
            id: `${p.id}-outline`,
            type: "line",
            source: p.id,
            paint: {
              "line-color": p.color,
              "line-width": 1.5,
              "line-dasharray": [3, 2],
            },
          });
        });

        // Circle geofences
        circles.forEach((c) => {
          map.addSource(c.id, {
            type: "geojson",
            data: {
              type: "Feature",
              properties: { radius: c.radiusMeters },
              geometry: { type: "Point", coordinates: c.center },
            },
          });
          map.addLayer({
            id: `${c.id}-fill`,
            type: "circle",
            source: c.id,
            paint: {
              "circle-color": c.color,
              "circle-opacity": 0.18,
              "circle-radius": [
                "interpolate",
                ["exponential", 2],
                ["zoom"],
                0,
                0,
                22,
                metersToPixelsAtLat(c.radiusMeters, c.center[1], 22),
              ],
              "circle-stroke-color": c.color,
              "circle-stroke-width": 1.5,
              "circle-stroke-opacity": 0.9,
            },
          });
        });

        // Static HTML markers
        staticElsRef.current = {};
        markers.forEach((m) => {
          const el = document.createElement("div");
          el.style.cssText = `position:relative;width:0;height:0;overflow:visible;line-height:1;`;
          renderChip(el, { color: m.color, label: m.label, highlighted: m.highlighted, ringSize: 44 });
          staticElsRef.current[m.label] = el;
          new maplibregl.Marker({ element: el, anchor: "center" })
            .setLngLat([m.lng, m.lat])
            .addTo(map);
        });

        // Geofence labels
        [...circles, ...polygons].forEach((g: any) => {
          if (!g.label) return;
          const c = g.center ?? centroid(g.coordinates);
          const el = document.createElement("div");
          el.style.cssText = `
            padding:3px 7px;border-radius:4px;
            background:rgba(15,23,42,0.9);border:1px solid ${g.color};
            font-family:'JetBrains Mono',ui-monospace,monospace;
            font-size:9px;letter-spacing:0.08em;text-transform:uppercase;
            color:${g.color};pointer-events:none;
          `;
          el.textContent = g.label;
          new maplibregl.Marker({ element: el, anchor: "center" })
            .setLngLat(c)
            .addTo(map);
        });

        // Animated vehicles
        animElsRef.current = {};
        if (animatedVehicles.length > 0) {
          // Static route corridors. No trailing segments — vehicles move
          // back and forth on top of these fixed route lines.
          animatedVehicles.forEach((v) => {
            if (!v.showTrail) return;
            const trailId = `${v.id}-trail`;
            map.addSource(trailId, {
              type: "geojson",
              data: {
                type: "Feature",
                properties: {},
                geometry: { type: "LineString", coordinates: v.path },
              },
            });
            map.addLayer({
              id: `${trailId}-line`,
              type: "line",
              source: trailId,
              layout: { "line-cap": "butt", "line-join": "round" },
              paint: {
                "line-color": v.color,
                "line-width": v.highlighted ? 2.4 : 1.4,
                "line-opacity": v.highlighted ? 0.85 : 0.35,
                "line-dasharray": [2, 2],
              },
            });

          });

          const vehState = animatedVehicles.map((v) => {
            const segLens: number[] = [];
            let total = 0;
            for (let i = 0; i < v.path.length - 1; i++) {
              const [ax, ay] = v.path[i];
              const [bx, by] = v.path[i + 1];
              const d = Math.hypot(bx - ax, by - ay);
              segLens.push(d);
              total += d;
            }
            const initialDist = v.currentPosition
              ? nearestDistanceOnPath(v.path, segLens, v.currentPosition)
              : 0;
            const initialPosition = pointAtDistance(v.path, segLens, initialDist);
            const offset = sClamp(total > 0 ? (initialDist / total) * 0.5 : 0, 0, 0.5);
            const el = document.createElement("div");
            el.style.cssText = `position:relative;width:0;height:0;overflow:visible;line-height:1;`;
            renderChip(el, { color: v.color, label: v.label, highlighted: v.highlighted, ringSize: 48 });
            animElsRef.current[v.id] = el;
            const marker = new maplibregl.Marker({ element: el, anchor: "center" })
              .setLngLat(initialPosition)
              .addTo(map);
            return { id: v.id, segLens, total, marker, offset, path: v.path };
          });

          const t0 = performance.now();
          const tick = (now: number) => {
            const currentAnim = animPropsRef.current;
            for (const s of vehState) {
              const v = currentAnim.find((x) => x.id === s.id);
              if (!v) continue;
              const dur = (v.durationSec ?? 90) * 1000;
              const raw = ((now - t0) / dur + s.offset) % 1;
              const p = raw < 0.5 ? raw * 2 : (1 - raw) * 2;
              const current = pointAtDistance(s.path, s.segLens, p * s.total);
              s.marker.setLngLat(current);
            }
            rafRef.current = requestAnimationFrame(tick);
          };
          rafRef.current = requestAnimationFrame(tick);
        }


        setReady(true);
      });
    })();

    return () => {
      mounted = false;
      if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
      staticElsRef.current = {};
      animElsRef.current = {};
      if (map) map.remove();
      mapRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [JSON.stringify(center), zoom, markersSig, JSON.stringify(routes), JSON.stringify(circles), JSON.stringify(polygons), animSig]);

  // Lightweight restyle when only highlighted/color change — no map rebuild.
  useEffect(() => {
    if (!ready) return;
    markers.forEach((m) => {
      const el = staticElsRef.current[m.label];
      if (el) renderChip(el, { color: m.color, label: m.label, highlighted: m.highlighted, ringSize: 44 });
    });
    animatedVehicles.forEach((v) => {
      const el = animElsRef.current[v.id];
      if (el) renderChip(el, { color: v.color, label: v.label, highlighted: v.highlighted, ringSize: 48 });
      // Update trail color too, if the trail layer exists.
      const map = mapRef.current;
      if (map && v.showTrail && map.getLayer(`${v.id}-trail-line`)) {
        try {
          map.setPaintProperty(`${v.id}-trail-line`, "line-color", v.color);
          map.setPaintProperty(`${v.id}-trail-line`, "line-width", v.highlighted ? 3 : 0);
          map.setPaintProperty(`${v.id}-trail-line`, "line-opacity", v.highlighted ? 0.78 : 0);
        } catch {}
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    ready,
    // Signature of ONLY the visual bits that should trigger a restyle.
    JSON.stringify(markers.map((m) => ({ l: m.label, c: m.color, h: !!m.highlighted }))),
    JSON.stringify(animatedVehicles.map((v) => ({ id: v.id, c: v.color, h: !!v.highlighted }))),
  ]);

  return (
    <div className={`relative w-full h-full ${className ?? ""}`}>
      <div ref={containerRef} style={{ width: "100%", height: "100%" }} />
      {!ready && (
        <div className="pointer-events-none absolute inset-0 grid place-items-center">
          <span className="mono text-[10px] uppercase tracking-wider text-slate-500">
            Loading map…
          </span>
        </div>
      )}
      {showZoomControls && ready && (
        <div className="absolute top-3 right-3 flex flex-col rounded-md overflow-hidden border border-[#22304C] bg-[#0F172A] z-10">
          <button
            onClick={() => mapRef.current?.zoomIn()}
            className="p-1.5 hover:bg-[#16213A] transition-colors border-b border-[#22304C] text-slate-300 text-xs"
            aria-label="Zoom in"
          >
            +
          </button>
          <button
            onClick={() => mapRef.current?.zoomOut()}
            className="p-1.5 hover:bg-[#16213A] transition-colors text-slate-300 text-xs"
            aria-label="Zoom out"
          >
            −
          </button>
        </div>
      )}
    </div>
  );
}

function centroid(ring: [number, number][]): [number, number] {
  let x = 0,
    y = 0;
  ring.forEach(([lng, lat]) => {
    x += lng;
    y += lat;
  });
  return [x / ring.length, y / ring.length];
}
