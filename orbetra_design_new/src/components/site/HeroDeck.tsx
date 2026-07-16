import { motion, AnimatePresence } from "framer-motion";
import { useEffect, useState } from "react";
import { Link } from "@tanstack/react-router";
import {
  ArrowRight,
  Users,
  TrendingUp,
  LayoutDashboard,
  Truck,
  Bell,
  Settings,
  MapPin,
  Search,
  Check,
} from "lucide-react";
import { TabMap } from "./TabMap";

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
                GPS for small fleets · 1–20 vehicles
              </span>
            </motion.div>

            <motion.h1
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.55, ease: "easeOut", delay: 0.05 }}
              className="display font-bold text-ink leading-[0.98] tracking-tight mt-6"
              style={{ fontSize: "clamp(2.75rem, 5.6vw, 4.75rem)" }}
            >
              Know where every van is.
              <br />
              <span className="text-gradient">Down to the minute.</span>
            </motion.h1>

            <motion.p
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.5, delay: 0.15 }}
              className="mt-6 text-lg text-muted-foreground max-w-xl leading-relaxed"
            >
              Live map, trip history, idle & speeding alerts, driver reports. Plug in
              your Teltonika device, open the dashboard on your phone, done — no IT team required.
            </motion.p>

            <motion.ul
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.5, delay: 0.22 }}
              className="mt-7 grid gap-2.5"
            >
              {[
                "Setup in an afternoon — one SMS per device",
                "Flat per-vehicle price · no seat fees, no surprises",
                "Works on phone, tablet, laptop · EU-hosted",
              ].map((f) => (
                <li key={f} className="flex items-center gap-3 text-sm text-ink/90">
                  <span className="grid place-items-center h-5 w-5 rounded-full bg-[rgba(76,77,207,0.1)] border border-[rgba(76,77,207,0.3)] shrink-0">
                    <Check className="h-3 w-3 text-[#4c4dcf]" strokeWidth={2.5} />
                  </span>
                  {f}
                </li>
              ))}
            </motion.ul>

            <motion.div
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.5, delay: 0.3 }}
              className="mt-9 flex flex-wrap items-center gap-3"
            >
              <Link to="/pilot" className="pill-primary hover:pill-primary-hover">
                Start free trial <ArrowRight className="h-4 w-4" />
              </Link>
              <Link to="/pricing" className="pill-ghost hover:border-[color:var(--brand-cyan)]">
                See pricing
              </Link>
            </motion.div>

            <div className="mt-8 flex items-center gap-6 mono text-[10.5px] tracking-[0.2em] uppercase text-[#7A8CAA]">
              <span>30-day free trial</span>
              <span className="h-1 w-1 rounded-full bg-[#7A8CAA]/50" />
              <span>No card required</span>
              <span className="h-1 w-1 rounded-full bg-[#7A8CAA]/50" />
              <span>Cancel anytime</span>
            </div>
          </div>

          {/* RIGHT — rotating admin console deck, tilted sideways */}
          <HeroConsoleDeck />
        </div>
      </div>
    </section>
  );
}

const DECK_PAGES: { key: AdminPage; caption: string }[] = [
  { key: "map",       caption: "app.orbetra.eu · LIVE MAP" },
  { key: "analytics", caption: "app.orbetra.eu · REPORTS" },
  { key: "alerts",    caption: "app.orbetra.eu · ALERTS" },
];

