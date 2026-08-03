import { createFileRoute } from "@tanstack/react-router";
import { LegalPage } from "@/components/site/LegalPage";

export const Route = createFileRoute("/dpa")({
  head: () => ({
    meta: [
      { title: "Data Processing Addendum — Orbetra" },
      { name: "description", content: "Orbetra's DPA: controller and processor roles, processing scope, security measures, sub-processors, transfers and data-subject requests." },
      { property: "og:title", content: "Data Processing Addendum — Orbetra" },
      { property: "og:description", content: "Roles, scope, security measures, sub-processors and transfers." },
      { property: "og:type", content: "article" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: () => (
    <LegalPage updated="August 2026" title="Data Processing Addendum" label="— LEGAL">
      <p>
        This DPA forms part of the agreement between the customer ("Controller") and MB Dokigo,
        trading as Orbetra ("Processor"). For white-label resellers, the reseller is the Controller
        towards its own end customers and Orbetra remains the Processor. First draft pending legal
        review; a signable copy is available on request at{" "}
        <a href="mailto:hello@orbetra.com">hello@orbetra.com</a>.
      </p>

      <h2>1. Subject matter and duration</h2>
      <p>
        Processing of personal data by Orbetra to provide the fleet-tracking service, for the term of
        the subscription plus the deletion periods described below.
      </p>

      <h2>2. Nature and purpose</h2>
      <p>
        Collection, storage, structuring, analysis, display and export of vehicle telemetry and
        related records for the purpose of fleet management by the Controller.
      </p>

      <h2>3. Categories of data subjects and data</h2>
      <ul>
        <li><strong>Data subjects:</strong> the Controller's drivers, employees, workspace users and, for resellers, their end customers' users.</li>
        <li><strong>Personal data:</strong> names, emails, roles, driver identifiers, vehicle assignments, positions and routes, speed and driving events, working/engine hours, maintenance records, and audit logs. Device identity is IMEI-based.</li>
        <li>No special-category data is intentionally processed.</li>
      </ul>

      <h2>4. Controller instructions</h2>
      <p>
        Orbetra processes personal data only on documented instructions from the Controller,
        including with regard to transfers, unless required by EU or member-state law.
      </p>

      <h2>5. Confidentiality</h2>
      <p>Personnel with access are bound by confidentiality and are granted least-privilege access.</p>

      <h2>6. Security measures (Annex II)</h2>
      <ul>
        <li>TLS 1.2+ for data in transit; encryption at rest for databases and backups.</li>
        <li>Tenant isolation and role-based access control; SSO available on Scale and Enterprise.</li>
        <li>Audit logging of administrative and data-access actions.</li>
        <li>Automated backups with tested restore procedures.</li>
        <li>Segregated environments, code review, dependency scanning and least-privilege infrastructure access.</li>
        <li>Incident response with notification to the Controller without undue delay and within 72 hours of becoming aware of a personal data breach.</li>
      </ul>

      <h2>7. Sub-processors</h2>
      <p>
        The Controller grants general authorisation for the sub-processors listed at{" "}
        <a href="/subprocessors">orbetra.com/subprocessors</a>. Orbetra gives 30 days' notice of
        changes; the Controller may object on reasonable data-protection grounds and, if unresolved,
        terminate the affected service.
      </p>

      <h2>8. International transfers</h2>
      <p>
        Hosting and storage are in the European Union. Where a sub-processor (for example Mapbox for
        map tiles) processes limited request metadata outside the EEA, transfers rely on the EU
        Standard Contractual Clauses and applicable adequacy decisions, with supplementary measures
        as needed.
      </p>

      <h2>9. Assistance</h2>
      <p>
        Orbetra assists the Controller with data-subject requests through in-app export and erasure
        tooling and the API, and with DPIAs and regulator queries on reasonable request.
      </p>

      <h2>10. Deletion and return</h2>
      <p>
        Telemetry is deleted after the 13-month retention window. On termination the Controller has
        30 days to export; Orbetra then deletes the data, except where retention is required by law.
      </p>

      <h2>11. Audit</h2>
      <p>
        Orbetra makes available the information needed to demonstrate compliance and permits audits
        by the Controller or an independent auditor, once per year and on reasonable notice, subject
        to confidentiality.
      </p>
    </LegalPage>
  ),
});
