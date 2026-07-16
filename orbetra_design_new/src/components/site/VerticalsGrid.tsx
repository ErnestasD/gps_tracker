import { motion } from "framer-motion";
import {
  Truck,
  Package,
  HardHat,
  Wheat,
  Wrench,
  Snowflake,
  ArrowUpRight,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";

interface Vertical {
  icon: LucideIcon;
  title: string;
  pain: string;
  outcome: string;
  color: string;
  code: string;
  metric: { label: string; value: string }[];
}

const VERTICALS: Vertical[] = [
  {
    code: "V-01",
    icon: Truck,
    title: "Delivery & courier",
    pain: "Where's my driver? Did they finish the route?",
    outcome: "Live map, stops, arrival times — check from your phone.",
    color: "#4c4dcf",
    metric: [
      { label: "Vehicles", value: "1–20" },
      { label: "Map ping", value: "10s" },
      { label: "Setup", value: "90 min" },
    ],
  },
  {
    code: "V-02",
    icon: Package,
    title: "Owner-operators",
    pain: "I need proof of delivery and hours worked.",
    outcome: "Trip history, ignition, mileage — auto-generated.",
    color: "#5B21B6",
    metric: [
      { label: "History", value: "12 mo" },
      { label: "Reports", value: "PDF/CSV" },
      { label: "Users", value: "Unlimited" },
    ],
  },
  {
    code: "V-03",
    icon: HardHat,
    title: "Construction crews",
    pain: "The van sat idle for hours on a rented site.",
    outcome: "Idle alerts, engine hours, site geofences.",
    color: "#B45309",
    metric: [
      { label: "Idle alerts", value: "Live" },
      { label: "Geofences", value: "Unlimited" },
      { label: "SMS/email", value: "Both" },
    ],
  },
  {
    code: "V-04",
    icon: Wheat,
    title: "Farm & rural",
    pain: "Tractor goes offline in the field for hours.",
    outcome: "Store-and-forward — no bars, no data lost.",
    color: "#059669",
    metric: [
      { label: "Offline buffer", value: "72h" },
      { label: "Coverage", value: "EU-wide" },
      { label: "Battery", value: "Low-draw" },
    ],
  },
  {
    code: "V-05",
    icon: Wrench,
    title: "Rental & service",
    pain: "Trailer went missing between jobs.",
    outcome: "Geofence alerts, ignition lockout, instant SMS.",
    color: "#4338CA",
    metric: [
      { label: "Recovery aid", value: "SMS" },
      { label: "Lockout", value: "Optional" },
      { label: "Alerts", value: "Real-time" },
    ],
  },
  {
    code: "V-06",
    icon: Snowflake,
    title: "Refrigerated vans",
    pain: "Cold-chain broke and you find out at the drop.",
    outcome: "Temperature probe, alarms, audit trail.",
    color: "#6a6bdf",
    metric: [
      { label: "Probes", value: "4 ch" },
      { label: "Alarm", value: "±1°C" },
      { label: "Exports", value: "PDF/CSV" },
    ],
  },
];

export function VerticalsGrid() {
  return (
    <div className="relative">
      {/* Subtle orbit backdrop — hints at the "one platform, six industries" idea without a table. */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 flex items-center justify-center overflow-hidden"
      >
        <svg viewBox="0 0 1200 800" className="w-full h-full max-h-[900px] opacity-40">
          <defs>
            <radialGradient id="vg-core" cx="50%" cy="50%" r="50%">
              <stop offset="0%" stopColor="#4c4dcf" stopOpacity="0.25" />
              <stop offset="70%" stopColor="#4c4dcf" stopOpacity="0" />
            </radialGradient>
          </defs>
          <circle cx="600" cy="400" r="360" fill="url(#vg-core)" />
          <circle cx="600" cy="400" r="360" fill="none" stroke="#4c4dcf" strokeOpacity="0.16" strokeWidth="0.8" />
          <circle cx="600" cy="400" r="480" fill="none" stroke="#4c4dcf" strokeOpacity="0.08" strokeWidth="0.6" strokeDasharray="2 6" />
          <circle cx="600" cy="400" r="240" fill="none" stroke="#4c4dcf" strokeOpacity="0.1" strokeWidth="0.6" strokeDasharray="3 5" />
        </svg>
      </div>

      {/* Header row — labels + legend, no console chrome */}
      <div className="relative mb-8 flex flex-wrap items-end justify-between gap-4">
        <div className="text-[12px] font-semibold tracking-[0.1em] uppercase text-[#4c4dcf] flex items-center gap-3">
          <span className="h-[1px] w-8 bg-[#4c4dcf]" />
          Six kinds of small fleets · One app
        </div>
        <div className="flex items-center gap-4 text-[12px] font-medium tracking-[0.06em] uppercase text-[#9FB3D3]">
          <span className="flex items-center gap-2">
            <span className="h-2 w-2 rounded-full bg-[#059669] animate-pulse-dot" />
            Live today
          </span>
        </div>
      </div>

      {/* Six clear cards */}
      <div className="relative grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
        {VERTICALS.map((v, i) => (
          <VerticalCard key={v.code} vertical={v} index={i} />
        ))}
      </div>
    </div>
  );
}

function VerticalCard({ vertical, index }: { vertical: Vertical; index: number }) {
  const Icon = vertical.icon;
  return (
    <motion.article
      initial={{ opacity: 0, y: 16 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: "-80px" }}
      transition={{ duration: 0.5, delay: index * 0.06, ease: "easeOut" }}
      className="group relative flex flex-col"
      style={{
        background: "linear-gradient(180deg, rgba(10,20,40,0.75) 0%, rgba(4,7,15,0.9) 100%)",
        border: "1px solid rgba(76,77,207,0.18)",
        borderRadius: 6,
        padding: "22px 22px 20px",
        boxShadow: "0 20px 40px -30px rgba(0,0,0,0.7)",
        overflow: "hidden",
      }}
    >
      {/* Accent hairline — colored by vertical */}
      <span
        aria-hidden
        className="absolute inset-x-0 top-0 h-[2px]"
        style={{ background: `linear-gradient(90deg, transparent, ${vertical.color}, transparent)` }}
      />
      {/* Ambient corner glow */}
      <span
        aria-hidden
        className="pointer-events-none absolute -top-16 -right-16 h-40 w-40 rounded-full opacity-30 group-hover:opacity-60 transition-opacity"
        style={{ background: `radial-gradient(closest-side, ${vertical.color}, transparent 70%)` }}
      />

      {/* Header — icon + code */}
      <div className="relative flex items-start justify-between">
        <div className="flex items-center gap-3">
          <span
            className="grid place-items-center h-11 w-11 shrink-0"
            style={{
              background: `${vertical.color}1f`,
              border: `1px solid ${vertical.color}55`,
              borderRadius: 6,
              boxShadow: `0 0 20px -6px ${vertical.color}80`,
            }}
          >
            <Icon className="h-5 w-5" style={{ color: vertical.color }} strokeWidth={1.75} />
          </span>
          <div>
            <div
              className="mono text-[10px] tracking-[0.24em] uppercase leading-none"
              style={{ color: vertical.color }}
            >
              {vertical.code} · ORBIT
            </div>
            <h3 className="mt-1.5 font-display text-lg font-semibold text-ink leading-tight">
              {vertical.title}
            </h3>
          </div>
        </div>
      </div>

      {/* Q & A — reads naturally to a non-technical buyer */}
      <div className="relative mt-5 space-y-3">
        <div>
          <div className="mono text-[9px] tracking-[0.22em] uppercase text-[#7A8CAA]">
            YOU'VE SAID THIS
          </div>
          <p className="mt-1 text-[14px] text-ink/90 leading-snug">"{vertical.pain}"</p>
        </div>
        <div>
          <div className="mono text-[9px] tracking-[0.22em] uppercase text-[#7A8CAA]">
            HOW ORBETRA HELPS
          </div>
          <p className="mt-1 text-[14px] text-ink leading-snug">{vertical.outcome}</p>
        </div>
      </div>

      {/* Metric strip */}
      <div className="relative mt-5 grid grid-cols-3 gap-2">
        {vertical.metric.map((m) => (
          <div
            key={m.label}
            className="px-2.5 py-2"
            style={{
              background: "rgba(4,7,15,0.6)",
              border: "1px solid rgba(76,77,207,0.14)",
              borderRadius: 4,
            }}
          >
            <div className="mono text-[8.5px] tracking-widest uppercase text-[#7A8CAA] leading-none">
              {m.label}
            </div>
            <div
              className="mono text-[13px] font-semibold mt-1.5"
              style={{ color: vertical.color }}
            >
              {m.value}
            </div>
          </div>
        ))}
      </div>

      {/* Discover link */}
      <a
        href="#platform"
        className="relative mt-5 inline-flex items-center gap-1.5 text-sm font-medium hover:gap-2.5 transition-all"
        style={{ color: vertical.color }}
      >
        Discover {vertical.title.toLowerCase()} <ArrowUpRight className="h-4 w-4" />
      </a>
    </motion.article>
  );
}
