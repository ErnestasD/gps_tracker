import { createFileRoute } from "@tanstack/react-router";
import { LegalPage } from "@/components/site/LegalPage";

export const Route = createFileRoute("/impressum")({
  head: () => ({
    meta: [
      { title: "Impressum — Orbetra" },
      { name: "description", content: "Legal provider information for Orbetra: MB Dokigo, Krivių g. 5, LT-01204 Vilnius, Lithuania." },
      { property: "og:title", content: "Impressum — Orbetra" },
      { property: "og:description", content: "Provider information for Orbetra (MB Dokigo, Vilnius, Lithuania)." },
      { property: "og:type", content: "article" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: () => (
    <LegalPage updated="August 2026" title="Impressum" label="— LEGAL (§5 DDG)">
      <p>
        Provider information under §5 DDG (formerly §5 TMG) and Art. 5 of the EU e-Commerce
        Directive.
      </p>

      <h2>1. Provider</h2>
      <ul>
        <li><strong>Legal name / Anbieter:</strong> MB Dokigo</li>
        <li><strong>Legal form:</strong> mažoji bendrija (small partnership) under Lithuanian law</li>
        <li><strong>Registered address:</strong> Krivių g. 5, LT-01204 Vilnius, Lithuania</li>
        <li><strong>Company code / Register-Nr.:</strong> 307575857</li>
        <li><strong>Register:</strong> Register of Legal Entities of the Republic of Lithuania (Juridinių asmenų registras), maintained by the State Enterprise Centre of Registers</li>
        <li><strong>Represented by / Vertretungsberechtigt:</strong> Ernestas Dubovskich, Director</li>
        <li><strong>Contact:</strong> <a href="mailto:hello@orbetra.com">hello@orbetra.com</a></li>
        <li><strong>Responsible for content (§18 (2) MStV):</strong> Ernestas Dubovskich, address as above</li>
      </ul>
      <p><strong>Orbetra</strong> is a product and brand of MB Dokigo.</p>

      <h2>2. VAT</h2>
      <p>
        Prices published on this site exclude VAT. Where MB Dokigo is registered for VAT, the VAT
        identification number is shown on the invoice; EU business customers who supply a valid VAT
        number are invoiced under the reverse-charge mechanism where it applies.
      </p>

      <h2>3. Data protection</h2>
      <p>
        How we handle personal data is described in the <a href="/privacy">Privacy Policy</a>, the{" "}
        <a href="/cookies">Cookie Policy</a> and, for customer data, the{" "}
        <a href="/dpa">Data Processing Addendum</a>. We have not appointed a data protection
        officer; privacy requests go to{" "}
        <a href="mailto:hello@orbetra.com">hello@orbetra.com</a>. The competent supervisory
        authority is the Lithuanian State Data Protection Inspectorate (Valstybinė duomenų apsaugos
        inspekcija, VDAI), Vilnius.
      </p>

      <h2>4. Dispute resolution</h2>
      <p>
        Orbetra is sold to businesses and other organisations, not to consumers. We are not obliged
        and not willing to participate in dispute resolution proceedings before a consumer
        arbitration board. Contractual disputes are governed by the{" "}
        <a href="/terms">Terms of Service</a>: Lithuanian law, courts of Vilnius. Please write to{" "}
        <a href="mailto:hello@orbetra.com">hello@orbetra.com</a> first — most things are faster to
        fix directly.
      </p>

      <h2>5. Liability for content and links</h2>
      <p>
        We prepare the content of this site with care, but we give no warranty that it is complete
        or current, and product descriptions are not binding offers. Our site contains links to
        external websites over whose content we have no control. Responsibility for the content of
        linked pages always lies with their respective operator; if we become aware of an
        infringement we remove the link.
      </p>
    </LegalPage>
  ),
});
