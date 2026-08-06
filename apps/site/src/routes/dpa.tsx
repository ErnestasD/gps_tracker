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
        This Data Processing Addendum ("DPA") is agreed between the customer identified in the
        account registration or order form ("Controller") and <strong>MB Dokigo</strong>, a
        Lithuanian mažoji bendrija, company code 307575857, Krivių g. 5, LT-01204 Vilnius,
        Lithuania, trading as Orbetra ("Processor"). For white-label resellers, the reseller is the
        Controller towards its own end customers and Orbetra remains the Processor. A signable copy
        is available on request at{" "}
        <a href="mailto:hello@orbetra.com">hello@orbetra.com</a>.
      </p>

      <h2>1. Effect and precedence</h2>
      <p>
        This DPA takes effect on the date the Controller first accepts the{" "}
        <a href="/terms">Terms of Service</a> or signs an order form, and stays in force for as
        long as Orbetra processes personal data on the Controller's behalf. It forms part of the
        agreement between the parties. Where it conflicts with the Terms or an order form on the
        processing of personal data, this DPA prevails; on all other matters the Terms prevail.
        Terms defined in the Terms of Service have the same meaning here. Where the EU Standard
        Contractual Clauses apply, they prevail over this DPA in the event of conflict.
      </p>

      <h2>2. Roles of the parties</h2>
      <p>
        The Controller determines the purposes and means of the processing of personal data in its
        workspace — which vehicles are tracked, which drivers are recorded, what rules run and what
        the data is used for. Orbetra processes that data solely to provide the service. Each party
        complies with the GDPR in respect of its own role. The Controller is responsible for the
        lawfulness of the processing it instructs, including informing drivers and completing any
        employee-representative consultation.
      </p>

      <h2>3. Subject matter, duration and scope</h2>
      <p>
        Processing of personal data by Orbetra to provide the fleet-tracking service, for the term
        of the subscription plus the deletion periods in section 11. The details required by GDPR
        Art. 28(3) are set out in Annex I.
      </p>

      <h2>4. Nature and purpose</h2>
      <p>
        Collection, storage, structuring, analysis, display and export of vehicle telemetry and
        related records for the purpose of fleet management by the Controller.
      </p>

      <h2>5. Controller instructions</h2>
      <p>
        Orbetra processes personal data only on documented instructions from the Controller,
        including with regard to transfers, unless required by EU or member-state law — in which
        case Orbetra informs the Controller before processing, unless the law forbids it. The
        Terms, this DPA, the product documentation and the Controller's configuration and use of
        the platform are the complete documented instructions. Orbetra informs the Controller if,
        in its opinion, an instruction infringes data protection law.
      </p>

      <h2>6. Confidentiality</h2>
      <p>Personnel with access are bound by confidentiality and are granted least-privilege access.</p>

      <h2>7. Security measures</h2>
      <p>
        Orbetra implements the technical and organisational measures set out in{" "}
        <strong>Annex II</strong>, taking into account the state of the art, the costs of
        implementation and the risks to data subjects (GDPR Art. 32). Measures may be updated as
        the platform evolves, provided the level of protection is not reduced.
      </p>

      <h2>8. Sub-processors</h2>
      <p>
        The Controller grants general authorisation for the sub-processors listed at{" "}
        <a href="/subprocessors">orbetra.com/subprocessors</a>. Orbetra imposes data protection
        obligations on each sub-processor that are no less protective than this DPA, and remains
        fully liable to the Controller for their performance.
      </p>
      <p>
        <strong>Change notification.</strong> Before adding or replacing a sub-processor, Orbetra
        updates that page and notifies Controllers by email at least <strong>30 days</strong> in
        advance. To be added to the notification list, email{" "}
        <a href="mailto:hello@orbetra.com">hello@orbetra.com</a>.
      </p>
      <p>
        <strong>Objection.</strong> The Controller may object in writing within the 30-day notice
        period on reasonable data-protection grounds. The parties will discuss the objection in good
        faith and Orbetra will use reasonable efforts to offer an alternative or a change of
        configuration. If no resolution is reached, the Controller may terminate the affected part
        of the service without penalty, and Orbetra refunds prepaid fees for the unused period.
      </p>

      <h2>9. International transfers</h2>
      <p>
        Hosting and storage are in the European Union. Where a sub-processor processes limited
        request metadata outside the EEA — currently Mapbox for product map tiles and CARTO for the
        marketing-site basemap — transfers rely on the EU Standard Contractual Clauses (Commission
        Implementing Decision (EU) 2021/914), Module Three (processor to processor), together with a
        transfer impact assessment and supplementary measures such as encryption in transit and
        data minimisation. No fleet telemetry or account data is transferred outside the EEA for
        storage.
      </p>

      <h2>10. Assistance</h2>
      <p>
        Orbetra assists the Controller in meeting its obligations under GDPR Art. 32–36 and in
        responding to data-subject requests, taking into account the nature of the processing and
        the information available to it:
      </p>
      <ul>
        <li>The platform's export, correction and erasure tooling and the REST API let the Controller answer most requests without our involvement.</li>
        <li>If a data subject contacts Orbetra directly about data in a Controller's workspace, Orbetra does not respond on the substance and forwards the request to the Controller within <strong>5 business days</strong>.</li>
        <li>Where the Controller needs our help, we respond to a written assistance request within <strong>10 business days</strong>, and faster where needed for the Controller to meet its own one-month deadline.</li>
        <li>Orbetra notifies the Controller of a personal data breach affecting the Controller's data without undue delay and within <strong>72 hours</strong> of becoming aware, with the information available to us for the Controller's own notification.</li>
        <li>Orbetra provides reasonable information for data protection impact assessments and prior consultations with a supervisory authority.</li>
      </ul>

      <h2>11. Deletion and return</h2>
      <p>
        Telemetry is deleted after the 13-month retention window, and the start/end coordinates of
        trip records are erased at the same point (the trip's distance, times and driver are kept for
        the Controller's own historical reporting and cannot be resolved back to a location). On termination or expiry the
        Controller has 30 days to export data through the app and the API. Orbetra then deletes
        personal data from live systems within 30 days; residual copies in encrypted backups are
        overwritten on the normal backup rotation, within 30 days of that deletion. Orbetra keeps
        only what EU or member-state law requires it to keep, and protects it under this DPA for as
        long as it is kept. Orbetra confirms deletion in writing on request.
      </p>

      <h2>12. Audit</h2>
      <p>
        Orbetra makes available the information needed to demonstrate compliance with Art. 28 and
        permits audits by the Controller or an independent auditor, once per year and on at least
        30 days' notice, during business hours, without unreasonable disruption and subject to
        confidentiality. Additional audits may be carried out after a personal data breach or when
        a supervisory authority requires it. The Controller bears its own audit costs.
      </p>

      <h2>13. Liability</h2>
      <p>
        The limitations and exclusions of liability in the{" "}
        <a href="/terms">Terms of Service</a> apply to claims under this DPA, to the extent
        permitted by law. Nothing in this DPA limits the rights of data subjects or the liability
        of either party under GDPR Art. 82.
      </p>

      <h2>Annex I — Description of the processing</h2>
      <p><strong>A. Parties.</strong></p>
      <ul>
        <li><strong>Data exporter / Controller:</strong> the customer identified in the account registration or order form, acting as controller for the personal data in its workspace. For white-label deployments, the reseller.</li>
        <li><strong>Data importer / Processor:</strong> MB Dokigo (Orbetra), Krivių g. 5, LT-01204 Vilnius, Lithuania, company code 307575857. Contact: <a href="mailto:hello@orbetra.com">hello@orbetra.com</a>.</li>
      </ul>
      <p><strong>B. Description of processing.</strong></p>
      <ul>
        <li><strong>Categories of data subjects:</strong> the Controller's drivers and other vehicle occupants, employees and workspace users; for resellers, their end customers' users and drivers.</li>
        <li><strong>Categories of personal data:</strong> names, work emails, roles and permissions, driver identifiers and licence data entered by the Controller, vehicle assignments, positions and routes, speed and driving events, ignition and working hours, fuel and maintenance records, device commands, and audit logs. Device identity is IMEI-based.</li>
        <li><strong>Special categories:</strong> none. No special-category data is intentionally processed; the Controller must not enter it into free-text fields.</li>
        <li><strong>Frequency:</strong> continuous — telemetry arrives from devices in near real time; account and configuration data on use.</li>
        <li><strong>Nature and purpose:</strong> hosting, storing, structuring, analysing, displaying and exporting the above so the Controller can manage its fleet, as described in sections 3 and 4.</li>
        <li><strong>Duration:</strong> the term of the subscription, plus the retention and deletion periods in section 11 (telemetry 13 months by default; deletion after the 30-day export window on termination).</li>
        <li><strong>Sub-processors:</strong> as listed at <a href="/subprocessors">orbetra.com/subprocessors</a>, for the purposes and durations stated there.</li>
      </ul>
      <p>
        <strong>C. Competent supervisory authority.</strong> Orbetra is established in Lithuania, so
        the competent authority is the Lithuanian State Data Protection Inspectorate (Valstybinė
        duomenų apsaugos inspekcija, VDAI), Vilnius. Where the Controller is established in another
        EU member state, its own supervisory authority is competent for its processing.
      </p>

      <h2>Annex II — Technical and organisational measures</h2>
      <ul>
        <li>TLS 1.2+ for data in transit; encryption at rest for databases and backups.</li>
        <li>Tenant isolation enforced in the data layer, and role-based access control; SSO available on Scale and Enterprise.</li>
        <li>Audit logging of administrative and data-access actions.</li>
        <li>Automated backups with tested restore procedures.</li>
        <li>Segregated environments, code review, dependency scanning and least-privilege infrastructure access.</li>
        <li>Access to production data limited to personnel who need it, bound by confidentiality, over authenticated and logged channels.</li>
        <li>Pseudonymisation where practical: devices are identified by IMEI, and driver identity is only what the Controller enters.</li>
        <li>Data minimisation and retention limits enforced by the platform (13-month telemetry default).</li>
        <li>Incident response with notification to the Controller without undue delay and within 72 hours of becoming aware of a personal data breach.</li>
        <li>Business continuity: EU-hosted infrastructure with monitored ingest pipeline and restore procedures exercised against backups.</li>
      </ul>
    </LegalPage>
  ),
});
