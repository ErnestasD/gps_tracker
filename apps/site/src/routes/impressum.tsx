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
    <LegalPage updated="August 2026" title="Impressum" label="— LEGAL (§5 TMG)">
      <p><strong>Provider / Anbieter:</strong> MB Dokigo, trading as Orbetra</p>
      <p>Krivių g. 5, LT-01204 Vilnius, Lithuania</p>
      <p><strong>Company code / Register-Nr.:</strong> 307575857</p>
      <p><strong>Represented by / Vertretungsberechtigt:</strong> Ernestas Dubovskich, Director</p>
      <p><strong>Contact:</strong> <a href="mailto:hello@orbetra.com">hello@orbetra.com</a></p>
      <p><strong>Responsible for content (§18 (2) MStV):</strong> Ernestas Dubovskich, address as above.</p>
      <h2>Dispute resolution</h2>
      <p>
        The European Commission provides a platform for online dispute resolution at
        {" "}<a href="https://ec.europa.eu/consumers/odr" rel="noreferrer">ec.europa.eu/consumers/odr</a>.
        We are not obliged and not willing to participate in dispute resolution proceedings
        before a consumer arbitration board.
      </p>
      <h2>Liability for links</h2>
      <p>
        Our site contains links to external websites over whose content we have no control.
        Responsibility for the content of linked pages always lies with their respective
        operator.
      </p>
    </LegalPage>
  ),
});
