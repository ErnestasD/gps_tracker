import { motion, AnimatePresence } from "framer-motion";
import { useState } from "react";
import { Map, Route, Radar, FileBarChart2, Terminal, Circle } from "lucide-react";
import type { LucideIcon } from "lucide-react";

import shotMap from "@/assets/showcase/map.jpg";
import shotTrips from "@/assets/showcase/trips.jpg";
import shotGeofences from "@/assets/showcase/geofences.jpg";
import shotReports from "@/assets/showcase/reports.jpg";
import shotCommands from "@/assets/showcase/commands.jpg";

/**
 * Product showcase — REAL screenshots of the live dashboard (founder decision 2026-08-17:
 * the previous hand-built DOM mock invented numbers; these are captures of dash.orbetra.com
 * running the seeded demo fleet, simulator-driven). Retake recipe: log into the demo tenant,
 * run tools/simulator (liveDrive fleet) so vehicles move, capture at ~1456×830, drop the
 * JPGs into src/assets/showcase/. Keep all five the same viewport so tab switches don't jump.
 */
interface Tab {
  id: string;
  label: string;
  path: string;
  icon: LucideIcon;
  shot: string;
  alt: string;
}

const TABS: Tab[] = [
  { id: "map", label: "Live map", path: "app/map", icon: Map, shot: shotMap, alt: "Live fleet map — vehicles moving in Vilnius with speeds and a selected-vehicle card" },
  { id: "trips", label: "Trips & playback", path: "app/trips", icon: Route, shot: shotTrips, alt: "Trip list with distances and speeds, selected trip drawn on the map" },
  { id: "geo", label: "Geofences & alerts", path: "app/geofences", icon: Radar, shot: shotGeofences, alt: "Geofence editor with a polygon zone drawn over the city" },
  { id: "reports", label: "Reports", path: "app/reports", icon: FileBarChart2, shot: shotReports, alt: "Mileage report by vehicle and day, with CSV and PDF export" },
  { id: "commands", label: "Commands", path: "app/devices", icon: Terminal, shot: shotCommands, alt: "Device command panel with one-click presets and command history" },
];

export function TabShowcase() {
  const [active, setActive] = useState(TABS[0].id);
  const current = TABS.find((t) => t.id === active) ?? TABS[0];

  return (
    <div>
      <div className="flex flex-wrap gap-1 border-b border-[var(--hairline)]">
        {TABS.map((t) => {
          const Icon = t.icon;
          const isActive = t.id === active;
          return (
            <button
              key={t.id}
              onClick={() => setActive(t.id)}
              className={`relative inline-flex items-center gap-2 px-4 py-3 text-sm transition-colors duration-150 ${
                isActive ? "text-ink font-medium" : "text-muted-foreground hover:text-ink"
              }`}
            >
              <Icon className="h-4 w-4" strokeWidth={1.75} />
              {t.label}
              {isActive && (
                <motion.span
                  layoutId="tab-underline"
                  className="absolute left-2 right-2 -bottom-px h-[2px] bg-[var(--brand-blue)] rounded-full"
                />
              )}
            </button>
          );
        })}
      </div>

      <div className="mt-8 relative">
        <AnimatePresence mode="wait">
          <motion.div
            key={active}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            transition={{ duration: 0.22 }}
          >
            <div
              className="rounded-2xl overflow-hidden border border-[#22304C]/40 bg-[#0B1020]"
              style={{
                boxShadow:
                  "0 30px 80px -30px rgba(11,16,32,0.45), 0 10px 30px -15px rgba(37,99,235,0.25)",
              }}
            >
              {/* Browser chrome */}
              <div className="flex items-center justify-between px-4 py-2.5 bg-[#0F172A] border-b border-[#22304C]">
                <div className="flex items-center gap-1.5">
                  <span className="h-2.5 w-2.5 rounded-full bg-[#ff5f57]" />
                  <span className="h-2.5 w-2.5 rounded-full bg-[#febc2e]" />
                  <span className="h-2.5 w-2.5 rounded-full bg-[#28c840]" />
                </div>
                <div className="flex items-center gap-2 px-3 py-1 rounded-md bg-[#0B1020] border border-[#22304C]">
                  <Circle className="h-2 w-2 fill-[#10B981] text-[#10B981]" />
                  <span className="mono text-[10px] tracking-wider text-slate-300">
                    dash.orbetra.com / {current.path}
                  </span>
                </div>
                {/* honest label: these ARE the product, driven by the demo fleet */}
                <div className="mono text-[10px] tracking-wider text-slate-500 uppercase">Demo fleet</div>
              </div>
              <img
                src={current.shot}
                alt={current.alt}
                loading={current.id === "map" ? "eager" : "lazy"}
                className="block w-full h-auto select-none"
                draggable={false}
              />
            </div>
          </motion.div>
        </AnimatePresence>
      </div>
    </div>
  );
}
