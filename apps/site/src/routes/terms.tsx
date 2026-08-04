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
        These terms govern access to and use of the Orbetra platform, operated by MB Dokigo, a
        Lithuanian mažoji bendrija, Krivių g. 5, LT-01204 Vilnius, Lithuania, company code 307575857
        ("Orbetra", "we", "us"). By creating an account, signing an order form or using the service
        you accept them. If you accept on behalf of an organisation, you confirm you are authorised
        to bind it. The service is provided to businesses and other organisations, not to consumers.
      </p>

      <h2>1. Definitions</h2>
      <ul>
        <li><strong>Agreement</strong> — these terms together with the documents listed in section 2.</li>
        <li><strong>Customer</strong>, <strong>you</strong> — the organisation that subscribes to the service.</li>
        <li><strong>Service</strong>, <strong>platform</strong> — the Orbetra web application, APIs, webhooks, ingest endpoints and documentation.</li>
        <li><strong>Workspace</strong> — the isolated tenant in which your devices, users and data live. A reseller workspace may contain sub-accounts.</li>
        <li><strong>User</strong> — a person you authorise to access your workspace.</li>
        <li><strong>Customer data</strong> — everything you or your devices send to, or generate in, the service: telemetry, trips, events, driver and vehicle records, configuration and audit logs.</li>
        <li><strong>Device</strong> — a GPS tracking unit identified by its IMEI that you connect to the service.</li>
        <li><strong>Reseller</strong>, <strong>TSP</strong> — a customer licensing the white-label platform to serve its own end customers.</li>
        <li><strong>Order form</strong> — any written or electronic order, pilot or reseller agreement signed by both parties.</li>
        <li><strong>DPA</strong> — the <a href="/dpa">Data Processing Addendum</a>.</li>
      </ul>

      <h2>2. Agreement documents and order of precedence</h2>
      <p>
        The Agreement consists of, in descending order of precedence: (a) a signed order form,
        pilot or reseller agreement, for the matters it expressly covers; (b) the DPA, which
        prevails on anything concerning the processing of personal data; (c) these terms; (d) the
        published documentation and the plan descriptions at{" "}
        <a href="/pricing">orbetra.com/pricing</a>. Purchase-order terms, vendor-portal terms or
        similar documents issued by you do not apply, even if we acknowledge the order.
      </p>

      <h2>3. The service</h2>
      <p>
        Orbetra is a GPS fleet-tracking platform: live tracking, trips and playback, geofences,
        rules and alerts, reports, fuel level monitoring, driver records, maintenance reminders,
        device commands, webhooks and a REST API. Resellers may additionally licence the
        white-label platform with their own branding, domains and sub-accounts. We may improve and
        change the service; we will not materially reduce the core functionality of your plan
        during a paid term without notice under section 25.
      </p>

      <h2>4. Accounts and users</h2>
      <p>
        You are responsible for the accuracy of your account details, for everything your users do
        in your workspace, and for keeping credentials and API keys confidential. Users must be at
        least 18. You must promptly remove access for people who leave your organisation, and tell
        us at <a href="mailto:hello@orbetra.com">hello@orbetra.com</a> if you suspect credentials
        have been compromised. Resellers are responsible towards us for their sub-accounts.
      </p>

      <h2>5. Trials and pilots</h2>
      <p>
        Free trials run for 30 days without a card. At the end of a trial the workspace becomes
        read-only unless a paid subscription is started. Trial data is deleted 30 days after the
        trial ends unless you subscribe. Reseller pilots are sales-led and run for the period
        stated in the pilot agreement. Trials and pilots are provided as-is, without the uptime
        commitment in section 12.
      </p>

      <h2>6. Fees, billing and taxes</h2>
      <p>
        Subscriptions are billed monthly or annually in advance in EUR. Prices are those published
        at <a href="/pricing">orbetra.com/pricing</a> at the time of purchase, or those in your
        order form. Annual plans are billed for the full term. Fees are exclusive of VAT and other
        taxes; EU business customers who supply a valid VAT number are invoiced under
        the reverse-charge mechanism where it applies. Plans include a device allowance; usage above
        that allowance is billed as overage at the rate published for your plan, or you can move to
        a larger plan at any time. Late payment may lead to suspension after notice
        under section 17. Fees already paid are non-refundable except where these terms or
        mandatory law say otherwise. We may change list prices with at least 30 days' notice,
        effective at your next renewal.
      </p>

      <h2>7. Acceptable use</h2>
      <ul>
        <li>No unlawful surveillance. You must have a lawful basis for tracking vehicles and must inform drivers as required by local law.</li>
        <li>No tracking of individuals outside a legitimate fleet-management purpose, and no use of the service to harass, stalk or covertly monitor a person.</li>
        <li>No reverse engineering, resale or sublicensing of the direct product outside a signed reseller agreement.</li>
        <li>No attempts to disrupt the service, bypass rate limits, probe or scan the infrastructure, or access other tenants' data.</li>
        <li>No uploading of malware, and no use of the platform to store data unrelated to fleet operations.</li>
        <li>API keys must be kept secret and rotated if exposed.</li>
      </ul>

      <h2>8. Your responsibilities as employer and controller</h2>
      <p>
        Vehicle tracking is regulated employment and data-protection territory, and those duties sit
        with you, not with us. Before connecting devices you must, where applicable: establish and
        document a lawful basis; inform drivers and other affected people about the tracking, its
        purpose and its retention; complete any works-council or employee-representative
        consultation and agreement (for example a Betriebsvereinbarung in Germany, or consultation
        with employee representatives in Poland and other jurisdictions); carry out a data
        protection impact assessment where one is required; and configure retention, private-mode
        and geofence settings so that they match what you told your drivers. You are responsible for
        the lawfulness of the instructions you give us through the platform.
      </p>

      <h2>9. Intellectual property and licence</h2>
      <p>
        The platform, its software, interfaces, documentation and branding remain ours and our
        licensors'. Subject to the Agreement and payment of fees, we grant you a non-exclusive,
        non-transferable, revocable right to use the service during the subscription term for your
        internal business purposes — and, for resellers, to resell access to their end customers on
        the terms of their reseller agreement. Nothing transfers ownership. You keep all rights in
        your data, your brand assets and your content; you grant us only the limited right to host,
        process, transmit and display them as needed to provide and support the service. Feedback
        you send us may be used freely to improve the product, without obligation and without
        identifying you.
      </p>

      <h2>10. Your data</h2>
      <p>
        You retain ownership of your data. We process personal data in it under the{" "}
        <a href="/dpa">Data Processing Addendum</a>, as processor on your instructions. You can
        export via API, CSV, XLSX or PDF at any time. Telemetry is retained for 13 months by
        default. We do not sell customer data and do not use it to train models or for advertising.
      </p>

      <h2>11. Confidentiality</h2>
      <p>
        Each party may receive non-public information from the other — pricing and order terms,
        product roadmaps, security details, customer data. Each party will use the other's
        confidential information only to perform the Agreement, protect it with at least reasonable
        care, and disclose it only to personnel and subcontractors who need it and are bound by
        equivalent duties. The duty does not cover information that is public without breach,
        independently developed, or lawfully received from a third party, and it does not prevent
        disclosure required by law or a regulator, where the other party is notified if legally
        permitted. These obligations survive for three years after termination, and for as long as
        the law protects the information in the case of trade secrets.
      </p>

      <h2>12. Support and service levels</h2>
      <p>
        Support is provided by email at <a href="mailto:hello@orbetra.com">hello@orbetra.com</a> on
        Lithuanian business days. The support level and any named contact depend on your plan, as
        described at <a href="/pricing">orbetra.com/pricing</a>; specific response targets, where we
        commit to them, are stated in your order form. A contractual{" "}
        <strong>99.9% monthly uptime commitment with service credits applies to Scale and
        Enterprise plans only</strong>; the credit schedule and the measurement method are set out
        in the order form. Credits must be requested in writing within 30 days of the end of the
        affected month and are the sole and exclusive remedy for missed uptime. All other plans are
        supported on a best-effort basis without a contractual SLA.
      </p>

      <h2>13. Availability and maintenance</h2>
      <p>
        We aim for high availability and publish incidents on our status page. Planned maintenance
        is announced in advance where practical and scheduled outside European business hours where
        possible. Emergency maintenance may be carried out at any time; we will tell you as soon as
        we reasonably can. Downtime caused by your systems, your devices, mobile networks, GNSS
        conditions, or by events under section 21, does not count against any uptime commitment.
      </p>

      <h2>14. Beta and preview features</h2>
      <p>
        Features labelled beta, preview or early access are optional and provided as-is, without
        warranty, support commitment or SLA. They may change, break or be withdrawn at any time,
        and they are excluded from sections 12 and 13. Do not rely on them for operationally
        critical decisions, and treat information about them as confidential.
      </p>

      <h2>15. Fair use and API limits</h2>
      <p>
        The API and webhooks are subject to the rate limits stated in the documentation and to fair
        use. We may throttle or temporarily restrict requests that threaten platform stability, and
        we will contact you before doing so unless the risk is immediate. Sustained usage well
        beyond your plan — device counts above your entitlement, bulk polling in place of
        webhooks, or automated re-export of the whole dataset — may require an upgrade. Do not use
        the API to build a competing tracking service.
      </p>

      <h2>16. Devices and third parties</h2>
      <p>
        Orbetra depends on your tracking hardware, its SIM connectivity and GNSS availability. We
        are not responsible for gaps or inaccuracies caused by hardware, installation, network
        coverage or satellite conditions. Device identity is based on IMEI; the service is not
        tamper-proof and must not be relied on as sole evidence.
      </p>

      <h2>17. Suspension</h2>
      <p>
        We may suspend a workspace, a user or an API key if fees remain unpaid after written
        reminder, if the acceptable-use rules in section 7 are breached, if there is a credible
        security threat to the platform or to other customers, or if suspension is required by law.
        Except where the risk is immediate or the law requires otherwise, we give at least 7 days'
        notice and a chance to fix the problem. Suspension is limited to what is necessary — we
        restore access as soon as the cause is resolved. Suspension does not suspend your obligation
        to pay, and it does not by itself delete data: the retention and deletion rules in section
        19 apply only on termination.
      </p>

      <h2>18. Term and termination</h2>
      <p>
        Monthly subscriptions may be cancelled at any time and end at the close of the paid period.
        Annual subscriptions renew for a further year unless either party gives notice at least 30
        days before the renewal date. Either party may terminate for material breach not cured
        within 30 days of written notice, or immediately if the other party becomes insolvent.
      </p>

      <h2>19. Export and deletion after termination</h2>
      <p>
        After termination or expiry your workspace stays available in read-only mode for 30 days so
        you can export data through the app and the API. After that window we delete customer data
        from live systems within 30 days; residual copies in encrypted backups are overwritten on
        the normal backup rotation, within 30 days of the deletion. We keep only what law requires
        us to keep — mainly invoices and accounting records. On written request we will confirm
        deletion. Resellers are responsible for giving their own end customers an equivalent export
        window.
      </p>

      <h2>20. Liability</h2>
      <p>
        To the maximum extent permitted by law, neither party is liable for indirect or
        consequential loss, loss of profit, or loss of data. Our aggregate liability in any 12-month
        period is limited to the fees you paid in that period. Nothing limits liability for fraud,
        wilful misconduct or death and personal injury. These limits apply to the whole Agreement,
        including the DPA.
      </p>

      <h2>21. Force majeure</h2>
      <p>
        Neither party is liable for delay or failure caused by events beyond its reasonable
        control, including natural disasters, war, terrorism, civil unrest, epidemics, strikes,
        failures of power, mobile networks, GNSS or upstream internet providers, large-scale
        cyber-attacks, and acts of public authorities. Payment obligations are not excused. If the
        event lasts more than 30 days, either party may terminate the affected subscription and we
        refund prepaid fees for the unused period.
      </p>

      <h2>22. Subcontractors</h2>
      <p>
        We may use subcontractors and sub-processors to deliver the service — the current list is
        published at <a href="/subprocessors">orbetra.com/subprocessors</a> — and we remain
        responsible for their performance as if it were our own. Changes to sub-processors follow
        the 30-day notice and objection process in the <a href="/dpa">DPA</a>.
      </p>

      <h2>23. Assignment</h2>
      <p>
        Neither party may assign the Agreement without the other's written consent, which will not
        be unreasonably withheld. Either party may assign it in full to an affiliate or to a
        successor in a merger, reorganisation or sale of substantially all of its business, on
        written notice. Any other attempted assignment is void.
      </p>

      <h2>24. Notices</h2>
      <p>
        We give notices by email to the addresses registered in your account and, for changes that
        affect all customers, by publishing them at orbetra.com — service notices such as incidents
        and maintenance may also appear in the app. You give notices to{" "}
        <a href="mailto:hello@orbetra.com">hello@orbetra.com</a>; notices of termination or of a
        legal claim must also be sent by post to MB Dokigo, Krivių g. 5, LT-01204 Vilnius,
        Lithuania. Email notices are deemed received on the next business day. Keep your billing and
        administrative contacts current — that is where the notices go.
      </p>

      <h2>25. Changes to these terms</h2>
      <p>
        We may update these terms with at least 30 days' notice for material changes, given by
        email and on this page. Continued use after the effective date means acceptance. If a
        material change is unacceptable to you, you may terminate before it takes effect and we
        refund prepaid fees for the unused period.
      </p>

      <h2>26. Governing law and jurisdiction</h2>
      <p>
        Lithuanian law applies, excluding its conflict-of-law rules and the UN Convention on
        Contracts for the International Sale of Goods; the courts of Vilnius have exclusive
        jurisdiction, without affecting mandatory consumer protections in your country of
        residence. Either party may still seek injunctive relief in any competent court to protect
        its intellectual property or confidential information.
      </p>

      <h2>27. General</h2>
      <p>
        If any provision is held invalid, the rest stays in force and the invalid part is replaced
        by a valid one closest to its intent. A failure to enforce a right is not a waiver of it.
        The Agreement is the entire agreement between the parties on its subject and replaces
        earlier proposals and statements. Nothing in it creates a partnership, agency or employment
        relationship, and it creates no rights for third parties. Sections that by their nature
        should survive termination — including 9, 10, 11, 19, 20, 26 and 27 — do so.
      </p>
    </LegalPage>
  ),
});
