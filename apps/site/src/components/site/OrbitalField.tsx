import { motion } from "framer-motion";
import { Activity, Radio, TrendingUp } from "lucide-react";
import { TabMap } from "./TabMap";

// Dark vector style — real streets/cities visible.
const HERO_STYLE =
  (import.meta as any).env?.VITE_TILES_STYLE_URL ||
  "https://tiles.openfreemap.org/styles/liberty"; // rule 13: OpenFreeMap, never a paid provider

const NODES: Array<{
  id: string;
  label: string;
  lng: number;
  lat: number;
  color: string;
  status: "moving" | "idle" | "live";
}> = [
  { id: "N-01", label: "Warsaw",     lng: 21.012, lat: 52.229, color: "#4c4dcf", status: "moving" },
  { id: "N-02", label: "Berlin",     lng: 13.405, lat: 52.520, color: "#4c4dcf", status: "moving" },
  { id: "N-03", label: "Prague",     lng: 14.421, lat: 50.087, color: "#5B21B6", status: "idle"   },
  { id: "N-04", label: "Vienna",     lng: 16.373, lat: 48.208, color: "#4c4dcf", status: "moving" },
  { id: "N-05", label: "Kraków",     lng: 19.945, lat: 50.064, color: "#4c4dcf", status: "moving" },
  { id: "N-06", label: "Vilnius",    lng: 25.279, lat: 54.687, color: "#B45309", status: "live"   },
  { id: "N-07", label: "Budapest",   lng: 19.040, lat: 47.498, color: "#5B21B6", status: "moving" },
  { id: "N-08", label: "Munich",     lng: 11.582, lat: 48.135, color: "#4c4dcf", status: "idle"   },
  { id: "N-09", label: "Hamburg",    lng: 9.993,  lat: 53.551, color: "#4c4dcf", status: "moving" },
  { id: "N-10", label: "Riga",       lng: 24.106, lat: 56.949, color: "#5B21B6", status: "moving" },
  { id: "N-11", label: "Wrocław",    lng: 17.037, lat: 51.108, color: "#4c4dcf", status: "idle"   },
  { id: "N-12", label: "Bratislava", lng: 17.107, lat: 48.148, color: "#4c4dcf", status: "moving" },
  { id: "N-13", label: "Poznań",     lng: 16.925, lat: 52.406, color: "#4c4dcf", status: "moving" },
  { id: "N-14", label: "Gdańsk",     lng: 18.646, lat: 54.352, color: "#5B21B6", status: "idle"   },
  { id: "N-15", label: "Tallinn",    lng: 24.754, lat: 59.437, color: "#4c4dcf", status: "moving" },
];

// Dense multi-waypoint corridors — feels like real dispatch.
const ROUTES: [number, number][][] = [
  [[13.405,52.520],[14.55,52.42],[15.9,52.55],[16.925,52.406],[17.4,52.35],[19.1,52.28],[21.012,52.229]],
  [[21.012,52.229],[20.9,51.7],[20.6,51.3],[20.25,50.75],[19.945,50.064]],
  [[14.421,50.087],[14.9,49.8],[15.4,49.5],[15.9,49.05],[16.373,48.208]],
  [[19.945,50.064],[19.6,49.6],[19.35,48.95],[19.15,48.3],[19.040,47.498]],
  [[25.279,54.687],[24.55,54.35],[23.85,53.9],[22.9,53.35],[21.9,52.75],[21.012,52.229]],
  [[11.582,48.135],[12.9,48.4],[14.35,48.3],[15.35,48.25],[16.373,48.208]],
  [[9.993,53.551],[11.05,53.05],[12.2,52.75],[13.405,52.520]],
  [[24.106,56.949],[24.9,56.2],[25.15,55.5],[25.279,54.687]],
  [[17.037,51.108],[18.05,51.2],[19.2,51.4],[20.1,51.85],[21.012,52.229]],
  [[17.107,48.148],[17.7,48.05],[18.3,47.85],[19.040,47.498]],
  [[18.646,54.352],[19.1,53.7],[19.6,53.1],[20.3,52.7],[21.012,52.229]],
  [[24.754,59.437],[24.5,58.4],[24.3,57.6],[24.106,56.949]],
  [[13.405,52.520],[13.9,51.8],[14.421,50.087]],
  [[16.373,48.208],[17.5,48.1],[18.2,47.9],[19.040,47.498]],
];

