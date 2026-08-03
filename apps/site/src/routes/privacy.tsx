import { createFileRoute } from "@tanstack/react-router";
import { LegalPage } from "@/components/site/LegalPage";

export const Route = createFileRoute("/privacy")({
  head: () => ({
    meta: [
      { title: "Privacy Policy — Orbetra" },
      { name: "description", content: "How Orbetra collects, uses and retains data: EU hosting, 13-month telemetry retention, GDPR rights, and how to contact us." },
      { property: "og:title", content: "Privacy Policy — Orbetra" },
      { property: "og:description", content: "EU hosting, 13-month telemetry retention and full GDPR rights." },
      { property: "og:type", content: "article" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: () => (
    <LegalPage updated="August 2026" title="Privacy Policy" label="— LEGAL">
      <p>
        This policy explains how MB Dokigo (trading as Orbetra), Krivių g. 5, LT-01204 Vilnius,
        Lithuania, company code 307575857, handles personal data. Contact:{" "}
        <a href="mailto:hello@orbetra.com">hello@orbetra.com</a>. This is a first draft pending
        legal review.
      </p>

      <h2>1. Our two roles</h2>
      <p>
        For our website, marketing and billing we are the <strong>controller</strong>. For
        telemetry and fleet data processed inside a customer's Orbetra workspace we act as a{" "}
        <strong>processor</strong> on behalf of that customer (or, for white-label resellers, on
        behalf of the reseller). See our <a href="/dpa">Data Processing Addendum</a>.
      </p>

      <h2>2. Data we collect as controller</h2>
      <ul>
        <li><strong>Account data</strong> — name, work email, company, password hash.</li>
        <li><strong>Billing data</strong> — plan, invoices, VAT details; card data is handled by our payment provider, never stored by us.</li>
        <li><strong>Support and enquiry data</strong> — messages you send us via forms or email.</li>
        <li><strong>Technical logs</strong> — IP address, user agent and request metadata, kept for security and abuse prevention.</li>
        <li><strong>Referral attribution</strong> — an optional cookie that credits a partner if you arrive via a <code>?ref=</code> link, set only with your consent.</li>
      </ul>
      <p>Website analytics is aggregated and cookieless. We do not run advertising trackers.</p>

      <h2>3. Data processed as processor</h2>
      <p>
        Inside a workspace we process device telemetry (position, speed, ignition, digital inputs,
        power and battery status, CAN data where available), trips, geofence and rule events,
        driver records, maintenance entries, commands sent to devices, and account users. Vehicle
        and device identity is based on the device IMEI.
      </p>

      <h2>4. Legal bases</h2>
      <ul>
        <li>Performance of a contract — providing the service, billing, support.</li>
        <li>Legitimate interests — securing the platform, preventing abuse, improving the product, partner attribution.</li>
        <li>Consent — optional cookies and marketing email, withdrawable at any time.</li>
        <li>Legal obligation — accounting and tax records.</li>
      </ul>

      <h2>5. Retention</h2>
      <ul>
        <li>Telemetry and event data: <strong>13 months</strong> by default, then deleted.</li>
        <li>Account data: for the life of the account, then deleted or anonymised within 90 days.</li>
        <li>Invoices and accounting records: as required by Lithuanian law (currently 10 years).</li>
        <li>Security logs: up to 12 months.</li>
      </ul>

      <h2>6. Hosting and transfers</h2>
      <p>
        Orbetra runs on infrastructure physically located in the European Union. Geocoding
        (Photon) and routing (OSRM) are self-hosted by us in the EU. Map tiles are provided by
        Mapbox, which may process request metadata outside the EU under an appropriate transfer
        mechanism. Regional data-residency <em>entitlements</em> (choosing a specific region) are
        available on Scale and Enterprise plans; EU hosting applies to everyone.
      </p>

      <h2>7. Sub-processors</h2>
      <p>
        A current list is published at <a href="/subprocessors">orbetra.com/subprocessors</a>. We
        give 30 days' notice before adding or replacing a sub-processor.
      </p>

      <h2>8. Your rights</h2>
      <p>
        Under the GDPR you can request access, rectification, erasure, restriction, portability
        and object to processing based on legitimate interests. Workspace owners can also run
        self-service export and erasure from inside the app. Write to{" "}
        <a href="mailto:hello@orbetra.com">hello@orbetra.com</a>; we respond within one month. If
        you are an end user of a customer's or reseller's workspace, please contact them first —
        they are the controller.
      </p>
      <p>
        You may lodge a complaint with the Lithuanian State Data Protection Inspectorate (VDAI) or
        your local supervisory authority.
      </p>

      <h2>9. Security</h2>
      <p>
        TLS in transit, encryption at rest, role-based access with least privilege, audit logging,
        isolated tenants, and regular backups. Single sign-on (SSO) is available on Scale and
        Enterprise plans.
      </p>

      <h2>10. Changes</h2>
      <p>
        We update this policy as the product changes and post the new version here with a revised
        "last updated" date.
      </p>
    </LegalPage>
  ),
});
