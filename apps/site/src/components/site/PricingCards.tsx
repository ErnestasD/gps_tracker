import { useState } from "react";
import { Check } from "lucide-react";
import { Link } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { cn, eur } from "@/lib/utils";

interface DirectTier {
  devices: number;
  monthly: number;
  yearly: number;
  /** Plan price ÷ devices — formatted per locale at render (see `eur`). */
  perDevice: number;
  highlight?: boolean;
}

const DIRECT: DirectTier[] = [
  { devices: 5, monthly: 9, yearly: 90, perDevice: 1.8 },
  { devices: 10, monthly: 15, yearly: 150, perDevice: 1.5 },
  { devices: 25, monthly: 35, yearly: 350, perDevice: 1.4, highlight: true },
  { devices: 50, monthly: 65, yearly: 650, perDevice: 1.3 },
  { devices: 100, monthly: 119, yearly: 1190, perDevice: 1.19 },
];

const DIRECT_FEATURES = [
  "pricing.cards.f1",
  "pricing.cards.f2",
  "pricing.cards.f3",
  "pricing.cards.f4",
  "pricing.cards.f5",
];

export function PricingCards() {
  const { t, i18n } = useTranslation();
  const lang = i18n.resolvedLanguage;
  const [annual, setAnnual] = useState(false);

  return (
    <div>
      {/* Billing toggle */}
      <div className="flex justify-center mb-8">
        <div className="inline-flex items-center gap-1 p-1 rounded-full border border-[var(--hairline)] bg-[rgba(10,20,40,0.5)]">
          <button
            onClick={() => setAnnual(false)}
            className={cn(
              "px-4 py-1.5 rounded-full text-xs mono tracking-wide transition-colors",
              !annual ? "bg-[var(--brand-blue)] text-white" : "text-muted-foreground hover:text-ink"
            )}
          >
            {t("pricing.cards.monthly")}
          </button>
          <button
            onClick={() => setAnnual(true)}
            className={cn(
              "px-4 py-1.5 rounded-full text-xs mono tracking-wide transition-colors inline-flex items-center gap-2",
              annual ? "bg-[var(--brand-blue)] text-white" : "text-muted-foreground hover:text-ink"
            )}
          >
            {t("pricing.cards.annual")}
            <span className={cn("text-[10px] px-1.5 py-0.5 rounded-full", annual ? "bg-white/20" : "bg-[var(--brand-green)]/20 text-[var(--brand-green)]")}>
              −17%
            </span>
          </button>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-3 lg:grid-cols-5">
        {DIRECT.map((p) => {
          const price = annual ? Math.round(p.yearly / 12) : p.monthly;
          return (
            <div
              key={p.devices}
              className={cn(
                "surface-card p-5 relative flex flex-col",
                p.highlight && "border-[color:var(--brand-blue)] shadow-[0_20px_50px_-30px_rgba(37,99,235,0.4)]"
              )}
            >
              {p.highlight && (
                <span className="absolute -top-3 left-4 mono text-[9px] tracking-[0.2em] uppercase bg-[var(--brand-blue)] text-white px-2 py-1 rounded-full">
                  {t("pricing.cards.popular")}
                </span>
              )}
              <div className="mono text-[10px] tracking-[0.2em] uppercase text-muted-foreground">
                {t("pricing.cards.upTo", { n: p.devices })}
              </div>
              <div className="mt-4 flex items-baseline gap-1">
                <span className="display text-3xl font-bold text-ink mono tabular-nums">{eur(price, lang)}</span>
                <span className="mono text-xs text-muted-foreground">{t("pricing.cards.perMo")}</span>
              </div>
              <div className="mt-1 mono text-[11px] text-muted-foreground">
                {t("pricing.cards.perDevice", { price: eur(p.perDevice, lang, 2) })}
              </div>
              {annual && (
                <div className="mt-1 mono text-[10px] text-[var(--brand-green)]">
                  {t("pricing.cards.billedYearly", { total: p.yearly.toLocaleString(lang) })}
                </div>
              )}
              <Link
                to="/signup"
                className={cn(
                  "mt-5 h-9 inline-flex items-center justify-center rounded text-xs mono tracking-wide transition-colors",
                  p.highlight
                    ? "bg-[var(--brand-blue)] text-white hover:opacity-90"
                    : "border border-[var(--hairline)] text-ink hover:border-[var(--brand-blue)] hover:text-[var(--brand-blue)]"
                )}
              >
                {t("pricing.cards.start")}
              </Link>
            </div>
          );
        })}
      </div>

      <div className="mt-8 surface-card p-6">
        <div className="mono text-[10px] tracking-[0.2em] uppercase text-muted-foreground mb-3">
          {t("pricing.cards.includes")}
        </div>
        <div className="grid gap-2 sm:grid-cols-2 md:grid-cols-3">
          {DIRECT_FEATURES.map((k) => (
            <div key={k} className="flex items-center gap-2 text-sm text-ink/85">
              <Check className="h-4 w-4 shrink-0 text-[color:var(--brand-green)]" strokeWidth={2} />
              {t(k)}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
