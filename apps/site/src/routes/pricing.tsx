import { createFileRoute, Link } from "@tanstack/react-router";
import { Check } from "lucide-react";
import { Trans, useTranslation } from "react-i18next";
import { SectionHeading } from "@/components/site/SectionHeading";
import { PricingCards } from "@/components/site/PricingCards";
import { TspPricing } from "@/components/site/TspPricing";

/** Boolean rows render a check / dash; the rest pull `.a` / `.b` from i18n. */
const COMPARE_ROWS = [
  { k: "r1" },
  { k: "r2" },
  { k: "r3", bool: true },
  { k: "r4", bool: true },
  { k: "r5" },
  { k: "r6" },
  { k: "r7" },
  { k: "r8" },
  { k: "r9" },
];

const TSP_BASE_PRICE = 149;

export const Route = createFileRoute("/pricing")({
  head: () => ({
    meta: [
      { title: "Pricing — Orbetra GPS tracking" },
      { name: "description", content: "Simple per-device pricing for small fleets from €9/mo (5 devices). White-label / TSP plans from €149/mo. 60-day free pilot. No setup fees." },
    ],
  }),
  component: PricingPage,
});


function PricingPage() {
  const { t } = useTranslation();
  return (
    <>
      {/* HERO */}
      <section className="mx-auto max-w-7xl px-6 pt-20 md:pt-28 pb-10 text-center">
        <span className="section-label justify-center">
          <span className="h-[1px] w-6 bg-[var(--brand-blue)]" />
          {t("pricing.label")}
        </span>
        <h1 className="display text-5xl md:text-6xl font-bold leading-[1.02] mt-6 text-ink">
          {t("pricing.h1")}<br />
          <span className="text-gradient">{t("pricing.h2")}</span>
        </h1>
        <p className="mt-6 text-lg text-muted-foreground max-w-2xl mx-auto">
          <Trans i18nKey="pricing.sub" components={{ b: <strong className="text-ink" /> }} />
        </p>

        {/* Track switcher */}
        <div className="mt-8 flex flex-wrap justify-center gap-3 text-sm">
          <a href="#direct" className="pill-ghost hover:border-[var(--brand-blue)]">
            {t("pricing.jumpDirect")}
          </a>
          <a href="#tsp" className="pill-ghost hover:border-[var(--brand-blue)]">
            {t("pricing.jumpTsp")}
          </a>
        </div>
      </section>

      {/* Free pilot bar */}
      <section className="px-6 pb-6">
        <div className="mx-auto max-w-6xl surface-card p-4 flex flex-wrap items-center gap-3 justify-center">
          <span className="mono text-[11px] tracking-[0.2em] uppercase text-[var(--brand-amber)]">{t("pricing.pilotLabel")}</span>
          <span className="text-sm text-ink/85">
            {t("pricing.pilotBody")}
          </span>
        </div>
      </section>

      {/* TRACK A — DIRECT */}
      <section id="direct" className="px-6 py-16 scroll-mt-20">
        <div className="mx-auto max-w-7xl">
          <div className="flex items-end justify-between flex-wrap gap-4 mb-10">
            <div>
              <div className="mono text-[11px] tracking-[0.2em] uppercase text-[var(--brand-blue)]">
                {t("pricing.direct.label")}
              </div>
              <h2 className="display text-3xl md:text-4xl font-bold text-ink mt-3">
                {t("pricing.direct.h1")} <span className="text-gradient">{t("pricing.direct.h2")}</span>
              </h2>
              <p className="mt-3 text-muted-foreground max-w-2xl">
                {t("pricing.direct.body")}
              </p>
            </div>
          </div>
          <PricingCards />
          <p className="mt-6 text-center text-xs text-muted-foreground">
            {t("pricing.exclVat")}
          </p>
        </div>
      </section>

      {/* TRACK B — TSP */}
      <section
        id="tsp"
        className="px-6 py-20 scroll-mt-20 border-y border-[var(--hairline)] bg-[rgba(4,7,15,0.5)] relative"
      >
        <div
          aria-hidden
          className="absolute inset-0 pointer-events-none opacity-60"
          style={{
            background:
              "radial-gradient(60% 60% at 50% 0%, rgba(124,92,252,0.10), transparent 70%)",
          }}
        />
        <div className="relative mx-auto max-w-7xl">
          <div className="mb-10 text-center">
            <div className="mono text-[11px] tracking-[0.2em] uppercase text-[color:var(--brand-purple,#7C5CFC)]">
              {t("pricing.tsp.label")}
            </div>
            <h2 className="display text-3xl md:text-4xl font-bold text-ink mt-3">
              {t("pricing.tsp.h1")}<br />
              <span className="text-gradient">{t("pricing.tsp.h2")}</span>
            </h2>
            <p className="mt-4 text-muted-foreground max-w-2xl mx-auto">
              {t("pricing.tsp.body", { price: TSP_BASE_PRICE })}
            </p>
          </div>

          <TspPricing />
          <p className="mt-6 text-center text-xs text-muted-foreground">
            {t("pricing.exclVat")}
          </p>


          <p className="mt-8 text-center text-sm text-muted-foreground max-w-2xl mx-auto">
            {t("pricing.tsp.more")}{" "}
            <Link to="/tsp" className="text-ink underline underline-offset-4 decoration-[var(--brand-blue)]/60 hover:decoration-[var(--brand-blue)]">
              {t("pricing.tsp.moreLink")}
            </Link>
          </p>
        </div>
      </section>

      {/* COMPARE TRACKS */}
      <section className="px-6 py-20">
        <div className="mx-auto max-w-5xl">
          <SectionHeading label={t("pricing.compare.label")} align="center" className="text-center">
            {t("pricing.compare.title")}
          </SectionHeading>
          <div className="mt-12 surface-card overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-[var(--blueprint)]">
                <tr>
                  <th className="text-left p-4 mono text-[11px] tracking-[0.15em] uppercase text-muted-foreground font-medium">{t("pricing.compare.feature")}</th>
                  <th className="p-4 mono text-[11px] tracking-[0.15em] uppercase text-[var(--brand-blue)] font-medium">{t("pricing.compare.direct")}</th>
                  <th className="p-4 mono text-[11px] tracking-[0.15em] uppercase text-[color:var(--brand-purple,#7C5CFC)] font-medium">{t("pricing.compare.tsp")}</th>
                </tr>
              </thead>
              <tbody>
                {/* rows come from i18n (`.f` = feature, `.a`/`.b` = the two tracks); a `bool` row
                    renders check/dash instead, so no language has to translate a checkmark */}
                {COMPARE_ROWS.map((row, i) => (
                  <tr key={row.k} className={i % 2 ? "bg-[var(--blueprint)]/40" : ""}>
                    <td className="p-4 text-ink/85">{t(`pricing.compare.${row.k}f`)}</td>
                    {row.bool ? (
                      <>
                        <td className="p-4 text-center"><span className="text-muted-foreground/50">—</span></td>
                        <td className="p-4 text-center"><Check className="inline h-4 w-4 text-[color:var(--brand-green)]" /></td>
                      </>
                    ) : (
                      <>
                        <td className="p-4 text-center text-ink/85">{t(`pricing.compare.${row.k}a`)}</td>
                        <td className="p-4 text-center text-ink/85">{t(`pricing.compare.${row.k}b`)}</td>
                      </>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="mt-6 mono text-xs text-muted-foreground text-center">
            {t("pricing.footnote")}
          </p>
        </div>
      </section>
    </>
  );
}
