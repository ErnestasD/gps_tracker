import { motion } from "framer-motion";
import { Link } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { ArrowRight, Check } from "lucide-react";


const HERO_MAP_NODES = [
  { lng: 21.012, lat: 52.229, label: "Warsaw",   color: "#4c4dcf" },
  { lng: 13.405, lat: 52.520, label: "Berlin",   color: "#4c4dcf" },
  { lng: 25.279, lat: 54.687, label: "Vilnius",  color: "#B45309", highlighted: true },
  { lng: 24.106, lat: 56.949, label: "Riga",     color: "#5B21B6" },
  { lng: 19.945, lat: 50.064, label: "Kraków",   color: "#4c4dcf" },
  { lng: 11.582, lat: 48.135, label: "Munich",   color: "#4c4dcf" },
  { lng: 16.373, lat: 48.208, label: "Vienna",   color: "#5B21B6" },
  { lng: 18.646, lat: 54.352, label: "Gdańsk",   color: "#4c4dcf" },
];

const HERO_MAP_ROUTES = [
  { id: "r1", coordinates: [[13.405,52.520],[16.9,52.4],[21.012,52.229]] as [number,number][], color: "#4c4dcf", width: 1.6 },
  { id: "r2", coordinates: [[25.279,54.687],[23.5,53.5],[21.012,52.229]] as [number,number][], color: "#B45309", width: 1.8 },
  { id: "r3", coordinates: [[21.012,52.229],[20.4,51.1],[19.945,50.064]] as [number,number][], color: "#5B21B6", width: 1.4, dashed: true },
  { id: "r4", coordinates: [[11.582,48.135],[14.0,48.2],[16.373,48.208]] as [number,number][], color: "#4c4dcf", width: 1.4, dashed: true },
];

export function HeroDeck() {
  const { t } = useTranslation();
  return (
    <section className="relative overflow-hidden">

      <div className="mx-auto max-w-7xl px-6 pt-28 md:pt-32 pb-20 md:pb-28">
        <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.05fr)] gap-12 lg:gap-16 items-center">
          {/* LEFT — copy */}
          <div>
            <motion.div
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.4 }}
              className="inline-flex items-center gap-2.5 rounded-full px-4 py-1.5 border border-[var(--hairline)] bg-[rgba(10,20,40,0.5)]"
            >
              <span className="h-2 w-2 rounded-full bg-[#059669] animate-pulse-dot" />
              <span className="text-[13px] font-medium tracking-[0.04em] uppercase text-[#D4E3F6]">
                {t("hero.eyebrow")}
              </span>
            </motion.div>

            <motion.h1
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.55, ease: "easeOut", delay: 0.05 }}
              className="display font-bold text-ink leading-[0.98] tracking-tight mt-6"
              style={{ fontSize: "clamp(2.75rem, 5.6vw, 4.75rem)" }}
            >
              {t("hero.title1")}
              <br />
              <span className="text-gradient">{t("hero.title2")}</span>
            </motion.h1>

            <motion.p
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.5, delay: 0.15 }}
              className="mt-6 text-lg text-muted-foreground max-w-xl leading-relaxed"
            >
              {t("hero.sub")}
            </motion.p>

            <motion.ul
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.5, delay: 0.22 }}
              className="mt-7 grid gap-2.5"
            >
              {(["hero.b1", "hero.b2", "hero.b3"] as const).map((k) => (
                <li key={k} className="flex items-center gap-3 text-sm text-ink/90">
                  <span className="grid place-items-center h-5 w-5 rounded-full bg-[rgba(76,77,207,0.1)] border border-[rgba(76,77,207,0.3)] shrink-0">
                    <Check className="h-3 w-3 text-[#4c4dcf]" strokeWidth={2.5} />
                  </span>
                  {t(k)}
                </li>
              ))}
            </motion.ul>

            <motion.div
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.5, delay: 0.3 }}
              className="mt-9 flex flex-wrap items-center gap-3"
            >
              <Link to="/signup" className="pill-primary hover:pill-primary-hover">
                {t("cta.trial")} <ArrowRight className="h-4 w-4" />
              </Link>
              <Link to="/pricing" className="pill-ghost hover:border-[color:var(--brand-cyan)]">
                {t("cta.pricing")}
              </Link>
              <Link
                to="/tsp"
                className="inline-flex items-center gap-1.5 text-sm text-[color:var(--brand-purple,#7C5CFC)] hover:text-ink transition-colors"
              >
                {t("cta.whitelabel")} <ArrowRight className="h-3.5 w-3.5" />
              </Link>
            </motion.div>

            <div className="mt-8 flex items-center gap-6 mono text-[10.5px] tracking-[0.2em] uppercase text-[#7A8CAA]">
              <span>{t("hero.trial")}</span>
              <span className="h-1 w-1 rounded-full bg-[#7A8CAA]/50" />
              <span>{t("hero.nocard")}</span>
              <span className="h-1 w-1 rounded-full bg-[#7A8CAA]/50" />
              <span>{t("hero.cancel")}</span>
            </div>

            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ duration: 0.5, delay: 0.4 }}
              className="mt-5 flex flex-wrap items-center gap-2.5 text-[12.5px]"
            >
              <span
                className="mono text-[9.5px] tracking-[0.22em] uppercase px-1.5 py-0.5 rounded"
                style={{
                  color: "var(--brand-cyan)",
                  background: "rgba(76,77,207,0.1)",
                  border: "1px solid rgba(76,77,207,0.3)",
                }}
              >
                TSP
              </span>
              <span className="text-muted-foreground">
                {t("hero.tspAsk")}
              </span>
              <Link
                to="/tsp"
                className="text-[color:var(--brand-cyan)] hover:underline inline-flex items-center gap-1 font-medium"
              >
                {t("hero.tspCta")} <ArrowRight className="h-3 w-3" />
              </Link>
            </motion.div>
          </div>

          {/* RIGHT — the live-tracking visual, drawn in code (no screenshots): an animated
              route with a vehicle in motion, a geofence, and floating telemetry chips.
              Everything is vector/DOM, so it is crisp at any DPI and cheap to composite. */}
          <HeroLiveVisual />
        </div>
      </div>
    </section>
  );
}

