import { createFileRoute } from "@tanstack/react-router";
import { Check, Minus } from "lucide-react";
import { SectionHeading } from "@/components/site/SectionHeading";
import { PricingCards } from "@/components/site/PricingCards";

export const Route = createFileRoute("/pricing")({
  head: () => ({
    meta: [
      { title: "Pricing — Orbetra" },
      { name: "description", content: "Per-device pricing for white-label GPS tracking. Starter €49/mo, Growth €149/mo, Scale €399/mo. Free 60-day pilot." },
    ],
  }),
  component: PricingPage,
});

const COMPARE: { row: string; s: string | boolean; g: string | boolean; x: string | boolean }[] = [
  { row: "Organizations (tenants)", s: "1", g: "5", x: "Unlimited" },
  { row: "Devices pool", s: "200", g: "2,000", x: "20,000" },
  { row: "Per-device overage", s: "€0.35", g: "€0.30", x: "€0.25" },
  { row: "Live map & trips", s: true, g: true, x: true },
  { row: "Geofences & alerts", s: true, g: true, x: true },
  { row: "REST API + webhooks", s: false, g: true, x: true },
  { row: "White-label domain", s: false, g: true, x: true },
  { row: "SSO for tenant admins", s: false, g: false, x: true },
  { row: "Regional data residency", s: false, g: false, x: true },
  { row: "SLA 99.9% + credits", s: false, g: false, x: true },
  { row: "Support", s: "Email", g: "Priority", x: "Named engineer" },
];

function PricingPage() {
  return (
    <>
      <section className="mx-auto max-w-7xl px-6 pt-20 md:pt-28 pb-10 text-center">
        <span className="section-label justify-center">
          <span className="h-[1px] w-6 bg-[var(--brand-blue)]" />
          — PRICING · PER DEVICE · EXCL. VAT
        </span>
        <h1 className="display text-5xl md:text-6xl font-bold leading-[1.02] mt-6 text-ink">
          Predictable pricing.<br />
          <span className="text-gradient">No seat license theatre.</span>
        </h1>
        <p className="mt-6 text-lg text-muted-foreground max-w-2xl mx-auto">
          Three plans, per-device pricing, monthly billing. Overage is a line item, not a renegotiation.
        </p>
      </section>

      <section className="px-6 pb-8">
        <div className="mx-auto max-w-6xl surface-card p-4 flex flex-wrap items-center gap-3 justify-center">
          <span className="mono text-[11px] tracking-[0.2em] uppercase text-[var(--brand-amber)]">— PILOT · SHADOW MODE</span>
          <span className="text-sm text-ink/85">Free for 60 days on up to 500 devices. No credit card.</span>
        </div>
      </section>

      <section className="px-6 py-10">
        <div className="mx-auto max-w-6xl">
          <PricingCards />
        </div>
      </section>

      <section className="px-6 py-20">
        <div className="mx-auto max-w-6xl">
          <SectionHeading label="— COMPARE PLANS" align="center" className="text-center">
            Every line item. <span className="text-gradient">No footnotes.</span>
          </SectionHeading>
          <div className="mt-12 surface-card overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-[var(--blueprint)]">
                <tr>
                  <th className="text-left p-4 mono text-[11px] tracking-[0.15em] uppercase text-muted-foreground font-medium">Feature</th>
                  <th className="p-4 mono text-[11px] tracking-[0.15em] uppercase text-muted-foreground font-medium">Starter</th>
                  <th className="p-4 mono text-[11px] tracking-[0.15em] uppercase text-[var(--brand-blue)] font-medium">Growth</th>
                  <th className="p-4 mono text-[11px] tracking-[0.15em] uppercase text-muted-foreground font-medium">Scale</th>
                </tr>
              </thead>
              <tbody>
                {COMPARE.map((r, i) => (
                  <tr key={r.row} className={i % 2 ? "bg-[var(--blueprint)]/40" : ""}>
                    <td className="p-4 text-ink/85">{r.row}</td>
                    <Cell v={r.s} />
                    <Cell v={r.g} accent />
                    <Cell v={r.x} />
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="mt-6 mono text-xs text-muted-foreground text-center">
            All prices exclude VAT. Overage billed monthly per active device beyond your plan pool.
          </p>
        </div>
      </section>
    </>
  );
}

function Cell({ v, accent }: { v: string | boolean; accent?: boolean }) {
  return (
    <td className={`p-4 text-center ${accent ? "text-ink font-medium" : "text-ink/80"}`}>
      {typeof v === "boolean" ? (
        v ? <Check className="inline h-4 w-4 text-[color:var(--brand-green)]" /> : <Minus className="inline h-4 w-4 text-muted-foreground/50" />
      ) : v}
    </td>
  );
}
