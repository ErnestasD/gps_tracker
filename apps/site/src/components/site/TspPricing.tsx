import { Link } from "@tanstack/react-router";
import { Check, ArrowRight } from "lucide-react";

interface TspPlan {
  name: string;
  base: number;
  baseYearly: number;
  included: number;
  perDevice: string;
  overage: string;
  features: string[];
  highlight?: boolean;
  cta: string;
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
      "White-label domain & logo",
      "Sub-tenants (Accounts)",
      "REST API + webhooks",
      "Email support",
    ],
    cta: "Request pilot",
  },
  {
    name: "TSP Grow",
    base: 399,
    baseYearly: 3990,
    included: 750,
    perDevice: "€0.53",
    overage: "€0.40",
    features: [
      "Everything in Start",
      "Priority support",
      "Onboarding assistance",
      "Custom AVL IDs",
    ],
    highlight: true,
    cta: "Request pilot",
  },
  {
    name: "TSP Scale",
    base: 899,
    baseYearly: 8990,
    included: 2500,
    perDevice: "€0.36",
    overage: "€0.35",
    features: [
      "Everything in Grow",
      "SSO & custom roles",
      "Regional data residency",
      "99.9% SLA · named contact",
    ],
    cta: "Request pilot",
  },
];

export function TspPricing() {
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
                Most partners
              </span>
            )}
            <div className="mono text-[11px] tracking-[0.2em] uppercase text-muted-foreground">
              — {p.name.toUpperCase()}
            </div>
            <div className="mt-5 flex items-baseline gap-1">
              <span className="display text-5xl font-bold text-ink mono tabular-nums">€{p.base}</span>
              <span className="mono text-sm text-muted-foreground">/mo base</span>
            </div>
            <div className="mt-2 space-y-1 text-sm">
              <div className="text-ink/85">
                {p.included.toLocaleString()} devices included
                <span className="text-muted-foreground"> · {p.perDevice}/device</span>
              </div>
              <div className="mono text-xs text-muted-foreground">
                Overage {p.overage} / device
              </div>
              <div className="mono text-xs text-[var(--brand-green)]">
                €{p.baseYearly.toLocaleString()} yearly (2 months free)
              </div>
            </div>
            <ul className="mt-5 space-y-2 text-sm flex-1">
              {p.features.map((f) => (
                <li key={f} className="flex gap-2 text-ink/85">
                  <Check className="h-4 w-4 shrink-0 text-[color:var(--brand-green)] mt-0.5" strokeWidth={2} />
                  {f}
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
              {p.cta} <ArrowRight className="h-4 w-4" />
            </Link>
          </div>
        ))}
      </div>

      <div className="mt-6 surface-card p-6 flex flex-wrap items-center justify-between gap-4">
        <div>
          <div className="mono text-[11px] tracking-[0.2em] uppercase text-muted-foreground">
            — TSP ENTERPRISE
          </div>
          <div className="mt-1 font-display font-semibold text-ink">
            2,500+ devices · custom terms
          </div>
          <div className="text-sm text-muted-foreground">
            Regional deployments, dedicated infra, custom SLA.
          </div>
        </div>
        <Link to="/pilot" className="pill-ghost hover:border-[var(--brand-blue)] hover:text-[var(--brand-blue)]">
          Contact sales <ArrowRight className="h-4 w-4" />
        </Link>
      </div>
    </>
  );
}
