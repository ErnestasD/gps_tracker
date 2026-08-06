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
        This policy explains how we handle personal data on orbetra.com and in the Orbetra
        platform. It covers both the data we decide about ourselves and the data we process for
        our customers. Cookies are described separately in the{" "}
        <a href="/cookies">Cookie Policy</a>.
      </p>

      <h2>1. Who we are</h2>
      <p>
        The controller for the processing described in section 3 is:
      </p>
      <ul>
        <li><strong>MB Dokigo</strong>, a Lithuanian mažoji bendrija, trading as Orbetra</li>
        <li>Krivių g. 5, LT-01204 Vilnius, Lithuania</li>
        <li>Company code <strong>307575857</strong></li>
        <li>Director: Ernestas Dubovskich</li>
        <li>Privacy contact: <a href="mailto:hello@orbetra.com">hello@orbetra.com</a></li>
      </ul>
      <p>
        We have not appointed a data protection officer. All privacy questions, requests and
        complaints go to <a href="mailto:hello@orbetra.com">hello@orbetra.com</a> and are handled
        by the director.
      </p>

      <h2>2. Our two roles</h2>
      <p>
        For our website, marketing, sales and billing we are the <strong>controller</strong> — we
        decide why and how the data is processed. For everything inside a customer's Orbetra
        workspace — telemetry, trips, driver records, workspace users — we act as a{" "}
        <strong>processor</strong> on documented instructions from that customer. For white-label
        resellers, the reseller is the controller towards its own end customers and we remain the
        processor. Those roles, our obligations and the security measures are set out in the{" "}
        <a href="/dpa">Data Processing Addendum</a>, which forms part of every customer contract.
        If you are a driver or an employee of one of our customers, that customer decides how your
        data is used — please direct your request to them first (see section 14).
      </p>

      <h2>3. Data we collect as controller</h2>
      <ul>
        <li><strong>Account data</strong> — name, work email, company, password hash.</li>
        <li><strong>Billing data</strong> — plan, invoices, VAT details; card data is handled by our payment provider, never stored by us.</li>
        <li><strong>Support and enquiry data</strong> — messages you send us via forms or email, including pilot requests.</li>
        <li><strong>Technical logs</strong> — IP address, user agent and request metadata, kept for security and abuse prevention.</li>
        <li><strong>Referral attribution</strong> — an optional cookie that credits a partner if you arrive via a <code>?ref=</code> link, set only with your consent.</li>
      </ul>
      <p>Website analytics is aggregated and cookieless. We do not run advertising trackers.</p>

      <h2>4. Data processed as processor</h2>
      <p>
        Inside a workspace we process device telemetry (position, speed, ignition, digital inputs,
        power and battery status, CAN data where available), trips, geofence and rule events,
        driver records, maintenance entries, commands sent to devices, and account users. Vehicle
        and device identity is based on the device IMEI. We do not decide what is tracked, which
        vehicles are connected or how long records are kept beyond the platform defaults — the
        customer configures that, and the customer is responsible for informing drivers.
      </p>

      <h2>5. Legal bases</h2>
      <ul>
        <li>Performance of a contract — providing the service, billing, support.</li>
        <li>Legitimate interests — securing the platform, preventing abuse, improving the product, partner attribution.</li>
        <li>Consent — optional cookies and marketing email, withdrawable at any time.</li>
        <li>Legal obligation — accounting and tax records.</li>
      </ul>
      <p>
        Where we act as processor, the legal basis for the underlying processing is determined by
        our customer, not by us.
      </p>

      <h2>6. Cookies and analytics</h2>
      <p>
        We use essential cookies and local storage to run the site and keep you signed in, plus one
        optional partner-referral cookie that is set only if you accept it. Analytics is aggregated
        and cookieless. The full list, durations and how to change your choice are in the{" "}
        <a href="/cookies">Cookie Policy</a>.
      </p>

      <h2>7. Retention</h2>
      <ul>
        <li>Telemetry and event data: <strong>13 months</strong> by default, then deleted.</li>
        <li>
          Trip records are kept longer for your own historical reporting, but their{" "}
          <strong>coordinates are removed at the same 13-month point</strong> — what remains is the
          distance, the times and the driver, with no way back to where the vehicle was.
        </li>
        <li>Account data: for the life of the account, then deleted or anonymised within 90 days.</li>
        <li>Invoices and accounting records: as required by Lithuanian law (currently 10 years).</li>
        <li>Security logs: up to 12 months.</li>
      </ul>

      <h2>8. Hosting and international transfers</h2>
      <p>
        Orbetra runs on infrastructure physically located in the European Union (Hetzner, Germany).
        Geocoding (Photon) and routing (OSRM) are self-hosted by us in the EU. Billing runs through
        Stripe Payments Europe in Ireland, transactional email through Postmark's EU endpoint, and
        DNS, TLS and DDoS protection through Cloudflare with EU-first routing.
      </p>
      <p>
        Two components involve providers outside the EEA. Map tiles in the product are served by
        Mapbox (United States), which receives request metadata such as IP address and the map area
        requested. The basemap on this marketing site is served by CARTO, again request metadata
        only and no customer data. Those transfers rely on the EU Standard Contractual Clauses
        (Commission Implementing Decision (EU) 2021/914) together with a transfer assessment and
        supplementary measures. Fleet telemetry and account data stay in the EU.
      </p>
      <p>
        Regional data-residency <em>entitlements</em> (choosing a specific region) are available on
        Scale and Enterprise plans; EU hosting applies to everyone.
      </p>

      <h2>9. Sub-processors</h2>
      <p>
        A current list is published at <a href="/subprocessors">orbetra.com/subprocessors</a>. We
        give 30 days' notice before adding or replacing a sub-processor, and customers may object
        as described in the <a href="/dpa">DPA</a>. We do not sell personal data, and we do not use
        customer data to train models or for advertising.
      </p>

      <h2>10. Security</h2>
      <p>
        TLS in transit, encryption at rest, role-based access with least privilege, audit logging,
        isolated tenants, and regular backups with tested restores. Single sign-on (SSO) is
        available on Scale and Enterprise plans. Access to production data is limited to the people
        who need it and is logged. The full list of technical and organisational measures is Annex
        II of the <a href="/dpa">DPA</a>.
      </p>

      <h2>11. Personal data breaches</h2>
      <p>
        If a personal data breach affects data for which we are the controller, we notify the
        Lithuanian State Data Protection Inspectorate (VDAI) without undue delay and, where
        feasible, within 72 hours of becoming aware of it (GDPR Art. 33), and we inform affected
        individuals where the breach is likely to result in a high risk to their rights (Art. 34).
        Where we are the processor, we notify the affected customer without undue delay and within
        72 hours of becoming aware, with the information the customer needs for its own
        notification.
      </p>

      <h2>12. Automated decision-making</h2>
      <p>
        We do not carry out automated decision-making that produces legal effects or similarly
        significantly affects individuals (GDPR Art. 22). The platform generates alerts, scores and
        reports from rules that the customer configures — for example speeding or geofence alerts —
        but any decision taken about a driver on the basis of those outputs is made by the customer,
        with human involvement, and is the customer's responsibility. We do not profile website
        visitors for advertising.
      </p>

      <h2>13. Children's data</h2>
      <p>
        Orbetra is a business service sold to organisations. It is not directed at children and we
        do not knowingly collect personal data from anyone under 16. If you believe a child's data
        has reached us, write to <a href="mailto:hello@orbetra.com">hello@orbetra.com</a> and we
        will delete it.
      </p>

      <h2>14. Your rights</h2>
      <p>
        Under the GDPR you can request access, rectification, erasure, restriction and portability,
        object to processing based on legitimate interests, and withdraw consent at any time
        without affecting processing already carried out. Workspace owners can also run
        self-service export and erasure from inside the app.
      </p>
      <p>
        Write to <a href="mailto:hello@orbetra.com">hello@orbetra.com</a>. We answer within{" "}
        <strong>one month</strong> of receiving the request (GDPR Art. 12(3)); if the request is
        complex or you have sent several, we may extend by up to two further months and will tell
        you why within the first month. Requests are free unless they are manifestly unfounded or
        excessive. We may ask for information to confirm your identity, and we use it only for that
        check. If you are an end user of a customer's or reseller's workspace, contact them first —
        they are the controller; if you send the request to us, we will forward it to them without
        undue delay.
      </p>

      <h2>15. Complaints</h2>
      <p>
        If you think we have handled your data badly, tell us first — we would rather fix it. You
        also have the right to lodge a complaint with a supervisory authority. Our lead authority
        is the Lithuanian State Data Protection Inspectorate (Valstybinė duomenų apsaugos
        inspekcija, VDAI), Vilnius, Lithuania —{" "}
        <a href="https://vdai.lrv.lt" rel="noreferrer">vdai.lrv.lt</a>. You may also complain to
        the supervisory authority of the EU country where you live or work, or where the alleged
        infringement took place.
      </p>

      <h2>16. Changes</h2>
      <p>
        We update this policy as the product changes and post the new version here with a revised
        "last updated" date. For material changes affecting customers we also give notice by email.
      </p>
    </LegalPage>
  ),
});
