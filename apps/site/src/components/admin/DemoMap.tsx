import * as React from "react";
import maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";

import { useAdminTheme } from "@/lib/admin-theme";
import type { LngLat } from "@/lib/demo-geo";

/** Minimal GeoJSON shapes (the site has no @types/geojson; MapLibre accepts these). */
type Geometry =
  | { type: "Polygon"; coordinates: LngLat[][] }
  | { type: "LineString"; coordinates: LngLat[] };
type Feature = { type: "Feature"; geometry: Geometry; properties: Record<string, unknown> };
type FeatureCollection = { type: "FeatureCollection"; features: Feature[] };

/**
 * Real-tile map for the DEMO admin (founder: the procedural SVG maps rendered as an empty
 * black void on large screens and looked nothing like the product). Carto's free dark
 * style over MapLibre — the same dark basemap idiom as the real dashboard's Mapbox dark
 * style, no token required. Overlays (zones / routes / device arrows) come in as props.
 */
/**
 * Basemaps chosen to sit as close to the PRODUCT's look as free tiles allow.
 *
 * The dashboard runs Mapbox `navigation-night-v1` / `navigation-day-v1` — navigation styles, not
 * the muted monochrome bases — because a fleet map needs roads you can read. The demo cannot use
 * them: it is a public marketing page, and every anonymous visitor would spend a load against the
 * 50k/month tier. CARTO's dark-matter / positron are the nearest free equivalents, and
 * `emphasizeRoads` below lifts their roads toward the navigation palette so the two products look
 * like one product.
 *
 * It is also THEME-REACTIVE now. The style was pinned dark, so switching the demo to light mode
 * left a black rectangle in a white interface — a mismatch the real dashboard does not have.
 */
const STYLES = {
  dark: "https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json",
  light: "https://basemaps.cartocdn.com/gl/positron-gl-style/style.json",
} as const;

/**
 * Lift roads and borders toward the navigation styles the product uses.
 *
 * Every write is guarded and matched by layer SHAPE rather than by name: CARTO renames layers
 * between style versions, and a hardcoded id list would silently stop applying — leaving the demo
 * looking like the old free stack again with nothing to show it had regressed.
 */
function emphasizeRoads(map: maplibregl.Map, theme: "dark" | "light"): void {
  const road = theme === "dark" ? "#5d6470" : "#c9ced6";
  const major = theme === "dark" ? "#8a8f9c" : "#a9b0ba";
  const border = theme === "dark" ? "#9fb0d6" : "#5b6a8c";
  let layers: maplibregl.LayerSpecification[] = [];
  try {
    layers = map.getStyle().layers ?? [];
  } catch {
    return;
  }
  for (const l of layers) {
    if (l.type !== "line") continue;
    const id = l.id.toLowerCase();
    const set = (prop: string, value: unknown): void => {
      try {
        map.setPaintProperty(l.id, prop, value);
      } catch {
        /* layer/prop absent in this style version — a no-op, never a throw */
      }
    };
    if (id.includes("motorway") || id.includes("trunk") || id.includes("primary")) {
      set("line-color", major);
      set("line-opacity", 1);
    } else if (id.includes("road") || id.includes("street") || id.includes("transportation")) {
      set("line-color", road);
      set("line-opacity", 0.9);
    } else if (id.includes("boundary") || id.includes("admin")) {
      // the product lifts these too — borders that vanish into the base read as a missing map
      set("line-color", border);
      set("line-opacity", 0.8);
    }
  }
}

export type DemoZone = {
  id: string;
  color: string;
  /** closed ring for polygons/circles; open line for corridors (drawn as a wide band) */
  ring?: LngLat[];
  line?: LngLat[];
  /** widen the corridor line to look like the buffered zone (px) */
  corridorWidthPx?: number;
  selected?: boolean;
  /** live-map overlay style (the real dashboard draws zones dashed on the live map) */
  dashed?: boolean;
};

export type DemoPin = { id: string; at: LngLat; label: string; color: string };

export type DemoRoute = { id: string; coords: LngLat[]; color?: string; widthPx?: number; dashed?: boolean };

export type DemoVehicle = {
  id: string;
  at: LngLat;
  headingDeg: number;
  color: string;
  selected?: boolean;
};

