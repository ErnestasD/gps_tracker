import { createFileRoute, Link } from "@tanstack/react-router";
import { motion } from "framer-motion";
import { ArrowRight } from "lucide-react";
import { SectionHeading } from "@/components/site/SectionHeading";
import { FAQAccordion } from "@/components/site/FAQAccordion";
import { WhiteLabelDiagram } from "@/components/site/WhiteLabelDiagram";

export const Route = createFileRoute("/tsp")({
  head: () => ({
    meta: [
      { title: "Resellers & TSPs — Orbetra" },
      { name: "description", content: "Reselling GPS tracking? White-label Orbetra for your Teltonika fleet. Per-device pricing, EU-hosted, no lock-in. Our main product is built for end fleets — this is the partner track." },
    ],
  }),
  component: TspPage,
});

const PAINS = [
  { t: "Per-device pricing that scales", b: "No seat licenses, no per-tenant setup fees. Your margin doesn't get eaten as you grow." },
  { t: "Migrate off legacy platforms", b: "Point Teltonika devices at Orbetra by SMS or FOTA. Shadow-mode side-by-side until you're ready to switch." },
  { t: "Your clients never see our brand", b: "White-label domain, logo, colors. Orbetra never appears in-app or in emails to your end customers." },
];

const STEPS = [
  { n: "01", t: "Inventory", b: "Send us your device list (IMEI, model, firmware). We confirm compatibility in 24h." },
  { n: "02", t: "Shadow mode", b: "Point 10–500 devices at Orbetra. Data flows in parallel to your current platform for 60 days, free." },
  { n: "03", t: "Cutover", b: "Migrate tenants at your own pace. Historical data can be imported per-tenant on request." },
  { n: "04", t: "Scale", b: "Add tenants, add devices. One contract, per-device pricing, monthly billing." },
];

const FAQ = [
  { q: "Who owns the data?", a: "Your customers own their data; you're the controller; Orbetra is the processor. Full export via API or CSV at any time." },
  { q: "How does data export work?", a: "REST endpoints for devices, trips, geofences, and reports. Bulk CSV exports for reports and events. No lock-in — the schema is documented." },
  { q: "What SLA do you offer?", a: "99.9% uptime on Scale plan, with monthly credits if we miss it. 24/7 status page and a named engineer on Scale." },
  { q: "Which Teltonika devices are supported?", a: "FMB, FMC, FMP, TAT and TFT series out of the box. Custom AVL IDs and IO configs supported via the tenant admin." },
  { q: "What are contract terms?", a: "Monthly, no minimum commitment during pilot. Annual pricing available with a 15% discount after your first paid tenant." },
  { q: "Are you GDPR-compliant?", a: "Yes. DPA available on request, sub-processors listed publicly, EU-only hosting, and full data-subject request tooling per tenant." },
  { q: "What happens if a device is offline?", a: "Teltonika devices buffer records locally. Orbetra ingests store-and-forward payloads on reconnect — nothing lost, nothing duplicated." },
  { q: "Do you have an affiliate program?", a: "Yes — a ?ref= cookie attributes new pilot signups for 60 days. Revenue share is negotiated per partner." },
];

function TspPage() {
  return (
    <>
      <section className="mx-auto max-w-7xl px-6 pt-20 md:pt-28 pb-16">
        <span className="section-label">
          <span className="h-[1px] w-6 bg-[var(--brand-blue)]" />
          — PARTNER TRACK · FOR RESELLERS
        </span>
        <h1 className="display text-5xl md:text-6xl font-bold leading-[1.02] mt-6 max-w-3xl text-ink">
          Reselling GPS?<br />
          <span className="text-gradient">White-label Orbetra.</span>
        </h1>
        <p className="mt-6 text-lg text-muted-foreground max-w-2xl">
          Orbetra's main product is a tracking app for small fleets (1–20 vehicles) — see the <Link to="/" className="text-ink underline underline-offset-4 decoration-[var(--brand-blue)]/60 hover:decoration-[var(--brand-blue)]">homepage</Link>. This page is for TSPs, installers and resellers who want to sell the same platform under their own brand.
        </p>
      </section>

      <section className="mx-auto max-w-7xl px-6 py-16 grid gap-6 md:grid-cols-3">
        {PAINS.map((p, i) => (
          <motion.div
            key={p.t}
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.5, delay: i * 0.08 }}
            className="surface-card p-6"
          >
            <div className="mono text-[11px] tracking-[0.2em] uppercase text-[var(--brand-blue)]">— PAIN 0{i + 1}</div>
            <h3 className="mt-4 display text-xl font-semibold text-ink">{p.t}</h3>
            <p className="mt-2 text-sm text-muted-foreground">{p.b}</p>
          </motion.div>
        ))}
      </section>

      <section className="px-6 py-20">
        <div className="mx-auto max-w-6xl">
          <SectionHeading label="— WHITE-LABEL DIAGRAM">
            One platform. <span className="text-gradient">Three brands away from us.</span>
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
              Orbetra powers your platform. Your customers see only your brand — every screen, every email, every domain.
            </p>
          </div>
        </div>
      </section>

      <section className="px-6 py-20">
        <div className="mx-auto max-w-6xl">
          <SectionHeading label="— MIGRATION IN 4 STEPS">Move without touching your customers.</SectionHeading>
          <ol className="mt-12 grid gap-5 md:grid-cols-2">
            {STEPS.map((s) => (
              <li key={s.n} className="surface-card p-6 flex gap-5">
                <div className="mono text-3xl font-medium text-gradient shrink-0">{s.n}</div>
                <div>
                  <div className="font-display font-semibold text-ink text-lg">{s.t}</div>
                  <div className="text-sm text-muted-foreground mt-1">{s.b}</div>
                </div>
              </li>
            ))}
          </ol>
        </div>
      </section>

      <section className="px-6 py-20">
        <div className="mx-auto max-w-4xl">
          <SectionHeading label="— FAQ">Real questions. <span className="text-gradient">Real answers.</span></SectionHeading>
          <div className="mt-10">
            <FAQAccordion items={FAQ} />
          </div>
        </div>
      </section>

      <section className="px-6 py-20">
        <div className="mx-auto max-w-4xl text-center surface-card p-12">
          <h2 className="display text-3xl md:text-4xl font-bold text-ink">Talk to us before you sign anything.</h2>
          <p className="mt-4 text-muted-foreground">Bring 10 devices. Run 60 days. Decide with data.</p>
          <Link to="/pilot" className="mt-8 pill-primary hover:pill-primary-hover">
            Talk to partnerships <ArrowRight className="h-4 w-4" />
          </Link>
        </div>
      </section>
    </>
  );
}