export function OrbitalField() {
  return (
    <div className="relative w-full aspect-[5/4] max-w-[640px] mx-auto">
      {/* Ambient cyan/violet glow */}
      <div
        className="absolute inset-0 -z-10"
        style={{
          background:
            "radial-gradient(60% 55% at 50% 45%, rgba(76,77,207,0.22), transparent 70%), radial-gradient(45% 40% at 75% 65%, rgba(91,33,182,0.18), transparent 70%)",
          filter: "blur(6px)",
        }}
      />

      {/* Layered ghost panels */}
      <div
        className="absolute glass-panel"
        style={{ inset: "8% 12% 12% -4%", opacity: 0.35, transform: "rotate(-3deg)" }}
        aria-hidden
      />
      <div
        className="absolute glass-panel"
        style={{ inset: "4% -4% 8% 8%", opacity: 0.55, transform: "rotate(2deg)" }}
        aria-hidden
      />

      {/* Main glass panel */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.7, ease: "easeOut" }}
        className="relative glass-panel overflow-hidden flex flex-col"
        style={{ height: "100%" }}
      >
        {/* Panel top bar */}
        <div className="flex items-center justify-between px-4 py-2.5 border-b border-[rgba(76,77,207,0.18)] shrink-0">
          <div className="flex items-center gap-2">
            <span className="h-2 w-2 rounded-full bg-[#4c4dcf] animate-pulse-dot" />
            <span className="mono text-[10px] tracking-widest uppercase text-[#7A8CAA]">
              FIG.01 · ORBIT · EU-CENTRAL
            </span>
          </div>
          <span className="mono text-[10px] text-[#4c4dcf]">128 online</span>
        </div>

        {/* Real dark map */}
        <div className="relative flex-1 min-h-0">
          <TabMap
            styleUrl={HERO_STYLE}
            center={[17.8, 51.2]}
            zoom={4.9}
            markers={NODES.map((n) => ({
              lng: n.lng,
              lat: n.lat,
              label: n.label,
              color: n.color,
              highlighted: n.status === "live",
            }))}
            routes={ROUTES.map((coords, i) => ({
              id: `hero-route-${i}`,
              coordinates: coords,
              color: i % 3 === 0 ? "#4c4dcf" : i % 3 === 1 ? "#5B21B6" : "#4338CA",
              width: 1.6,
              dashed: i % 2 === 1,
            }))}
          />

          {/* Orbital reticle over LIVE unit (Vilnius, upper-right) */}
          <div
            className="pointer-events-none absolute"
            style={{ left: "72%", top: "22%", width: 108, height: 108, transform: "translate(-50%,-50%)" }}
            aria-hidden
          >
            <svg viewBox="0 0 100 100" className="absolute inset-0 animate-orbit-slow">
              <circle cx="50" cy="50" r="46" fill="none" stroke="#B45309" strokeOpacity="0.65" strokeWidth="0.6" strokeDasharray="2 4" />
              <circle cx="50" cy="4" r="2" fill="#B45309" />
            </svg>
            <svg viewBox="0 0 100 100" className="absolute inset-0 animate-orbit-fast">
              <circle cx="50" cy="50" r="34" fill="none" stroke="#4c4dcf" strokeOpacity="0.5" strokeWidth="0.5" />
              <circle cx="84" cy="50" r="1.5" fill="#4c4dcf" />
            </svg>
            <svg viewBox="0 0 100 100" className="absolute inset-0">
              <circle cx="50" cy="50" r="2" fill="#B45309" />
              <line x1="50" y1="30" x2="50" y2="70" stroke="#B45309" strokeOpacity="0.5" strokeWidth="0.4" />
              <line x1="30" y1="50" x2="70" y2="50" stroke="#B45309" strokeOpacity="0.5" strokeWidth="0.4" />
            </svg>
            <div className="absolute left-1/2 top-[92%] -translate-x-1/2 mono text-[8px] tracking-[0.2em] uppercase text-[#B45309] bg-[rgba(4,7,15,0.85)] px-1.5 py-0.5 rounded border border-[#B45309]/40">
              LIVE · N-06
            </div>
          </div>

          {/* Coordinate ticks */}
          <svg
            className="pointer-events-none absolute inset-0 h-full w-full"
            viewBox="0 0 100 100"
            preserveAspectRatio="none"
            aria-hidden
          >
            {[20, 40, 60, 80].map((x) => (
              <line key={`v${x}`} x1={x} y1="0" x2={x} y2="100" stroke="#4c4dcf" strokeOpacity="0.08" strokeWidth="0.15" />
            ))}
            {[25, 50, 75].map((y) => (
              <line key={`h${y}`} x1="0" y1={y} x2="100" y2={y} stroke="#4c4dcf" strokeOpacity="0.08" strokeWidth="0.15" />
            ))}
          </svg>

          {/* Corner readouts */}
          <div className="pointer-events-none absolute inset-0 flex justify-between items-end p-2.5 mono text-[9px] text-[#4c4dcf]">
            <span className="bg-[rgba(4,7,15,0.8)] backdrop-blur px-1.5 py-0.5 rounded border border-[rgba(76,77,207,0.2)]">
              LAT 54.68 · LON 25.28
            </span>
            <span className="bg-[rgba(4,7,15,0.8)] backdrop-blur px-1.5 py-0.5 rounded border border-[rgba(76,77,207,0.2)]">
              v1 · TELTONIKA · 128 UNITS
            </span>
          </div>
        </div>
      </motion.div>

      {/* Floating chips */}
      <motion.div
        initial={{ opacity: 0, x: -20 }}
        animate={{ opacity: 1, x: 0 }}
        transition={{ delay: 0.4, duration: 0.5 }}
        className="chip-frost absolute -left-3 top-[20%] px-3 py-2 animate-float-y"
        style={{ animationDelay: "0s" }}
      >
        <div className="flex items-center gap-2">
          <Activity className="h-3.5 w-3.5 text-[#4c4dcf]" strokeWidth={2} />
          <div>
            <div className="mono text-[9px] uppercase tracking-wider text-[#7A8CAA]">Events · 24h</div>
            <div className="text-sm font-semibold text-ink leading-tight">1,204</div>
          </div>
        </div>
      </motion.div>

      <motion.div
        initial={{ opacity: 0, x: 20 }}
        animate={{ opacity: 1, x: 0 }}
        transition={{ delay: 0.5, duration: 0.5 }}
        className="chip-frost absolute -right-2 top-[10%] px-3 py-2 animate-float-y"
        style={{ animationDelay: "-2s" }}
      >
        <div className="flex items-center gap-2">
          <Radio className="h-3.5 w-3.5 text-[#059669]" strokeWidth={2} />
          <div>
            <div className="mono text-[9px] uppercase tracking-wider text-[#7A8CAA]">Online</div>
            <div className="text-sm font-semibold text-ink leading-tight">128 / 132</div>
          </div>
        </div>
      </motion.div>

      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.6, duration: 0.5 }}
        className="chip-frost absolute -right-4 bottom-[14%] px-3 py-2 animate-float-y"
        style={{ animationDelay: "-4s" }}
      >
        <div className="flex items-center gap-2.5">
          <TrendingUp className="h-3.5 w-3.5 text-[#4c4dcf]" strokeWidth={2} />
          <div>
            <div className="mono text-[9px] uppercase tracking-wider text-[#7A8CAA]">Trips · 30d</div>
            <div className="flex items-center gap-1.5">
              <span className="text-sm font-semibold text-ink leading-tight">8,412</span>
              <svg width="36" height="14" viewBox="0 0 36 14">
                <polyline
                  points="0,10 6,8 12,9 18,5 24,6 30,3 36,4"
                  fill="none"
                  stroke="#4c4dcf"
                  strokeWidth="1.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </div>
          </div>
        </div>
      </motion.div>

      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.7, duration: 0.5 }}
        className="chip-frost absolute left-[10%] -bottom-3 px-3 py-2"
      >
        <div className="mono text-[9px] uppercase tracking-wider text-[#7A8CAA]">
          Latency <span className="text-[#059669] normal-case">● 42ms</span>
        </div>
      </motion.div>
    </div>
  );
}