function HeroConsoleDeck() {
  const [idx, setIdx] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setIdx((i) => (i + 1) % DECK_PAGES.length), 5200);
    return () => clearInterval(t);
  }, []);
  const current = DECK_PAGES[idx];

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.7, delay: 0.2, ease: "easeOut" }}
      className="relative lg:scale-110 lg:origin-left"
      style={{ perspective: "1600px" }}
    >
      {/* Soft cyan halo */}
      <div
        aria-hidden
        className="pointer-events-none absolute -inset-10"
        style={{
          background:
            "radial-gradient(closest-side, rgba(76,77,207,0.22), transparent 70%)",
          filter: "blur(14px)",
        }}
      />

      {/* Tilted 3D wrapper */}
      <div
        className="relative"
        style={{
          transform: "rotateY(-14deg) rotateX(4deg) rotateZ(-1deg)",
          transformStyle: "preserve-3d",
        }}
      >
        {/* Back stack cards for depth */}
        <div
          aria-hidden
          className="absolute inset-0 rounded-xl border border-[rgba(76,77,207,0.15)]"
          style={{
            transform: "translate3d(28px, 22px, -60px)",
            background: "linear-gradient(180deg, rgba(10,20,40,0.55), rgba(4,7,15,0.55))",
            boxShadow: "0 20px 60px -30px rgba(76,77,207,0.25)",
          }}
        />
        <div
          aria-hidden
          className="absolute inset-0 rounded-xl border border-[rgba(91,33,182,0.14)]"
          style={{
            transform: "translate3d(14px, 11px, -30px)",
            background: "linear-gradient(180deg, rgba(10,20,40,0.7), rgba(4,7,15,0.7))",
          }}
        />

        <AnimatePresence mode="wait">
          <motion.div
            key={current.key}
            initial={{ opacity: 0, rotateY: 22, x: 40, filter: "blur(6px)" }}
            animate={{ opacity: 1, rotateY: 0,  x: 0,  filter: "blur(0px)" }}
            exit={{    opacity: 0, rotateY: -22, x: -40, filter: "blur(6px)" }}
            transition={{ duration: 0.65, ease: [0.22, 1, 0.36, 1] }}
            style={{ transformStyle: "preserve-3d", transformOrigin: "left center" }}
          >
            <AdminConsole page={current.key} caption={current.caption} />
          </motion.div>
        </AnimatePresence>
      </div>

      {/* Pagination dots */}
      <div className="mt-5 flex items-center gap-2 justify-center lg:justify-start">
        {DECK_PAGES.map((p, i) => (
          <button
            key={p.key}
            onClick={() => setIdx(i)}
            aria-label={`Show ${p.key}`}
            className="group relative h-1.5 rounded-full transition-all"
            style={{
              width: i === idx ? 28 : 10,
              background: i === idx ? "#4c4dcf" : "rgba(184,205,235,0.25)",
              boxShadow: i === idx ? "0 0 10px rgba(76,77,207,0.6)" : "none",
            }}
          />
        ))}
        <span className="mono text-[10px] tracking-[0.22em] uppercase text-[#7A8CAA] ml-2">
          {current.key}
        </span>
      </div>
    </motion.div>
  );
}

type AdminPage = "map" | "analytics" | "alerts";

const NAV = [
  { key: "overview",  icon: LayoutDashboard, label: "Overview" },
  { key: "map",       icon: MapPin,          label: "Live Map" },
  { key: "fleet",     icon: Truck,           label: "Vehicles", badge: "12" },
  { key: "analytics", icon: TrendingUp,      label: "Reports" },
  { key: "alerts",    icon: Bell,            label: "Alerts",   badge: "3", alert: true },
  { key: "tenants",   icon: Users,           label: "Drivers" },
  { key: "settings",  icon: Settings,        label: "Settings" },
];

