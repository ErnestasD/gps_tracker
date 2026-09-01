import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowRight, Shield, Globe as GlobeIcon, Server } from "lucide-react";
import { Trans, useTranslation } from "react-i18next";
import { SectionHeading } from "@/components/site/SectionHeading";
import { VerticalsGrid } from "@/components/site/VerticalsGrid";
import { CodeCard } from "@/components/site/CodeCard";
import { HeroDeck } from "@/components/site/HeroDeck";

/** Prices are interpolated so the copy stays in one place per language. */
const DIRECT_FROM_PRICE = 9;
const DIRECT_FROM_DEVICES = 5;
const TSP_FROM_PRICE = 149;
const TSP_FROM_DEVICES = 200;

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Orbetra — GPS tracking for small fleets (1–100 vehicles)" },
      { name: "description", content: "Simple, EU-hosted GPS tracking for small fleets and owner-operators. Live map, trip history, alerts. Setup in an afternoon. Flat per-vehicle pricing." },
    ],
  }),
  component: HomePage,
});

function HomePage() {
  const { t } = useTranslation();
  return (
    <>
      <Hero />
      <TrustStrip />
      <TwoTracks />

      <Section id="verticals" label={t("home.verticals.label")} heading={<>{t("home.verticals.h1")}<br /><span className="text-gradient">{t("home.verticals.h2")}</span></>}>
        <VerticalsGrid />
      </Section>

      <Section id="api" label={t("home.api.label")} heading={<>{t("home.api.h1")}<br /><span className="text-gradient">{t("home.api.h2")}</span></>}>
        <div className="grid gap-10 lg:grid-cols-[1.2fr_1fr] items-center">
          <CodeCard />
          <div>
            <p className="text-muted-foreground text-lg">{t("home.api.body")}</p>
            <ul className="mt-6 space-y-3 text-sm">
              <li className="flex items-center gap-3"><Dot color="#2563EB" /> {t("home.api.b1")}</li>
              <li className="flex items-center gap-3"><Dot color="#7C5CFC" /> {t("home.api.b2")}</li>
              <li className="flex items-center gap-3"><Dot color="#10B981" /> {t("home.api.b3")}</li>
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
  const { t } = useTranslation();
  const devices = [
    { code: "FMB series", role: t("home.hardware.fmb") },
    { code: "FMC series", role: t("home.hardware.fmc") },
    { code: "TAT series", role: t("home.hardware.tat") },
    { code: "TFT100",     role: t("home.hardware.tft") },
    { code: "FMP100",     role: t("home.hardware.fmp") },
  ];
  return (
    <section aria-label={t("home.hardware.aria")} className="relative border-y border-[var(--hairline)] bg-[rgba(4,7,15,0.6)]">
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
              {t("home.hardware.supportedToday")} <span className="text-gradient">Teltonika</span>
            </div>
            <div className="mono text-[11px] text-[#7A8CAA] mt-0.5">
              {t("home.hardware.sub")}
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
  const { t } = useTranslation();
  const tracks = [
    {
      label: t("tracks.aLabel"),
      title: t("tracks.ownTitle"),
      body: t("tracks.ownBody"),
      points: [
        t("tracks.ownP1", { price: DIRECT_FROM_PRICE, devices: DIRECT_FROM_DEVICES }),
        t("tracks.ownP2"),
        t("tracks.ownP3"),
      ],
      cta: t("cta.trial"),
      to: "/signup" as const,
      accent: "var(--brand-blue)",
    },
    {
      label: t("tracks.bLabel"),
      title: t("tracks.resellTitle"),
      body: t("tracks.resellBody"),
      points: [
        t("tracks.resellP1", { price: TSP_FROM_PRICE, devices: TSP_FROM_DEVICES }),
        t("tracks.resellP2"),
        t("tracks.resellP3"),
      ],
      cta: t("tracks.resellCta"),
      to: "/tsp" as const,
      accent: "var(--brand-purple, #7C5CFC)",
    },
  ];
  return (
    <section className="px-6 py-20 md:py-24">
      <div className="mx-auto max-w-6xl">
        <div className="section-label">
          <span className="h-[1px] w-6 bg-[var(--brand-blue)]" />
          {t("tracks.label")}
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
  const { t } = useTranslation();
  const items = [
    { icon: Server, title: t("home.trust.t1"), body: t("home.trust.b1") },
    { icon: Shield, title: t("home.trust.t2"), body: t("home.trust.b2") },
    { icon: GlobeIcon, title: t("home.trust.t3"), body: t("home.trust.b3") },
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
  const { t } = useTranslation();
  const features = [
    { n: "01", k: t("home.wl.f1k"), v: t("home.wl.f1v") },
    { n: "02", k: t("home.wl.f2k"), v: t("home.wl.f2v") },
    { n: "03", k: t("home.wl.f3k"), v: t("home.wl.f3v") },
    { n: "04", k: t("home.wl.f4k"), v: t("home.wl.f4v") },
  ];
  return (
    <section className="px-6 py-24 relative">
      <div
        aria-hidden
        className="absolute inset-0 pointer-events-none opacity-60"
        style={{
          background:
            "radial-gradient(50% 60% at 20% 50%, rgba(124,92,252,0.10), transparent 70%), radial-gradient(50% 60% at 80% 50%, rgba(37,99,235,0.08), transparent 70%)",
        }}
      />
      <div className="relative mx-auto max-w-6xl glass-panel overflow-hidden">
        {/* corner orbit accent */}
        <svg aria-hidden viewBox="0 0 400 400" className="pointer-events-none absolute -right-24 -top-24 h-[420px] w-[420px] opacity-40">
          <ellipse cx="200" cy="200" rx="190" ry="120" fill="none" stroke="rgba(124,92,252,0.35)" strokeWidth="1" strokeDasharray="3 6" className="animate-orbit-halo" />
          <ellipse cx="200" cy="200" rx="130" ry="180" fill="none" stroke="rgba(76,77,207,0.3)" strokeWidth="1" strokeDasharray="2 7" className="animate-orbit-counter" />
        </svg>
        <div className="relative grid gap-10 lg:grid-cols-[1.15fr_1fr] items-center p-8 md:p-14">
          <div>
            <div className="mono text-[10px] tracking-[0.24em] uppercase text-[color:var(--brand-purple,#7C5CFC)] flex items-center gap-2.5">
              <span className="h-[1px] w-8 bg-[color:var(--brand-purple,#7C5CFC)]" />
              {t("home.wl.label")}
              <span
                className="mono text-[9px] tracking-[0.22em] px-1.5 py-0.5 rounded"
                style={{ color: "var(--brand-cyan)", background: "rgba(76,77,207,0.1)", border: "1px solid rgba(76,77,207,0.3)" }}
              >
                TSP
              </span>
            </div>
            <h2 className="mt-5 display text-3xl md:text-[2.6rem] font-bold text-ink leading-[1.08]">
              {t("home.wl.h1")}{" "}
              <span className="text-gradient">{t("home.wl.h2")}</span>
            </h2>
            <p className="mt-5 text-muted-foreground max-w-xl leading-relaxed">
              <Trans
                i18nKey="home.wl.body"
                values={{ price: TSP_FROM_PRICE, devices: TSP_FROM_DEVICES }}
                components={{ b: <span className="text-ink font-medium" /> }}
              />
            </p>
            <div className="mt-8 flex flex-wrap gap-3">
              <Link to="/tsp" className="pill-primary hover:pill-primary-hover">
                {t("home.wl.cta1")} <ArrowRight className="h-4 w-4" />
              </Link>
              <Link
                to="/pricing"
                hash="tsp"
                className="pill-ghost hover:border-[var(--brand-blue)] hover:text-[var(--brand-blue)]"
              >
                {t("home.wl.cta2")}
              </Link>
            </div>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            {features.map((f) => (
              <div
                key={f.n}
                className="group relative rounded border p-4 transition-colors"
                style={{ background: "rgba(10,20,40,0.5)", borderColor: "rgba(76,77,207,0.18)" }}
              >
                <div className="mono text-[9px] tracking-[0.24em] text-[color:var(--brand-purple,#7C5CFC)]">— {f.n}</div>
                <div className="mt-2 text-ink font-medium text-sm leading-snug">{f.k}</div>
                <div className="mt-1 text-[13px] text-muted-foreground leading-snug">{f.v}</div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}

function FinalCTA() {
  const { t } = useTranslation();
  return (
    <section className="px-6 py-28 relative overflow-hidden">
      {/* orbital rings behind the card */}
      <svg aria-hidden viewBox="0 0 1200 700" className="pointer-events-none absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-[1400px] max-w-none opacity-50">
        <ellipse cx="600" cy="350" rx="560" ry="230" fill="none" stroke="rgba(76,77,207,0.22)" strokeWidth="1" strokeDasharray="2 8" className="animate-orbit-halo" />
        <ellipse cx="600" cy="350" rx="420" ry="300" fill="none" stroke="rgba(124,92,252,0.18)" strokeWidth="1" strokeDasharray="3 9" className="animate-orbit-counter" />
        <circle cx="600" cy="120" r="3" fill="#4c4dcf" />
        <circle cx="180" cy="480" r="2.5" fill="#7C5CFC" />
      </svg>
      <div className="relative mx-auto max-w-6xl glass-panel px-8 py-16 md:px-20 md:py-20 text-center overflow-hidden">
        <div
          aria-hidden
          className="absolute inset-0 opacity-50 pointer-events-none"
          style={{ background: "radial-gradient(600px circle at 30% 0%, rgba(67,56,202,0.18), transparent 60%), radial-gradient(500px circle at 70% 100%, rgba(124,92,252,0.14), transparent 60%)" }}
        />
        <div className="relative">
          <span className="section-label justify-center">
            <span className="h-[1px] w-6 bg-[var(--brand-blue)]" />
            {t("home.final.label")}
          </span>
          <h2 className="display text-4xl md:text-5xl font-bold leading-[1.05] mt-5 text-ink">
            {t("home.final.h1")}<br />
            <span className="text-gradient">{t("home.final.h2")}</span>
          </h2>
          <p className="mt-6 text-muted-foreground max-w-xl mx-auto leading-relaxed">
            {t("home.final.body")}
          </p>
          <div className="mt-9 flex flex-wrap items-center justify-center gap-3">
            <Link to="/signup" className="pill-primary hover:pill-primary-hover">
              {t("cta.trial")} <ArrowRight className="h-4 w-4" />
            </Link>
            <Link to="/tsp" className="pill-ghost hover:border-[var(--brand-blue)] hover:text-[var(--brand-blue)]">
              {t("cta.whitelabel")}
            </Link>
          </div>
          <div className="mt-9 flex flex-wrap items-center justify-center gap-x-6 gap-y-2 mono text-[10px] tracking-[0.2em] uppercase text-[#7A8CAA]">
            <span>{t("hero.trial")}</span>
            <span className="h-1 w-1 rounded-full bg-[#7A8CAA]/50" />
            <span>{t("hero.nocard")}</span>
            <span className="h-1 w-1 rounded-full bg-[#7A8CAA]/50" />
            <span>{t("hero.cancel")}</span>
          </div>
        </div>
      </div>
    </section>
  );
}