export function DemoMap({
  className,
  center,
  zoom = 8,
  fit,
  fitPadding = 60,
  zones = [],
  routes = [],
  vehicles = [],
  pins = [],
  onVehicleClick,
  interactive = true,
}: {
  className?: string;
  center?: LngLat;
  zoom?: number;
  /** coordinates to fit into view (wins over center/zoom) */
  fit?: LngLat[];
  fitPadding?: number | { top: number; bottom: number; left: number; right: number };
  zones?: DemoZone[];
  routes?: DemoRoute[];
  vehicles?: DemoVehicle[];
  pins?: DemoPin[];
  onVehicleClick?: (id: string) => void;
  interactive?: boolean;
}) {
  // the basemap follows the interface theme, as the dashboard's does
  const { theme } = useAdminTheme();
  const ref = React.useRef<HTMLDivElement | null>(null);
  const mapRef = React.useRef<maplibregl.Map | null>(null);
  const markersRef = React.useRef<Map<string, maplibregl.Marker>>(new Map());
  const loadedRef = React.useRef(false);
  const onClickRef = React.useRef(onVehicleClick);
  onClickRef.current = onVehicleClick;

  // create once
  React.useEffect(() => {
    if (!ref.current) return;
    const map = new maplibregl.Map({
      container: ref.current,
      style: STYLES[theme],
      center: center ?? [24.5, 55.0],
      zoom,
      attributionControl: { compact: true },
      interactive,
    });
    mapRef.current = map;
    map.on("load", () => {
      loadedRef.current = true;
      emphasizeRoads(map, theme);
      applyOverlays();
    });
    return () => {
      markersRef.current.forEach((m) => m.remove());
      markersRef.current.clear();
      map.remove();
      mapRef.current = null;
      loadedRef.current = false;
    };
    // deps deliberately empty — imperative map, created once
  }, []);

  /**
   * Follow the interface theme, as the dashboard does.
   *
   * `setStyle` throws away every layer we added, so the overlays are re-applied on `styledata` —
   * the same dance `LiveMap` does in the product. Without it a theme switch left a correctly
   * coloured basemap with no vehicles on it.
   */
  React.useEffect(() => {
    const map = mapRef.current;
    if (!map || !loadedRef.current) return;
    map.setStyle(STYLES[theme]);
    const onStyled = (): void => {
      emphasizeRoads(map, theme);
      applyOverlays();
    };
    // `once` is typed as returning a promise (it resolves when no handler is given); we pass a
    // handler, so there is nothing to await — say so rather than leave a floating value.
    void map.once("styledata", onStyled);
  }, [theme]);

  const applyOverlays = React.useCallback(() => {
    const map = mapRef.current;
    if (!map || !loadedRef.current) return;

    const zoneFeatures: Feature[] = [];
    const corridorFeatures: Feature[] = [];
    for (const z of zones) {
      if (z.ring) {
        zoneFeatures.push({
          type: "Feature",
          geometry: { type: "Polygon", coordinates: [z.ring] },
          properties: { color: z.color, selected: z.selected === true, dashed: z.dashed === true },
        });
      }
      if (z.line) {
        corridorFeatures.push({
          type: "Feature",
          geometry: { type: "LineString", coordinates: z.line },
          properties: { color: z.color, width: z.corridorWidthPx ?? 10, selected: z.selected === true },
        });
      }
    }
    const routeFeatures: Feature[] = routes.map((r) => ({
      type: "Feature",
      geometry: { type: "LineString", coordinates: r.coords },
      properties: { color: r.color ?? "#F2A93B", width: r.widthPx ?? 2.5, dashed: r.dashed === true },
    }));

    const ensure = (id: string, data: FeatureCollection) => {
      // structural cast: the site compiles without @types/geojson, so MapLibre's own
      // GeoJSON-typed signatures aren't nameable here — the runtime shapes are correct
      const src = map.getSource(id) as { setData(d: unknown): void } | undefined;
      if (src) src.setData(data);
      else map.addSource(id, { type: "geojson", data });
    };
    ensure("demo-zones", { type: "FeatureCollection", features: zoneFeatures });
    ensure("demo-corridors", { type: "FeatureCollection", features: corridorFeatures });
    ensure("demo-routes", { type: "FeatureCollection", features: routeFeatures });

    if (!map.getLayer("demo-zone-fill")) {
      map.addLayer({ id: "demo-zone-fill", type: "fill", source: "demo-zones", paint: { "fill-color": ["get", "color"], "fill-opacity": 0.16 } });
      map.addLayer({
        id: "demo-zone-line", type: "line", source: "demo-zones", filter: ["!=", ["get", "dashed"], true],
        paint: { "line-color": ["get", "color"], "line-width": ["case", ["get", "selected"], 3.5, 2] },
      });
      map.addLayer({
        id: "demo-zone-line-dashed", type: "line", source: "demo-zones", filter: ["==", ["get", "dashed"], true],
        paint: { "line-color": ["get", "color"], "line-width": 1.5, "line-dasharray": [2, 2] },
      });
      map.addLayer({
        id: "demo-corridor-band", type: "line", source: "demo-corridors",
        paint: { "line-color": ["get", "color"], "line-width": ["get", "width"], "line-opacity": 0.3 },
      });
      map.addLayer({
        id: "demo-corridor-line", type: "line", source: "demo-corridors",
        paint: { "line-color": ["get", "color"], "line-width": 2, "line-opacity": 0.9 },
      });
      map.addLayer({
        id: "demo-route-line", type: "line", source: "demo-routes",
        layout: { "line-cap": "round", "line-join": "round" },
        paint: { "line-color": ["get", "color"], "line-width": ["get", "width"], "line-opacity": 0.9 },
      });
    }

    // vehicles as rotated-arrow DOM markers (the real dashboard's heading-arrow idiom)
    const seen = new Set<string>();
    for (const v of vehicles) {
      seen.add(v.id);
      let marker = markersRef.current.get(v.id);
      if (!marker) {
        const el = document.createElement("div");
        el.style.cssText = "width:26px;height:26px;cursor:pointer;display:grid;place-items:center;";
        el.innerHTML =
          '<svg width="26" height="26" viewBox="-13 -13 26 26" style="overflow:visible"><g class="demo-arrow"><path d="M 0 -9 L 6.5 8 L 0 4.5 L -6.5 8 Z" stroke="#fff" stroke-width="1.6" stroke-linejoin="round"/></g></svg>';
        el.addEventListener("click", (e) => {
          e.stopPropagation();
          onClickRef.current?.(v.id);
        });
        marker = new maplibregl.Marker({ element: el, rotationAlignment: "map" });
        marker.setLngLat(v.at).addTo(map);
        markersRef.current.set(v.id, marker);
      }
      marker.setLngLat(v.at);
      const g = marker.getElement().querySelector("g.demo-arrow");
      const path = marker.getElement().querySelector("path");
      if (g) g.setAttribute("transform", `rotate(${v.headingDeg})`);
      if (path) path.setAttribute("fill", v.color);
      marker.getElement().style.filter = v.selected
        ? "drop-shadow(0 0 6px rgba(124,92,252,0.9))"
        : "drop-shadow(0 1px 2px rgba(0,0,0,0.6))";
      marker.getElement().style.zIndex = v.selected ? "10" : "1";
    }
    for (const p of pins) {
      const pid = `pin:${p.id}`;
      seen.add(pid);
      let marker = markersRef.current.get(pid);
      if (!marker) {
        const el = document.createElement("div");
        el.style.cssText = `width:24px;height:24px;border-radius:9999px;background:${p.color};border:2px solid #fff;display:grid;place-items:center;color:#fff;font:700 11px Inter,sans-serif;box-shadow:0 1px 4px rgba(0,0,0,0.6)`;
        el.textContent = p.label;
        marker = new maplibregl.Marker({ element: el });
        marker.setLngLat(p.at).addTo(map);
        markersRef.current.set(pid, marker);
      }
      marker.setLngLat(p.at);
    }
    for (const [id, m] of markersRef.current) {
      if (!seen.has(id)) {
        m.remove();
        markersRef.current.delete(id);
      }
    }
  }, [zones, routes, vehicles, pins]);

  React.useEffect(() => {
    applyOverlays();
  }, [applyOverlays]);

  // fit once per fit-array identity
  const fitKey = fit ? fit.length + ":" + fit[0]?.join(",") + ":" + fit[fit.length - 1]?.join(",") : "";
  React.useEffect(() => {
    const map = mapRef.current;
    if (!map || !fit || fit.length === 0) return;
    let b: [number, number, number, number] = [999, 999, -999, -999];
    for (const c of fit) b = [Math.min(b[0], c[0]), Math.min(b[1], c[1]), Math.max(b[2], c[0]), Math.max(b[3], c[1])];
    map.fitBounds([[b[0], b[1]], [b[2], b[3]]], { padding: fitPadding, duration: 0, maxZoom: 15 });
    // keyed by content (fitKey), not array identity
  }, [fitKey]);

  return <div ref={ref} className={className} style={{ background: "#0b0e17" }} />;
}
