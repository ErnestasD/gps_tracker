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
              <div className="min-w-0">
                <div className="mono text-[11px] font-semibold text-ink leading-tight truncate">{d.code}</div>
                <div className="mono text-[9.5px] tracking-wide uppercase text-[#7A8CAA] truncate">{d.role}</div>
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

function TrustBand() {
  const items = [
    { icon: Server, title: "EU data residency", body: "Hosted in Frankfurt and Warsaw regions." },
    { icon: Shield, title: "GDPR by design", body: "Data controller / processor separation baked in." },
    { icon: GlobeIcon, title: "Open geodata", body: "OpenStreetMap tiles — no US map vendors in your stack." },
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
          <Link to="/pilot" className="mt-8 pill-primary hover:pill-primary-hover">
            Start free trial <ArrowRight className="h-4 w-4" />
          </Link>
        </div>
      </div>
    </section>
  );
}
