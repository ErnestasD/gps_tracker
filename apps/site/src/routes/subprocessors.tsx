import { createFileRoute } from "@tanstack/react-router";
import { LegalPage } from "@/components/site/LegalPage";

export const Route = createFileRoute("/subprocessors")({
  head: () => ({
    meta: [
      { title: "Subprocessors — Orbetra" },
      { name: "description", content: "Current list of Orbetra sub-processors, what they do, where they process data, and our 30-day change notice." },
      { property: "og:title", content: "Subprocessors — Orbetra" },
      { property: "og:description", content: "Who we use, for what, and where data is processed." },
      { property: "og:type", content: "article" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: SubprocessorsPage,
});

const LIST = [
  { name: "Hetzner Online GmbH", purpose: "Primary application, database and telemetry hosting", location: "Germany (EU)" },
  { name: "Mapbox, Inc.", purpose: "Map tiles rendered in the web and mobile app", location: "USA — request metadata only, SCCs in place" },
  { name: "CARTO (Mapbox-independent)", purpose: "Basemap style and tiles on the public marketing site only (no customer data)", location: "USA/EU CDN — request metadata only, SCCs in place" },
  { name: "Self-hosted Photon & OSRM", purpose: "Geocoding and routing (operated by Orbetra, no third party)", location: "Germany (EU)" },
  { name: "Stripe Payments Europe, Ltd.", purpose: "Subscription billing and payment processing", location: "Ireland (EU)" },
  { name: "Postmark (ActiveCampaign, LLC)", purpose: "Transactional email (alerts, reports, account emails)", location: "EU region endpoint" },
  { name: "Cloudflare, Inc.", purpose: "DNS, TLS termination and DDoS protection", location: "Global edge — EU-first routing, SCCs in place" },
];

function SubprocessorsPage() {
  return (
    <LegalPage updated="August 2026" title="Subprocessors" label="— LEGAL">
      <p>
        These are the third parties Orbetra uses to deliver the service and that may process
        personal data on our behalf. The list is complete: no other party receives customer data.
        It is maintained under section 8 of the <a href="/dpa">DPA</a> and was last reviewed in{" "}
        <strong>August 2026</strong>.
      </p>
      <div className="not-prose mt-8 surface-card overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
              <th className="text-left px-4 py-3">Sub-processor</th>
              <th className="text-left px-4 py-3">Purpose</th>
              <th className="text-left px-4 py-3">Processing location</th>
            </tr>
          </thead>
          <tbody>
            {LIST.map((s) => (
              <tr key={s.name} className="border-t border-[var(--hairline)]">
                <td className="px-4 py-3 text-ink">{s.name}</td>
                <td className="px-4 py-3 text-ink/80">{s.purpose}</td>
                <td className="px-4 py-3 text-muted-foreground">{s.location}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <h2>1. How we notify changes</h2>
      <p>
        Before we add or replace a sub-processor we update this page and notify customers by email
        at least <strong>30 days</strong> in advance. To be added to that notification list, email{" "}
        <a href="mailto:hello@orbetra.com">hello@orbetra.com</a> with the address you want us to
        use.
      </p>
      <p>
        A customer may object in writing within the 30-day notice period on reasonable
        data-protection grounds. We will discuss the objection in good faith and try to offer an
        alternative or a change of configuration; if we cannot resolve it, the customer may
        terminate the affected part of the service without penalty and we refund prepaid fees for
        the unused period. The full process is in section 8 of the <a href="/dpa">DPA</a>.
      </p>
      <p>
        Where a change is urgent — for example replacing a provider that has become a security risk
        — we may act sooner and notify without delay, explaining why.
      </p>

      <h2>2. Where data is processed</h2>
      <p>
        Application data and telemetry are stored in the European Union. Where a sub-processor
        handles limited metadata outside the EEA, transfers rely on the EU Standard Contractual
        Clauses (Commission Implementing Decision (EU) 2021/914). See the <a href="/dpa">DPA</a>{" "}
        for details.
      </p>
    </LegalPage>
  );
}