function AdminConsole({
  page,
  caption,
}: {
  page: AdminPage;
  caption?: string;
}) {
  const activeKey = page === "map" ? "map" : page === "analytics" ? "analytics" : "alerts";
  const pageLabel =
    page === "map" ? "LIVE MAP" : page === "analytics" ? "ANALYTICS · 30D" : "ALERTS · 07";

  return (
    <div
      className="relative rounded-xl overflow-hidden border backdrop-blur-md flex flex-col h-[480px]"
      style={{
        borderColor: "rgba(76,77,207,0.28)",
        background: "linear-gradient(180deg, rgba(10,20,40,0.92) 0%, rgba(4,7,15,0.94) 100%)",
        boxShadow:
          "0 30px 80px -30px rgba(76,77,207,0.4), 0 0 0 1px rgba(76,77,207,0.05) inset",
      }}
    >
      {/* Chrome */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-[rgba(76,77,207,0.15)] bg-[rgba(4,7,15,0.7)] shrink-0">
        <div className="flex items-center gap-1.5">
          <span className="h-2 w-2 rounded-full bg-[#B45309]/70" />
          <span className="h-2 w-2 rounded-full bg-[#4c4dcf]/70" />
          <span className="h-2 w-2 rounded-full bg-[#059669]/70" />
        </div>
        <span className="mono text-[9px] tracking-[0.22em] uppercase text-[#B8CDEB]">
          app.orbetra.eu / {page}
        </span>
        <span className="mono text-[9px] tracking-[0.22em] uppercase text-[#4c4dcf] flex items-center gap-1">
          <span className="h-1.5 w-1.5 rounded-full bg-[#4c4dcf] animate-pulse-dot" />
          LIVE
        </span>
      </div>

      {/* Body */}
      <div className="grid grid-cols-[112px_1fr] flex-1 min-h-0">
        {/* Sidebar */}
        <aside className="border-r border-[rgba(76,77,207,0.12)] bg-[rgba(4,7,15,0.55)] py-3 px-2 flex flex-col gap-0.5">
          <div className="flex items-center gap-1.5 px-1.5 pb-3 mb-1 border-b border-[rgba(76,77,207,0.1)]">
            <span
              className="h-4 w-4 rounded-sm grid place-items-center"
              style={{
                background: "linear-gradient(135deg,#4c4dcf,#5B21B6)",
                boxShadow: "0 0 8px rgba(76,77,207,0.5)",
              }}
            >
              <span className="h-1.5 w-1.5 rounded-full bg-[#04070F]" />
            </span>
            <span className="mono text-[8.5px] tracking-[0.22em] uppercase text-ink font-semibold">
              ORBETRA
            </span>
          </div>

          {NAV.map((n) => {
            const Icon = n.icon;
            const active = n.key === activeKey;
            return (
              <div
                key={n.key}
                className="relative flex items-center gap-1.5 rounded-md px-1.5 py-1.5"
                style={{
                  background: active ? "rgba(76,77,207,0.14)" : "transparent",
                  border: `1px solid ${active ? "rgba(76,77,207,0.35)" : "transparent"}`,
                }}
              >
                {active && (
                  <span
                    className="absolute left-0 top-1/2 -translate-y-1/2 h-4 w-[2px] rounded-r"
                    style={{ background: "#4c4dcf", boxShadow: "0 0 6px #4c4dcf" }}
                  />
                )}
                <Icon
                  className="h-3 w-3 shrink-0"
                  style={{ color: active ? "#4c4dcf" : "#B8CDEB" }}
                  strokeWidth={1.75}
                />
                <span
                  className="text-[9.5px] leading-none flex-1 truncate"
                  style={{ color: active ? "#4c4dcf" : "#B8CDEB" }}
                >
                  {n.label}
                </span>
                {n.badge && (
                  <span
                    className="mono text-[7.5px] tracking-wider px-1 py-[1px] rounded"
                    style={{
                      color: n.alert ? "#B45309" : "#4c4dcf",
                      background: n.alert ? "rgba(180,83,9,0.15)" : "rgba(76,77,207,0.12)",
                      border: `1px solid ${n.alert ? "rgba(180,83,9,0.35)" : "rgba(76,77,207,0.3)"}`,
                    }}
                  >
                    {n.badge}
                  </span>
                )}
              </div>
            );
          })}

          <div className="mt-auto pt-2 border-t border-[rgba(76,77,207,0.1)] flex items-center gap-1.5 px-1">
            <span className="h-4 w-4 rounded-full bg-gradient-to-br from-[#5B21B6] to-[#4c4dcf] shrink-0" />
            <div className="min-w-0">
              <div className="text-[8.5px] text-ink leading-tight truncate">L. Petrauskas</div>
              <div className="mono text-[7px] tracking-[0.15em] uppercase text-[#7A8CAA] leading-tight">Admin</div>
            </div>
          </div>
        </aside>

        {/* Main */}
        <main className="p-3 flex flex-col gap-2.5 min-w-0">
          {/* Topbar */}
          <div className="flex items-center gap-2">
            <div className="flex-1 flex items-center gap-1.5 rounded-md px-2 py-1 border border-[rgba(76,77,207,0.15)] bg-[rgba(10,20,40,0.6)]">
              <Search className="h-2.5 w-2.5 text-[#7A8CAA]" strokeWidth={2} />
              <span className="text-[9px] text-[#7A8CAA]">Search vehicles, drivers, trips…</span>
            </div>
            <span className="mono text-[8.5px] tracking-[0.2em] uppercase text-[#4c4dcf]">
              {pageLabel}
            </span>
          </div>

          {page === "map" && <MapPageBody />}
          {page === "analytics" && <AnalyticsPageBody />}
          {page === "alerts" && <AlertsPageBody />}
        </main>
      </div>

      {caption && (
        <div className="flex items-center justify-between px-3 py-1.5 border-t border-[rgba(76,77,207,0.1)] bg-[rgba(4,7,15,0.5)] mono text-[8.5px] tracking-[0.22em] uppercase shrink-0">
          <span className="text-[#4c4dcf]">{caption}</span>
          <span className="text-[#B8CDEB]">YOUR FLEET</span>
        </div>
      )}
    </div>
  );
}

function MapPageBody() {
  const vehicles = [
    { id: "N-06", name: "MAN TGX 26.510", status: "MOVING", speed: 87, tint: "#B45309" },
    { id: "N-02", name: "Volvo FH16",     status: "MOVING", speed: 72, tint: "#4c4dcf" },
    { id: "N-11", name: "Scania R500",    status: "IDLE",   speed: 0,  tint: "#5B21B6" },
    { id: "N-08", name: "DAF XF 480",     status: "MOVING", speed: 64, tint: "#4c4dcf" },
  ];
  return (
    <>
      <div className="grid grid-cols-3 gap-1.5">
        {[
          { k: "MOVING",  v: "08", tint: "#4c4dcf" },
          { k: "ALERTS",  v: "03", tint: "#B45309" },
          { k: "AVG SPD", v: "62", tint: "#5B21B6" },
        ].map((s) => <KpiTile key={s.k} {...s} />)}
      </div>

      <div
        className="relative rounded-md overflow-hidden border border-[rgba(76,77,207,0.22)] h-[220px]"
        style={{ background: "rgba(4,7,15,0.9)" }}
      >
        <TabMap
          center={[18.5, 52.2]}
          zoom={3.9}
          markers={HERO_MAP_NODES}
          routes={HERO_MAP_ROUTES}
        />
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0"
          style={{
            background:
              "radial-gradient(closest-side, transparent 60%, rgba(4,7,15,0.45) 100%)",
          }}
        />
        <div className="absolute bottom-1.5 left-2 mono text-[8px] tracking-[0.2em] uppercase text-[#B8CDEB] bg-[rgba(4,7,15,0.6)] px-1.5 py-0.5 rounded">
          EU · 12 VEHICLES · LIVE
        </div>
      </div>

      <div className="space-y-1">
        {vehicles.map((v) => (
          <div
            key={v.id}
            className="flex items-center gap-2 rounded-md px-2 py-1 border border-[rgba(76,77,207,0.08)] bg-[rgba(10,20,40,0.5)]"
          >
            <span
              className="h-1.5 w-1.5 rounded-full shrink-0"
              style={{ background: v.tint, boxShadow: `0 0 6px ${v.tint}` }}
            />
            <span className="mono text-[8.5px] tracking-[0.18em] font-semibold shrink-0" style={{ color: v.tint }}>
              {v.id}
            </span>
            <span className="text-[9.5px] text-ink truncate flex-1 min-w-0">{v.name}</span>
            <span
              className="mono text-[7.5px] tracking-[0.18em] uppercase px-1 py-[1px] rounded shrink-0"
              style={{
                color: v.status === "IDLE" ? "#B8CDEB" : "#4c4dcf",
                background: v.status === "IDLE" ? "rgba(184,205,235,0.08)" : "rgba(76,77,207,0.1)",
                border: `1px solid ${v.status === "IDLE" ? "rgba(184,205,235,0.2)" : "rgba(76,77,207,0.25)"}`,
              }}
            >
              {v.status}
            </span>
            <span className="mono text-[10px] font-semibold text-ink tabular-nums w-8 text-right shrink-0">
              {v.speed}
            </span>
          </div>
        ))}
      </div>
    </>
  );
}

function AnalyticsPageBody() {
  const bars = [30, 42, 36, 55, 48, 62, 58, 72, 68, 84, 78, 92, 88, 96];
  const max = Math.max(...bars);
  const routes = [
    { r: "Warsaw → Berlin",     v: "1,204", d: "+8.2%" },
    { r: "Vilnius → Riga",      v: "892",   d: "+12.4%" },
    { r: "Munich → Vienna",     v: "748",   d: "+3.1%" },
    { r: "Gdańsk → Warsaw",     v: "612",   d: "−2.4%", down: true },
    { r: "Kraków → Budapest",   v: "584",   d: "+5.7%" },
    { r: "Riga → Tallinn",      v: "430",   d: "+1.2%" },
    { r: "Berlin → Hamburg",    v: "398",   d: "−0.8%", down: true },
    { r: "Vienna → Prague",     v: "356",   d: "+4.3%" },
  ];
  return (
    <>
      <div className="grid grid-cols-3 gap-1.5">
        <KpiTile k="TRIPS 30D"  v="842"    tint="#4c4dcf" />
        <KpiTile k="Δ WoW"      v="+6.1%"  tint="#059669" />
        <KpiTile k="AVG DIST"   v="128 km" tint="#5B21B6" />
      </div>

      <div
        className="rounded-md border border-[rgba(76,77,207,0.18)] px-2.5 py-2"
        style={{ background: "linear-gradient(180deg, rgba(10,20,40,0.7), rgba(4,7,15,0.6))" }}
      >
        <div className="flex items-center justify-between mono text-[7.5px] tracking-[0.22em] uppercase">
          <span className="text-[#B8CDEB]">TRIPS · DAILY</span>
          <span className="text-[#059669]">+12.4% WoW</span>
        </div>
        <div className="mt-2 flex items-end gap-[3px] h-[140px]">
          {bars.map((b, i) => (
            <div
              key={i}
              className="flex-1 rounded-sm"
              style={{
                height: `${(b / max) * 100}%`,
                background: "linear-gradient(180deg,#5B21B6 0%, #4c4dcf 100%)",
                opacity: 0.55 + (i / bars.length) * 0.45,
              }}
            />
          ))}
        </div>
        <div className="mt-1 flex items-center justify-between mono text-[7px] tracking-[0.18em] uppercase text-[#7A8CAA]">
          <span>NOV 22</span>
          <span>DEC 5</span>
        </div>
      </div>

      <div className="space-y-1">
        {routes.map((r) => (
          <div
            key={r.r}
            className="flex items-center gap-2 rounded-md px-2 py-1 border border-[rgba(76,77,207,0.08)] bg-[rgba(10,20,40,0.5)]"
          >
            <span className="h-1.5 w-1.5 rounded-full bg-[#4c4dcf] shrink-0" style={{ boxShadow: "0 0 6px #4c4dcf" }} />
            <span className="text-[9.5px] text-ink truncate flex-1 min-w-0">{r.r}</span>
            <span className="mono text-[10px] font-semibold text-ink tabular-nums shrink-0">{r.v}</span>
            <span
              className="mono text-[8px] tracking-[0.15em] font-semibold shrink-0 w-12 text-right"
              style={{ color: r.down ? "#EF4444" : "#059669" }}
            >
              {r.d}
            </span>
          </div>
        ))}
      </div>
    </>
  );
}

function AlertsPageBody() {
  const alerts = [
    { t: "02:41", c: "#B45309", tag: "GEOFENCE", txt: "N-06 exit — Vilnius DC" },
    { t: "02:18", c: "#EF4444", tag: "SPEED",    txt: "N-11 · 112 km/h · A2" },
    { t: "01:57", c: "#4c4dcf", tag: "IGNITION", txt: "N-08 on · Munich HUB" },
    { t: "01:33", c: "#B45309", tag: "IDLE",     txt: "N-04 idle 42m · Vienna" },
    { t: "01:12", c: "#5B21B6", tag: "PTO",      txt: "N-15 PTO engaged · Tallinn" },
    { t: "00:58", c: "#059669", tag: "GEOFENCE", txt: "N-02 entry — Berlin DC" },
    { t: "00:42", c: "#EF4444", tag: "SPEED",    txt: "N-09 · 94 km/h · A4" },
    { t: "00:31", c: "#B45309", tag: "IDLE",     txt: "N-03 idle 28m · Riga" },
    { t: "00:15", c: "#4c4dcf", tag: "IGNITION", txt: "N-12 off · Warsaw HUB" },
  ];
  return (
    <>
      <div className="grid grid-cols-3 gap-1.5">
        <KpiTile k="OPEN"     v="07" tint="#B45309" />
        <KpiTile k="CRITICAL" v="02" tint="#EF4444" />
        <KpiTile k="RESOLVED" v="48" tint="#059669" />
      </div>
      <div className="space-y-1">
        {alerts.map((a, i) => (
          <div
            key={i}
            className="flex items-start gap-2 rounded-md px-2 py-1.5 border border-[rgba(180,83,9,0.12)] bg-[rgba(10,8,4,0.5)]"
          >
            <span
              className="mt-1 h-1.5 w-1.5 rounded-full shrink-0"
              style={{ background: a.c, boxShadow: `0 0 6px ${a.c}` }}
            />
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-1.5">
                <span
                  className="mono text-[7.5px] tracking-[0.2em] uppercase px-1 py-[1px] rounded"
                  style={{ color: a.c, background: `${a.c}18`, border: `1px solid ${a.c}55` }}
                >
                  {a.tag}
                </span>
                <span className="mono text-[8px] tracking-[0.18em] text-[#B8CDEB] ml-auto">{a.t}</span>
              </div>
              <div className="text-[10px] text-ink truncate mt-0.5">{a.txt}</div>
            </div>
          </div>
        ))}
      </div>
    </>
  );
}

function KpiTile({ k, v, tint }: { k: string; v: string; tint: string }) {
  return (
    <div
      className="rounded-md px-2 py-1.5 border"
      style={{
        borderColor: `${tint}33`,
        background: `linear-gradient(180deg, ${tint}12, transparent)`,
      }}
    >
      <div className="mono text-[7.5px] tracking-[0.22em] uppercase text-[#B8CDEB]">{k}</div>
      <div className="mono text-[14px] font-semibold" style={{ color: tint }}>{v}</div>
    </div>
  );
}

function AdminShowcase() {
  return (
    <div className="relative w-full min-h-[560px] lg:min-h-[600px]">
      {/* Ambient orbital glow behind the stack */}
      <div
        aria-hidden
        className="pointer-events-none absolute -inset-10"
        style={{
          background:
            "radial-gradient(closest-side, rgba(76,77,207,0.22), transparent 70%), radial-gradient(closest-side at 80% 20%, rgba(91,33,182,0.14), transparent 65%)",
          filter: "blur(8px)",
        }}
      />

      {/* Main: Live Map */}
      <motion.div
        initial={{ opacity: 0, y: 18 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.25, duration: 0.6, ease: "easeOut" }}
        className="absolute left-0 right-8 top-8 z-10"
        style={{ transform: "perspective(1400px) rotateY(-6deg) rotateX(2deg)" }}
      >
        <AdminConsole page="map" caption="FIG.A · LIVE MAP" />
      </motion.div>

      {/* Floating: Analytics — top right */}
      <motion.div
        initial={{ opacity: 0, y: -14, x: 12 }}
        animate={{ opacity: 1, y: 0, x: 0 }}
        transition={{ delay: 0.5, duration: 0.55, ease: "easeOut" }}
        className="absolute -right-6 -top-4 z-20 origin-top-right"
        style={{
          width: 320,
          transform: "perspective(1400px) rotateY(-12deg) rotateX(4deg) scale(0.78)",
        }}
      >
        <AdminConsole page="analytics" caption="FIG.B · ANALYTICS" />
      </motion.div>

      {/* Floating: Alerts — bottom left */}
      <motion.div
        initial={{ opacity: 0, y: 20, x: -14 }}
        animate={{ opacity: 1, y: 0, x: 0 }}
        transition={{ delay: 0.65, duration: 0.55, ease: "easeOut" }}
        className="absolute -left-10 -bottom-6 z-20 origin-bottom-left hidden sm:block"
        style={{
          width: 340,
          transform: "perspective(1400px) rotateY(-4deg) rotateX(-3deg) scale(0.75)",
        }}
      >
        <AdminConsole page="alerts" caption="FIG.C · ALERTS" />
      </motion.div>
    </div>
  );
}


