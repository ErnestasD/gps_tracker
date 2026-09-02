import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowRight } from "lucide-react";
import { useTranslation } from "react-i18next";
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
        t("tracks.ownP4"),
      ],
      cta: t("cta.trial"),
      to: "/signup" as const,
      secondary: t("cta.pricing"),
      secondaryTo: "/pricing" as const,
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
        t("tracks.resellP4"),
      ],
      cta: t("tracks.resellCta"),
      to: "/tsp" as const,
      secondary: t("home.wl.cta2"),
      secondaryTo: "/pricing" as const,
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
              <div className="mt-7 flex flex-wrap items-center gap-3">
                <Link to={tr.to} className="pill-primary hover:pill-primary-hover">
                  {tr.cta} <ArrowRight className="h-4 w-4" />
                </Link>
                <Link
                  to={tr.secondaryTo}
                  hash={tr.secondaryTo === "/pricing" && tr.accent !== "var(--brand-blue)" ? "tsp" : undefined}
                  className="pill-ghost hover:border-[var(--brand-blue)] hover:text-[var(--brand-blue)]"
                >
                  {tr.secondary}
                </Link>
              </div>
            </div>
          ))}
        </div>
        {/* the trial reassurance the removed final CTA used to carry */}
        <div className="mt-8 flex flex-wrap items-center justify-center gap-x-6 gap-y-2 mono text-[10px] tracking-[0.2em] uppercase text-[#7A8CAA]">
          <span>{t("hero.trial")}</span>
          <span className="h-1 w-1 rounded-full bg-[#7A8CAA]/50" />
          <span>{t("hero.nocard")}</span>
          <span className="h-1 w-1 rounded-full bg-[#7A8CAA]/50" />
          <span>{t("hero.cancel")}</span>
        </div>
      </div>
    </section>
  );
}
