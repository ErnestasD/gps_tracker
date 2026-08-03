import { createFileRoute, Link } from "@tanstack/react-router";
import { Check } from "lucide-react";
import { SectionHeading } from "@/components/site/SectionHeading";
import { PricingCards } from "@/components/site/PricingCards";
import { TspPricing } from "@/components/site/TspPricing";

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
  return (
    <>
      {/* HERO */}
      <section className="mx-auto max-w-7xl px-6 pt-20 md:pt-28 pb-10 text-center">
        <span className="section-label justify-center">
          <span className="h-[1px] w-6 bg-[var(--brand-blue)]" />
          — PRICING · EXCL. VAT
        </span>
        <h1 className="display text-5xl md:text-6xl font-bold leading-[1.02] mt-6 text-ink">
          Two tracks.<br />
          <span className="text-gradient">One platform.</span>
        </h1>
        <p className="mt-6 text-lg text-muted-foreground max-w-2xl mx-auto">
          <strong className="text-ink">Direct</strong> for small fleets running their own vehicles.{" "}
          <strong className="text-ink">White-label / TSP</strong> for resellers reselling to their own customers.
        </p>

        {/* Track switcher */}
        <div className="mt-8 flex flex-wrap justify-center gap-3 text-sm">
          <a href="#direct" className="pill-ghost hover:border-[var(--brand-blue)]">
            → Direct (self-service)
          </a>
          <a href="#tsp" className="pill-ghost hover:border-[var(--brand-blue)]">
            → White-label / TSP
          </a>
        </div>
      </section>

      {/* Free pilot bar */}
      <section className="px-6 pb-6">
        <div className="mx-auto max-w-6xl surface-card p-4 flex flex-wrap items-center gap-3 justify-center">
          <span className="mono text-[11px] tracking-[0.2em] uppercase text-[var(--brand-amber)]">— FREE PILOT</span>
          <span className="text-sm text-ink/85">
            60 days free · up to 500 devices · no credit card · no setup fee
          </span>
        </div>
      </section>

      {/* TRACK A — DIRECT */}
      <section id="direct" className="px-6 py-16 scroll-mt-20">
        <div className="mx-auto max-w-7xl">
          <div className="flex items-end justify-between flex-wrap gap-4 mb-10">
            <div>
              <div className="mono text-[11px] tracking-[0.2em] uppercase text-[var(--brand-blue)]">
                — TRACK A · DIRECT
              </div>
              <h2 className="display text-3xl md:text-4xl font-bold text-ink mt-3">
                Small fleets. <span className="text-gradient">Own the app under Orbetra.</span>
              </h2>
              <p className="mt-3 text-muted-foreground max-w-2xl">
                Self-service. Pick a device tier, checkout with a card, live in minutes.
                No sub-tenants, no white-label — one account, your fleet.
              </p>
            </div>
          </div>
          <PricingCards />
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
              — TRACK B · WHITE-LABEL / TSP
            </div>
            <h2 className="display text-3xl md:text-4xl font-bold text-ink mt-3">
              Resellers & integrators.<br />
              <span className="text-gradient">Your brand. Your customers. Our engine.</span>
            </h2>
            <p className="mt-4 text-muted-foreground max-w-2xl mx-auto">
              Sales-led. Multi-tenant, white-label domain, REST + webhooks. The lowest serious entry
              in the market — €149/mo base beats Wialon's €300–500 partner minimum.
            </p>
          </div>

          <TspPricing />


          <p className="mt-8 text-center text-sm text-muted-foreground max-w-2xl mx-auto">
            More about the partner program, migration and white-label →{" "}
            <Link to="/tsp" className="text-ink underline underline-offset-4 decoration-[var(--brand-blue)]/60 hover:decoration-[var(--brand-blue)]">
              Resellers page
            </Link>
          </p>
        </div>
      </section>

      {/* COMPARE TRACKS */}
      <section className="px-6 py-20">
        <div className="mx-auto max-w-5xl">
          <SectionHeading label="— DIRECT vs TSP" align="center" className="text-center">
            Which track fits you?
          </SectionHeading>
          <div className="mt-12 surface-card overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-[var(--blueprint)]">
                <tr>
                  <th className="text-left p-4 mono text-[11px] tracking-[0.15em] uppercase text-muted-foreground font-medium">Feature</th>
                  <th className="p-4 mono text-[11px] tracking-[0.15em] uppercase text-[var(--brand-blue)] font-medium">Direct</th>
                  <th className="p-4 mono text-[11px] tracking-[0.15em] uppercase text-[color:var(--brand-purple,#7C5CFC)] font-medium">TSP / White-label</th>
                </tr>
              </thead>
              <tbody>
                {[
                  ["Who it's for", "Small fleets (5–100 devices) running their own vehicles", "Resellers, installers, TSPs reselling to end fleets"],
                  ["Brand", "Orbetra branded", "Your brand · your domain · your logo"],
                  ["Sub-tenants", false, true],
                  ["REST API + webhooks", false, true],
                  ["Signup", "Self-service checkout", "Sales-led pilot"],
                  ["Starting price", "€9/mo (5 devices)", "€149/mo (200 devices included)"],
                  ["Per-device (best)", "€1.19", "€0.36"],
                  ["Support", "Email", "Priority · account manager on Scale"],
                  ["SLA", "Best-effort", "99.9% on Scale"],
                ].map((row, i) => (
                  <tr key={i} className={i % 2 ? "bg-[var(--blueprint)]/40" : ""}>
                    <td className="p-4 text-ink/85">{row[0] as string}</td>
                    {[row[1], row[2]].map((v, j) => (
                      <td key={j} className="p-4 text-center text-ink/85">
                        {typeof v === "boolean" ? (
                          v ? <Check className="inline h-4 w-4 text-[color:var(--brand-green)]" /> : <span className="text-muted-foreground/50">—</span>
                        ) : v}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="mt-6 mono text-xs text-muted-foreground text-center">
            All prices exclude VAT · EU B2B reverse-charge via Stripe Tax · No setup fee · Cancel any time
          </p>
        </div>
      </section>
    </>
  );
}
