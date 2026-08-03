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
        These are the sub-processors Orbetra uses to deliver the service. We give customers 30 days'
        notice before adding or replacing one. To be notified, email{" "}
        <a href="mailto:hello@orbetra.com">hello@orbetra.com</a>.
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
      <p className="mt-8">
        Application data and telemetry are stored in the European Union. Where a sub-processor
        handles limited metadata outside the EEA, transfers rely on the EU Standard Contractual
        Clauses. See the <a href="/dpa">DPA</a> for details.
      </p>
    </LegalPage>
  );
}
