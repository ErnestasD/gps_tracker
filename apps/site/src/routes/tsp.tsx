import { createFileRoute, Link } from "@tanstack/react-router";
import { motion } from "framer-motion";
import { ArrowRight } from "lucide-react";
import { useTranslation } from "react-i18next";
import { SectionHeading } from "@/components/site/SectionHeading";
import { FAQAccordion } from "@/components/site/FAQAccordion";
import { WhiteLabelDiagram } from "@/components/site/WhiteLabelDiagram";
import { TspPricing } from "@/components/site/TspPricing";


export const Route = createFileRoute("/tsp")({
  head: () => ({
    meta: [
      { title: "Resellers & TSPs — Orbetra" },
      { name: "description", content: "Orbetra is two products in one: a tracking app for your own fleet, and a white-label platform to resell under your brand. This is the reseller track." },
    ],
  }),
  component: TspPage,
});

const PAIN_KEYS = ["p1", "p2", "p3"];
const STEP_KEYS = [
  { n: "01", k: "s1" },
  { n: "02", k: "s2" },
  { n: "03", k: "s3" },
  { n: "04", k: "s4" },
];
const FAQ_KEYS = [1, 2, 3, 4, 5, 6, 7, 8];

const TSP_BASE_PRICE = 149;

function TspPage() {
  const { t } = useTranslation();
  const faq = FAQ_KEYS.map((n) => ({ q: t(`tsp.q${n}`), a: t(`tsp.a${n}`) }));
  return (
    <>
      <section className="mx-auto max-w-7xl px-6 pt-20 md:pt-28 pb-16">
        <span className="section-label">
          <span className="h-[1px] w-6 bg-[var(--brand-blue)]" />
          {t("tsp.label")}
        </span>
        <h1 className="display text-5xl md:text-6xl font-bold leading-[1.02] mt-6 max-w-3xl text-ink">
          {t("tsp.h1")}<br />
          <span className="text-gradient">{t("tsp.h2")}</span>
        </h1>
        <p className="mt-6 text-lg text-muted-foreground max-w-2xl">
          {t("tsp.sub")}
        </p>
        <div className="mt-8 flex flex-wrap gap-3">
          <a href="#tsp-pricing" className="pill-primary hover:pill-primary-hover">
            {t("tsp.cta1")} <ArrowRight className="h-4 w-4" />
          </a>
          <Link to="/pricing" hash="tsp" className="pill-ghost hover:border-[var(--brand-blue)] hover:text-[var(--brand-blue)]">
            {t("tsp.cta2")}
          </Link>
        </div>
      </section>




      <section className="mx-auto max-w-7xl px-6 py-16 grid gap-6 md:grid-cols-3">
        {PAIN_KEYS.map((k, i) => (
          <motion.div
            key={k}
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.5, delay: i * 0.08 }}
            className="surface-card p-6"
          >
            <div className="mono text-[11px] tracking-[0.2em] uppercase text-[var(--brand-blue)]">{t("tsp.painLabel", { n: i + 1 })}</div>
            <h3 className="mt-4 display text-xl font-semibold text-ink">{t(`tsp.${k}t`)}</h3>
            <p className="mt-2 text-sm text-muted-foreground">{t(`tsp.${k}b`)}</p>
          </motion.div>
        ))}
      </section>

      <section className="px-6 py-20">
        <div className="mx-auto max-w-6xl">
          <SectionHeading label={t("tsp.diagramLabel")}>
            {t("tsp.diagramH1")} <span className="text-gradient">{t("tsp.diagramH2")}</span>
          </SectionHeading>
          <div className="mt-12 surface-card p-8 md:p-12 relative overflow-hidden">
            <div
              className="absolute inset-0 -z-10 opacity-60"
              style={{
                background:
                  "radial-gradient(50% 60% at 50% 50%, rgba(37,99,235,0.08), transparent 70%)",
              }}
            />
            <WhiteLabelDiagram />
            <p className="mt-8 text-sm text-muted-foreground text-center max-w-xl mx-auto">
              {t("tsp.diagramCaption")}
            </p>
          </div>
        </div>
      </section>

      <section className="px-6 py-20">
        <div className="mx-auto max-w-6xl">
          <SectionHeading label={t("tsp.stepsLabel")}>{t("tsp.stepsTitle")}</SectionHeading>
          <ol className="mt-12 grid gap-5 md:grid-cols-2">
            {STEP_KEYS.map((s) => (
              <li key={s.n} className="surface-card p-6 flex gap-5">
                <div className="mono text-3xl font-medium text-gradient shrink-0">{s.n}</div>
                <div>
                  <div className="font-display font-semibold text-ink text-lg">{t(`tsp.${s.k}t`)}</div>
                  <div className="text-sm text-muted-foreground mt-1">{t(`tsp.${s.k}b`)}</div>
                </div>
              </li>
            ))}
          </ol>
        </div>
      </section>

      <section id="tsp-pricing" className="px-6 py-20 scroll-mt-20 border-y border-[var(--hairline)] bg-[rgba(4,7,15,0.5)] relative">
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
              {t("tsp.pricingLabel")}
            </div>
            <h2 className="display text-3xl md:text-4xl font-bold text-ink mt-3">
              {t("tsp.pricingH1")}<br />
              <span className="text-gradient">{t("tsp.pricingH2")}</span>
            </h2>
            <p className="mt-4 text-muted-foreground max-w-2xl mx-auto">
              {t("tsp.pricingBody", { price: TSP_BASE_PRICE })}
            </p>
          </div>
          <TspPricing />
          <p className="mt-8 text-center text-sm text-muted-foreground">
            {t("tsp.pricingMore")}{" "}
            <Link to="/pricing" hash="tsp" className="text-ink underline underline-offset-4 decoration-[var(--brand-blue)]/60 hover:decoration-[var(--brand-blue)]">
              {t("tsp.pricingMoreLink")}
            </Link>
          </p>
        </div>
      </section>



      <section className="px-6 py-20">
        <div className="mx-auto max-w-4xl">
          <SectionHeading label={t("tsp.faqLabel")}>{t("tsp.faqH1")} <span className="text-gradient">{t("tsp.faqH2")}</span></SectionHeading>
          <div className="mt-10">
            <FAQAccordion items={faq} />
          </div>
        </div>
      </section>

      <section className="px-6 py-20">
        <div className="mx-auto max-w-4xl text-center surface-card p-12">
          <h2 className="display text-3xl md:text-4xl font-bold text-ink">{t("tsp.ctaTitle")}</h2>
          <p className="mt-4 text-muted-foreground">{t("tsp.ctaBody")}</p>
          <Link to="/pilot" className="mt-8 pill-primary hover:pill-primary-hover">
            {t("tsp.ctaButton")} <ArrowRight className="h-4 w-4" />
          </Link>
        </div>
      </section>
    </>
  );
}
