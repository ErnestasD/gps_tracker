import { createFileRoute } from "@tanstack/react-router";
import { LegalPage } from "@/components/site/LegalPage";

export const Route = createFileRoute("/terms")({
  head: () => ({
    meta: [
      { title: "Terms of Service — Orbetra" },
      { name: "description", content: "Orbetra terms of service: subscriptions, trials, acceptable use, uptime commitments, liability and termination." },
      { property: "og:title", content: "Terms of Service — Orbetra" },
      { property: "og:description", content: "Subscriptions, trials, acceptable use, uptime, liability and termination." },
      { property: "og:type", content: "article" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: () => (
    <LegalPage updated="August 2026" title="Terms of Service" label="— LEGAL">
      <p>
        These terms govern use of the Orbetra platform, operated by MB Dokigo, Krivių g. 5,
        LT-01204 Vilnius, Lithuania, company code 307575857 ("Orbetra", "we"). By creating an
        account you agree to them. First draft pending legal review.
      </p>

      <h2>1. The service</h2>
      <p>
        Orbetra is a GPS fleet-tracking platform: live tracking, trips and
        playback, geofences, rules and alerts, reports, fuel level monitoring, driver records,
        maintenance reminders, device commands, webhooks and a REST API. Resellers may additionally
        licence the white-label platform with their own branding, domains and sub-accounts.
      </p>

      <h2>2. Accounts</h2>
      <p>
        You are responsible for the accuracy of your account details, for your users, and for
        keeping credentials confidential. You must be at least 18 and authorised to bind your
        organisation.
      </p>

      <h2>3. Trials</h2>
      <p>
        Free trials run for 30 days without a card. At the end of a trial the workspace becomes
        read-only unless a paid subscription is started. Trial data is deleted 30 days after the
        trial ends unless you subscribe.
      </p>

      <h2>4. Fees and billing</h2>
      <p>
        Subscriptions are billed monthly or annually in advance in EUR, excluding VAT. Prices are
        those published at orbetra.com/pricing at the time of purchase. Annual plans are billed for
        the full term. Late payment may lead to suspension after notice. Fees already paid are
        non-refundable except where required by law.
      </p>

      <h2>5. Acceptable use</h2>
      <ul>
        <li>No unlawful surveillance. You must have a lawful basis for tracking vehicles and must inform drivers as required by local law.</li>
        <li>No reverse engineering, resale or sublicensing of the direct product outside a signed reseller agreement.</li>
        <li>No attempts to disrupt the service, bypass rate limits, or access other tenants' data.</li>
        <li>API keys must be kept secret and rotated if exposed.</li>
      </ul>

      <h2>6. Your data</h2>
      <p>
        You retain ownership of your data. We process it under the{" "}
        <a href="/dpa">Data Processing Addendum</a>. You can export via API, CSV, XLSX or PDF at any
        time. Telemetry is retained for 13 months by default.
      </p>

      <h2>7. Availability</h2>
      <p>
        We aim for high availability and publish incidents on our status page. A contractual 99.9%
        monthly uptime SLA with service credits applies to <strong>Scale and Enterprise</strong>{" "}
        plans only. Planned maintenance is announced in advance where practical.
      </p>

      <h2>8. Devices and third parties</h2>
      <p>
        Orbetra depends on your tracking hardware, its SIM connectivity and GNSS availability. We
        are not responsible for gaps or inaccuracies caused by hardware, installation, network
        coverage or satellite conditions. Device identity is based on IMEI; the service is not
        tamper-proof and must not be relied on as sole evidence.
      </p>

      <h2>9. Liability</h2>
      <p>
        To the maximum extent permitted by law, neither party is liable for indirect or
        consequential loss, loss of profit, or loss of data. Our aggregate liability in any 12-month
        period is limited to the fees you paid in that period. Nothing limits liability for fraud,
        wilful misconduct or death and personal injury.
      </p>

      <h2>10. Term and termination</h2>
      <p>
        Monthly subscriptions may be cancelled at any time and end at the close of the paid period.
        Either party may terminate for material breach not cured within 30 days. On termination you
        have 30 days to export your data, after which it is deleted.
      </p>

      <h2>11. Changes</h2>
      <p>
        We may update these terms with at least 30 days' notice for material changes. Continued use
        after the effective date means acceptance.
      </p>

      <h2>12. Governing law</h2>
      <p>
        Lithuanian law applies; the courts of Vilnius have exclusive jurisdiction, without affecting
        mandatory consumer protections in your country of residence.
      </p>
    </LegalPage>
  ),
});
