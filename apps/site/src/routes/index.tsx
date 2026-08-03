import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowRight, Shield, Globe as GlobeIcon, Server } from "lucide-react";
import { SectionHeading } from "@/components/site/SectionHeading";
import { VerticalsGrid } from "@/components/site/VerticalsGrid";
import { TabShowcase } from "@/components/site/TabShowcase";
import { JourneyTrajectory } from "@/components/site/JourneyTrajectory";
import { StatTile } from "@/components/site/StatTile";
import { CodeCard } from "@/components/site/CodeCard";
import { HeroDeck } from "@/components/site/HeroDeck";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Orbetra — GPS tracking for small fleets (1–20 vehicles)" },
      { name: "description", content: "Simple, EU-hosted GPS tracking for small fleets and owner-operators. Live map, trip history, alerts. Setup in an afternoon. Flat per-vehicle pricing." },
    ],
  }),
  component: HomePage,
});

function HomePage() {
  return (
    <>
      <Hero />
      <TrustStrip />
      <TwoTracks />

      <Section id="verticals" label="— BUILT FOR SMALL FLEETS" heading={<>Whatever you drive.<br /><span className="text-gradient">One dashboard runs it.</span></>}>
        <VerticalsGrid />
      </Section>

      <Section id="platform" label="— ONE APP · EVERY SCREEN" heading={<>Everything you need.<br /><span className="text-gradient">Nothing you don't.</span></>}>
        <div className="grid gap-14">
          <TabShowcase />
          <div className="grid gap-5 md:grid-cols-3">
            <StatTile label="Setup time" value={90} prefix="" suffix=" min" unit="from box to live" />
            <StatTile label="Update rate" value={10} suffix="s" unit="live map ping" />
            <StatTile label="Uptime target" value={999} prefix="" suffix="" unit="99.9% · target" />
          </div>
        </div>
      </Section>

      <Section id="how" label="— HOW IT WORKS" heading={<>From box on the desk<br /><span className="text-gradient">to live map, same day.</span></>}>
        <JourneyTrajectory />
      </Section>

      <Section id="api" label="— OPTIONAL · API & WEBHOOKS" heading={<>Need to plug it into your tools?<br /><span className="text-gradient">Every screen has an API.</span></>}>
        <div className="grid gap-10 lg:grid-cols-[1.2fr_1fr] items-center">
          <CodeCard />
          <div>
            <p className="text-muted-foreground text-lg">
              Most small fleets never touch this — the app already does everything.
              But if you run an ERP, dispatch tool or accounting system, Orbetra plugs in with real REST and signed webhooks.
            </p>
            <ul className="mt-6 space-y-3 text-sm">
              <li className="flex items-center gap-3"><Dot color="#2563EB" /> REST endpoints for vehicles, trips, geofences, reports</li>
              <li className="flex items-center gap-3"><Dot color="#7C5CFC" /> Signed webhook events (ignition, geofence, alert, low battery)</li>
              <li className="flex items-center gap-3"><Dot color="#10B981" /> Export to CSV, Excel or your accounting tool</li>
            </ul>
          </div>
        </div>
      </Section>

      <TrustBand />
      <WhiteLabelBand />
      <FinalCTA />
    </>
  );
}

function Dot({ color }: { color: string }) {
  return <span className="h-1.5 w-1.5 rounded-full shrink-0" style={{ background: color }} />;
}

function Hero() {
  return <HeroDeck />;
}

function TrustStrip() {
  const devices = [
    { code: "FMB series", role: "Universal CAN + BLE", status: "certified" },
    { code: "FMC series", role: "4G LTE Cat-1",         status: "certified" },
    { code: "TAT series", role: "Asset trackers",       status: "certified" },
    { code: "TFT100",     role: "Fuel + temperature",   status: "certified" },
    { code: "FMP100",     role: "Personal / OBD",       status: "certified" },
  ];
  return (
    <section aria-label="Runs on Teltonika" className="relative border-y border-[var(--hairline)] bg-[rgba(4,7,15,0.6)]">
      {/* radial hairline */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 opacity-70"
        style={{
          background:
            "radial-gradient(60% 100% at 15% 50%, rgba(76,77,207,0.12), transparent 65%), radial-gradient(50% 100% at 85% 50%, rgba(91,33,182,0.10), transparent 65%)",
        }}
      />
      <div className="relative mx-auto max-w-7xl px-6 py-8 grid gap-6 md:gap-8 md:grid-cols-[auto_1fr] items-center">
        {/* LEFT — device chip badge */}
        <div className="flex items-center gap-4">
          <div
            className="relative grid place-items-center h-16 w-16 shrink-0"
            style={{
              background: "linear-gradient(135deg, rgba(76,77,207,0.15), rgba(4,7,15,0.9))",
              border: "1px solid rgba(76,77,207,0.4)",
              borderRadius: 6,
              boxShadow: "0 0 32px -8px rgba(76,77,207,0.5), inset 0 1px 0 rgba(76,77,207,0.2)",
            }}
          >
            {/* pin grid — evokes a device footprint */}
            <div className="grid grid-cols-3 gap-1">
              {Array.from({ length: 9 }).map((_, i) => (
                <span
                  key={i}
                  className="h-1.5 w-1.5 rounded-full"
                  style={{
                    background: i === 4 ? "#4c4dcf" : "rgba(76,77,207,0.35)",
                    boxShadow: i === 4 ? "0 0 6px #4c4dcf" : undefined,
                  }}
                />
              ))}
            </div>
            <span className="absolute -top-1 -right-1 h-2 w-2 rounded-full bg-[#059669] animate-pulse-dot" />
          </div>
          <div>
            <div className="mono text-[10px] tracking-[0.28em] uppercase text-[#4c4dcf] flex items-center gap-2">
              <span className="h-[1px] w-6 bg-[#4c4dcf]" />
              INGEST · TCP:5027
            </div>
            <div className="font-display text-lg font-semibold text-ink leading-tight mt-1">
              Runs on <span className="text-gradient">Teltonika</span>
            </div>
            <div className="mono text-[11px] text-[#7A8CAA] mt-0.5">
              Native AVL · store-and-forward · zero middleware
            </div>
          </div>
        </div>

        {/* RIGHT — device slots */}
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2">
          {devices.map((d) => (
            <div
              key={d.code}
              className="group relative flex items-center gap-2 px-3 py-2"
              style={{
                background: "rgba(10,20,40,0.55)",
                border: "1px solid rgba(76,77,207,0.18)",
                borderRadius: 4,
              }}
            >
              <span className="grid place-items-center h-6 w-6 shrink-0 mono text-[9px] tracking-widest text-[#4c4dcf]"
                style={{ background: "rgba(76,77,207,0.08)", border: "1px solid rgba(76,77,207,0.3)", borderRadius: 3 }}
              >
                ●
              </span>
              <div className="min-w-0 flex-1">
                <div className="mono text-[11px] font-semibold text-ink leading-tight">{d.code}</div>
                <div className="mono text-[9.5px] tracking-wide uppercase text-[#7A8CAA] leading-snug break-words">{d.role}</div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function Section({ id, label, heading, children }: { id?: string; label: string; heading: React.ReactNode; children: React.ReactNode }) {
  return (
    <section id={id} className="relative py-24 md:py-32 px-6">
      <div className="mx-auto max-w-7xl">
        <SectionHeading label={label} className="mb-14 max-w-3xl">{heading}</SectionHeading>
        {children}
      </div>
    </section>
  );
}

function TwoTracks() {
  const tracks = [
    {
      label: "TRACK A · DIRECT",
      title: "Run your own fleet",
      body: "1–100 vehicles, Orbetra-branded, self-serve. Live map, trips and playback, geofences, rules & alerts, reports — from day one.",
      points: ["Per-vehicle pricing from €9/mo", "Setup in an afternoon", "30-day trial, no card"],
      cta: "Start free trial",
      to: "/signup" as const,
      accent: "var(--brand-blue)",
    },
    {
      label: "TRACK B · WHITE-LABEL",
      title: "Resell it as your own",
      body: "Uncapped devices under your brand and domain, sub-accounts per customer, shadow-mode migration from your current platform.",
      points: ["From €149/mo for 200 devices", "Custom domain + auto TLS, branded emails", "REST API, webhooks, sub-tenants"],
      cta: "White-label platform",
      to: "/tsp" as const,
      accent: "var(--brand-purple, #7C5CFC)",
    },
  ];
  return (
    <section className="px-6 py-20 md:py-24">
      <div className="mx-auto max-w-6xl">
        <div className="section-label">
          <span className="h-[1px] w-6 bg-[var(--brand-blue)]" />
          — TWO WAYS TO USE ORBETRA
        </div>
        <div className="mt-8 grid gap-5 md:grid-cols-2 items-stretch">
          {tracks.map((tr) => (
            <div key={tr.title} className="surface-card p-8 flex flex-col h-full">
              <div
                className="mono text-[10px] tracking-[0.22em] uppercase"
                style={{ color: tr.accent }}
              >
                {tr.label}
              </div>
              <h3 className="mt-3 font-display text-2xl font-bold text-ink">{tr.title}</h3>
              <p className="mt-3 text-sm text-muted-foreground">{tr.body}</p>
              <ul className="mt-5 space-y-2 text-sm flex-1">
                {tr.points.map((pt) => (
                  <li key={pt} className="flex items-start gap-3 text-ink/85">
                    <span
                      className="mt-1.5 h-1.5 w-1.5 rounded-full shrink-0"
                      style={{ background: tr.accent }}
                    />
                    {pt}
                  </li>
                ))}
              </ul>
              <Link to={tr.to} className="mt-7 pill-ghost hover:border-[var(--brand-blue)] hover:text-[var(--brand-blue)] w-fit">
                {tr.cta} <ArrowRight className="h-4 w-4" />
              </Link>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function TrustBand() {
  const items = [
    { icon: Server, title: "EU data residency", body: "Hosted in Frankfurt and Warsaw regions." },
    { icon: Shield, title: "GDPR by design", body: "Data controller / processor separation baked in." },
    { icon: GlobeIcon, title: "Self-hosted geocoding & routing", body: "Photon + OSRM, EU-hosted. Map tiles are served by Mapbox." },
  ];
  return (
    <section className="py-16 px-6 border-y border-[var(--hairline)] bg-[var(--blueprint)]/50">
      <div className="mx-auto max-w-7xl grid gap-8 md:grid-cols-3">
        {items.map((it) => {
          const Icon = it.icon;
          return (
            <div key={it.title} className="flex items-start gap-4">
              <span className="h-10 w-10 rounded-md bg-[rgba(37,99,235,0.08)] border border-[var(--hairline)] grid place-items-center shrink-0">
                <Icon className="h-5 w-5 text-[var(--brand-blue)]" strokeWidth={1.5} />
              </span>
              <div>
                <div className="font-display font-semibold text-ink">{it.title}</div>
                <div className="text-sm text-muted-foreground">{it.body}</div>
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}

function WhiteLabelBand() {
  return (
    <section className="px-6 py-20 relative">
      <div
        aria-hidden
        className="absolute inset-0 pointer-events-none opacity-60"
        style={{
          background:
            "radial-gradient(50% 60% at 20% 50%, rgba(124,92,252,0.10), transparent 70%), radial-gradient(50% 60% at 80% 50%, rgba(37,99,235,0.08), transparent 70%)",
        }}
      />
      <div className="relative mx-auto max-w-6xl surface-card p-8 md:p-12 grid gap-8 md:grid-cols-[1.2fr_1fr] items-center">
        <div>
          <div className="mono text-[11px] tracking-[0.2em] uppercase text-[color:var(--brand-purple,#7C5CFC)] flex items-center gap-2">
            <span className="h-[1px] w-6 bg-[color:var(--brand-purple,#7C5CFC)]" />
            — RESELLERS · WHITE-LABEL · TSP
          </div>
          <h2 className="mt-4 display text-3xl md:text-4xl font-bold text-ink leading-[1.1]">
            Reselling GPS to your own customers?{" "}
            <span className="text-gradient">White-label the whole platform.</span>
          </h2>
          <p className="mt-4 text-muted-foreground max-w-xl">
            Your domain, your logo, your customers. Sub-tenants, REST API and webhooks
            included. From <span className="text-ink font-medium">€149/mo</span> for 200
            devices — the lowest serious white-label entry in the market.
          </p>
          <div className="mt-6 flex flex-wrap gap-3">
            <Link to="/tsp" className="pill-primary hover:pill-primary-hover">
              See partner program <ArrowRight className="h-4 w-4" />
            </Link>
            <Link
              to="/pricing"
              hash="tsp"
              className="pill-ghost hover:border-[var(--brand-blue)] hover:text-[var(--brand-blue)]"
            >
              TSP pricing
            </Link>
          </div>
        </div>
        <ul className="grid gap-3 text-sm">
          {[
            { k: "Your brand", v: "Custom domain, logo, colors — Orbetra never appears" },
            { k: "Sub-tenants", v: "Isolated accounts per end customer" },
            { k: "REST + webhooks", v: "Plug into your ERP or dispatch stack" },
            { k: "60-day pilot", v: "Free · up to 500 devices · no card" },
          ].map((f) => (
            <li key={f.k} className="flex gap-3 items-start">
              <span className="mt-1 h-1.5 w-1.5 rounded-full bg-[color:var(--brand-purple,#7C5CFC)] shrink-0" />
              <div>
                <div className="text-ink font-medium">{f.k}</div>
                <div className="text-muted-foreground">{f.v}</div>
              </div>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}

function FinalCTA() {
  return (
    <section className="px-6 py-24">
      <div className="mx-auto max-w-6xl surface-card p-12 md:p-20 relative overflow-hidden text-center">
        <div
          className="absolute inset-0 opacity-40"
          style={{ background: "radial-gradient(600px circle at 30% 20%, rgba(37,99,235,0.15), transparent 60%), radial-gradient(500px circle at 70% 80%, rgba(124,92,252,0.12), transparent 60%)" }}
        />
        <div className="relative">
          <span className="section-label justify-center">
            <span className="h-[1px] w-6 bg-[var(--brand-blue)]" />
            — READY WHEN YOU ARE
          </span>
          <h2 className="display text-4xl md:text-5xl font-bold leading-[1.05] mt-4 text-ink">
            Start with 1 vehicle.<br />
            <span className="text-gradient">Grow to 20 without changing tools.</span>
          </h2>
          <p className="mt-6 text-muted-foreground max-w-xl mx-auto">
            30-day free trial. No credit card. Cancel any time — your data exports in one click.
          </p>
          <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
            <Link to="/signup" className="pill-primary hover:pill-primary-hover">
              Start free trial <ArrowRight className="h-4 w-4" />
            </Link>
            <Link to="/tsp" className="pill-ghost hover:border-[var(--brand-blue)] hover:text-[var(--brand-blue)]">
              White-label it
            </Link>
          </div>
        </div>
      </div>
    </section>
  );
}
