import { Link } from "@tanstack/react-router";
import { Check, ArrowRight } from "lucide-react";
import { useTranslation } from "react-i18next";

interface TspPlan {
  /** Plan names are product names — deliberately identical in every language. */
  name: string;
  base: number;
  baseYearly: number;
  included: number;
  perDevice: string;
  overage: string;
  /** i18n keys (or a resolved string for the "Everything in X" roll-up). */
  features: string[];
  highlight?: boolean;
}

export const TSP_PLANS: TspPlan[] = [
  {
    name: "TSP Start",
    base: 149,
    baseYearly: 1490,
    included: 200,
    perDevice: "€0.75",
    overage: "€0.60",
    features: [
      "tspPlans.start.f1",
      "tspPlans.start.f2",
      "tspPlans.start.f3",
      "tspPlans.start.f4",
    ],
  },
  {
    name: "TSP Grow",
    base: 399,
    baseYearly: 3990,
    included: 750,
    perDevice: "€0.53",
    overage: "€0.40",
    features: [
      "tspPlans.grow.f2",
      "tspPlans.grow.f3",
      "tspPlans.grow.f4",
    ],
    highlight: true,
  },
  {
    name: "TSP Scale",
    base: 899,
    baseYearly: 8990,
    included: 2500,
    perDevice: "€0.36",
    overage: "€0.35",
    features: [
      "tspPlans.scale.f2",
      "tspPlans.scale.f3",
      "tspPlans.scale.f4",
    ],
  },
];

/** "Everything in Start" / "Everything in Grow" — the roll-up bullet each tier opens with. */
const INHERITS: Record<string, string> = { "TSP Grow": "Start", "TSP Scale": "Grow" };

export function TspPricing() {
  const { t } = useTranslation();
  return (
    <>
      <div className="grid gap-5 md:grid-cols-3">
        {TSP_PLANS.map((p) => (
          <div
            key={p.name}
            className={
              "surface-card p-8 flex flex-col relative" +
              (p.highlight
                ? " border-[color:var(--brand-blue)] shadow-[0_20px_50px_-30px_rgba(37,99,235,0.4)]"
                : "")
            }
          >
            {p.highlight && (
              <span className="absolute -top-3 left-8 mono text-[10px] tracking-[0.2em] uppercase bg-[var(--brand-blue)] text-white px-3 py-1 rounded-full">
                {t("tspPlans.badge")}
              </span>
            )}
            <div className="mono text-[11px] tracking-[0.2em] uppercase text-muted-foreground">
              — {p.name.toUpperCase()}
            </div>
            <div className="mt-5 flex items-baseline gap-1">
              <span className="display text-5xl font-bold text-ink mono tabular-nums">€{p.base}</span>
              <span className="mono text-sm text-muted-foreground">{t("tspPlans.base")}</span>
            </div>
            <div className="mt-2 space-y-1 text-sm">
              <div className="text-ink/85">
                {t("tspPlans.included", { n: p.included.toLocaleString() })}
                <span className="text-muted-foreground">{t("tspPlans.perDevice", { price: p.perDevice })}</span>
              </div>
              <div className="mono text-xs text-muted-foreground">
                {t("tspPlans.overage", { price: p.overage })}
              </div>
              <div className="mono text-xs text-[var(--brand-green)]">
                {t("tspPlans.yearly", { total: p.baseYearly.toLocaleString() })}
              </div>
            </div>
            <ul className="mt-5 space-y-2 text-sm flex-1">
              {INHERITS[p.name] && (
                <li className="flex gap-2 text-ink/85">
                  <Check className="h-4 w-4 shrink-0 text-[color:var(--brand-green)] mt-0.5" strokeWidth={2} />
                  {t("tspPlans.everythingIn", { plan: INHERITS[p.name] })}
                </li>
              )}
              {p.features.map((f) => (
                <li key={f} className="flex gap-2 text-ink/85">
                  <Check className="h-4 w-4 shrink-0 text-[color:var(--brand-green)] mt-0.5" strokeWidth={2} />
                  {t(f)}
                </li>
              ))}
            </ul>
            <Link
              to="/pilot"
              className={
                "mt-6 " +
                (p.highlight
                  ? "pill-primary hover:pill-primary-hover"
                  : "pill-ghost hover:border-[color:var(--brand-blue)] hover:text-[color:var(--brand-blue)]")
              }
            >
              {t("tspPlans.cta")} <ArrowRight className="h-4 w-4" />
            </Link>
          </div>
        ))}
      </div>

      <div className="mt-6 surface-card p-6 flex flex-wrap items-center justify-between gap-4">
        <div>
          <div className="mono text-[11px] tracking-[0.2em] uppercase text-muted-foreground">
            {t("tspPlans.enterprise.label")}
          </div>
          <div className="mt-1 font-display font-semibold text-ink">
            {t("tspPlans.enterprise.title")}
          </div>
          <div className="text-sm text-muted-foreground">
            {t("tspPlans.enterprise.body")}
          </div>
        </div>
        <Link to="/pilot" className="pill-ghost hover:border-[var(--brand-blue)] hover:text-[var(--brand-blue)]">
          {t("tspPlans.enterprise.cta")} <ArrowRight className="h-4 w-4" />
        </Link>
      </div>
    </>
  );
}