/**
 * The hero visual: a stylised LIVE tracking scene in the Orbetra design language.
 * A glass panel with a map graticule, an animated route (dash-flow), a vehicle moving
 * along it (SVG <animateMotion> — no JS timers), a dashed geofence, and floating
 * telemetry chips. Replaces the former screenshot deck (founder: "kad butu profesionalu
 * ir grazu pagal orbetros dizaina" — and screenshots kept going stale).
 */
function HeroLiveVisual() {
  const { t } = useTranslation();
  const ROUTE = "M 40 340 C 120 300, 150 240, 240 232 S 400 260, 470 200 S 570 96, 600 84";
  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.7, delay: 0.2, ease: "easeOut" }}
      className="relative lg:scale-105 lg:origin-left select-none"
    >
      {/* soft halo behind the panel */}
      <div
        aria-hidden
        className="pointer-events-none absolute -inset-10"
        style={{ background: "radial-gradient(closest-side, rgba(76,77,207,0.22), transparent 70%)", filter: "blur(14px)" }}
      />

      <div className="relative glass-panel overflow-hidden">
        {/* top bar — product chrome, not a fake browser */}
        <div className="flex items-center justify-between px-4 py-2.5 border-b border-[rgba(76,77,207,0.18)]">
          <span className="mono text-[9px] tracking-[0.22em] uppercase text-[#B8CDEB]">
            {t("hero.viz.title")}
          </span>
          <span className="mono text-[9px] tracking-[0.22em] uppercase text-[#4c4dcf] flex items-center gap-1.5">
            <span className="h-1.5 w-1.5 rounded-full bg-[#4c4dcf] animate-pulse-dot" />
            LIVE
          </span>
        </div>

        <div className="relative aspect-[4/3] w-full">
          <svg viewBox="0 0 640 480" className="absolute inset-0 h-full w-full" aria-hidden>
            <defs>
              <linearGradient id="hero-route" x1="0" y1="1" x2="1" y2="0">
                <stop offset="0%" stopColor="#4338CA" />
                <stop offset="60%" stopColor="#4c4dcf" />
                <stop offset="100%" stopColor="#7C5CFC" />
              </linearGradient>
              <radialGradient id="hero-fence" cx="50%" cy="50%" r="50%">
                <stop offset="0%" stopColor="rgba(124,92,252,0.16)" />
                <stop offset="100%" stopColor="rgba(124,92,252,0.02)" />
              </radialGradient>
            </defs>

            {/* map graticule */}
            {Array.from({ length: 9 }).map((_, i) => (
              <line key={`v${i}`} x1={80 * (i + 0)} y1="0" x2={80 * (i + 0)} y2="480" stroke="rgba(76,77,207,0.10)" strokeWidth="1" />
            ))}
            {Array.from({ length: 7 }).map((_, i) => (
              <line key={`h${i}`} x1="0" y1={80 * i} x2="640" y2={80 * i} stroke="rgba(76,77,207,0.08)" strokeWidth="1" />
            ))}
            {/* secondary "streets" */}
            <path d="M 0 120 L 640 180 M 120 0 L 220 480 M 0 420 L 640 330 M 430 0 L 520 480" stroke="rgba(122,140,170,0.12)" strokeWidth="1.5" fill="none" />

            {/* geofence: dashed circle at the destination */}
            <circle cx="588" cy="92" r="54" fill="url(#hero-fence)" stroke="#7C5CFC" strokeOpacity="0.55" strokeWidth="1.5" strokeDasharray="5 5" />
            {/* geofence: dashed polygon depot near the origin */}
            <path d="M 24 402 L 96 384 L 128 420 L 90 456 L 34 446 Z" fill="rgba(76,77,207,0.08)" stroke="#4c4dcf" strokeOpacity="0.5" strokeWidth="1.5" strokeDasharray="5 5" />

            {/* route: soft underlay + animated brand stroke */}
            <path d={ROUTE} fill="none" stroke="rgba(76,77,207,0.25)" strokeWidth="7" strokeLinecap="round" />
            <path d={ROUTE} fill="none" stroke="url(#hero-route)" strokeWidth="2.5" strokeLinecap="round" strokeDasharray="10 8" className="animate-dash-flow" />

            {/* origin + destination */}
            <circle cx="40" cy="340" r="5" fill="#059669" />
            <circle cx="40" cy="340" r="10" fill="none" stroke="#059669" strokeOpacity="0.4">
              <animate attributeName="r" values="6;14;6" dur="3s" repeatCount="indefinite" />
              <animate attributeName="stroke-opacity" values="0.5;0;0.5" dur="3s" repeatCount="indefinite" />
            </circle>
            <circle cx="600" cy="84" r="5" fill="#7C5CFC" />

            {/* other fleet vehicles, parked */}
            <circle cx="180" cy="120" r="4" fill="#8A93A6" />
            <circle cx="520" cy="380" r="4" fill="#8A93A6" />
            <g transform="translate(300, 392)">
              <circle r="11" fill="rgba(76,77,207,0.9)" stroke="#fff" strokeWidth="1.5" />
              <text x="0" y="3.5" textAnchor="middle" fontSize="10" fontWeight="700" fill="#fff">3</text>
            </g>

            {/* THE vehicle — navigation arrow riding the route */}
            <g>
              <animateMotion dur="16s" repeatCount="indefinite" rotate="auto" path={ROUTE} keyPoints="0;1" keyTimes="0;1" calcMode="linear" />
              <circle r="13" fill="rgba(76,77,207,0.25)">
                <animate attributeName="r" values="11;16;11" dur="2.4s" repeatCount="indefinite" />
              </circle>
              <path d="M 8 0 L -6 6 L -3 0 L -6 -6 Z" fill="#fff" stroke="#4c4dcf" strokeWidth="1.5" strokeLinejoin="round" />
            </g>
          </svg>

          {/* floating telemetry chips */}
          <div className="absolute left-4 top-4 animate-float-y" style={{ animationDelay: "0.6s" }}>
            <VizChip color="#059669" label={t("hero.viz.eventLabel")} value={t("hero.viz.eventValue")} />
          </div>
          <div className="absolute right-4 top-[38%] animate-float-y" style={{ animationDelay: "1.8s" }}>
            <VizChip color="#4c4dcf" label={t("hero.viz.speedLabel")} value="87 km/val" big />
          </div>
          <div className="absolute left-4 bottom-14 animate-float-y" style={{ animationDelay: "3s" }}>
            <VizChip color="#B45309" label="CAN" value={t("hero.viz.fuelValue")} />
          </div>
        </div>

        {/* bottom strip — the route readout */}
        <div className="flex items-center justify-between px-4 py-2.5 border-t border-[rgba(76,77,207,0.18)]">
          <span className="mono text-[9.5px] tracking-[0.18em] uppercase text-[#7A8CAA]">
            {t("hero.viz.routeLabel")}
          </span>
          <span className="mono text-[10px] tracking-[0.14em] text-[#B8CDEB]">
            VILNIUS <span className="text-[#4c4dcf]">→</span> KAUNAS · A1 · 102 km
          </span>
        </div>
      </div>
    </motion.div>
  );
}

function VizChip({ color, label, value, big }: { color: string; label: string; value: string; big?: boolean }) {
  return (
    <div
      className="rounded border px-3 py-2 backdrop-blur-md"
      style={{
        background: "rgba(6,10,22,0.85)",
        borderColor: "rgba(76,77,207,0.3)",
        boxShadow: `0 8px 24px -10px rgba(0,0,0,0.7), 0 0 18px -8px ${color}66`,
      }}
    >
      <div className="mono text-[8.5px] tracking-[0.22em] uppercase flex items-center gap-1.5" style={{ color }}>
        <span className="h-1 w-1 rounded-full" style={{ background: color, boxShadow: `0 0 6px ${color}` }} />
        {label}
      </div>
      <div className={`mono text-ink leading-tight ${big ? "text-lg font-bold" : "text-[12px] font-semibold"} mt-0.5`}>{value}</div>
    </div>
  );
}
