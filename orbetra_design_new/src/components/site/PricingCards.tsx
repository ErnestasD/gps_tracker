import { Check } from "lucide-react";
import { Link } from "@tanstack/react-router";
import { cn } from "@/lib/utils";

interface Plan {
  name: string;
  price: string;
  cadence: string;
  orgs: string;
  devices: string;
  features: string[];
  highlight?: boolean;
}

const PLANS: Plan[] = [
  {
    name: "Solo",
    price: "€9",
    cadence: "/ vehicle / mo",
    orgs: "1–3 vehicles",
    devices: "Perfect for owner-operators",
    features: ["Live map on phone & web", "Trip history · 12 months", "Idle & speeding alerts", "Email support"],
  },
  {
    name: "Small fleet",
    price: "€7",
    cadence: "/ vehicle / mo",
    orgs: "4–20 vehicles",
    devices: "The sweet spot for growing crews",
    features: ["Everything in Solo", "Unlimited drivers & users", "Geofences & SMS alerts", "PDF & Excel reports", "Priority email support"],
    highlight: true,
  },
  {
    name: "Fleet+",
    price: "€6",
    cadence: "/ vehicle / mo",
    orgs: "20+ vehicles",
    devices: "For growing operations",
    features: ["Everything in Small fleet", "REST API & webhooks", "Custom roles & permissions", "Named account manager", "99.9% uptime SLA"],
  },
];

export function PricingCards() {
  return (
    <div className="grid gap-6 md:grid-cols-3">
      {PLANS.map((p) => (
        <div
          key={p.name}
          className={cn(
            "surface-card p-8 relative flex flex-col",
            p.highlight && "border-[color:var(--brand-blue)] shadow-[0_20px_50px_-30px_rgba(37,99,235,0.4)]"
          )}
        >
          {p.highlight && (
            <span className="absolute -top-3 left-8 mono text-[10px] tracking-[0.2em] uppercase bg-[var(--brand-blue)] text-white px-3 py-1 rounded-full">
              Most chosen
            </span>
          )}
          <div className="mono text-[11px] tracking-[0.2em] uppercase text-muted-foreground">— PLAN · {p.name.toUpperCase()}</div>
          <div className="mt-5 flex items-baseline gap-1">
            <span className="display text-5xl font-bold text-ink mono tabular-nums">{p.price}</span>
            <span className="mono text-sm text-muted-foreground">{p.cadence}</span>
          </div>
          <div className="mt-5 space-y-1 text-sm">
            <div className="text-ink">{p.orgs}</div>
            <div className="text-muted-foreground">{p.devices}</div>
          </div>
          <ul className="mt-6 space-y-2.5 text-sm flex-1">
            {p.features.map((f) => (
              <li key={f} className="flex gap-2 text-ink/85">
                <Check className="h-4 w-4 shrink-0 text-[color:var(--brand-green)] mt-0.5" strokeWidth={2} />
                {f}
              </li>
            ))}
          </ul>
          <Link
            to="/pilot"
            className={cn("mt-8", p.highlight ? "pill-primary hover:pill-primary-hover" : "pill-ghost hover:border-[color:var(--brand-blue)] hover:text-[color:var(--brand-blue)]")}
          >
            Start free trial
          </Link>
        </div>
      ))}
    </div>
  );
}
