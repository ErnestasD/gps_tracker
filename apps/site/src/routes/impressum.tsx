import { createFileRoute } from "@tanstack/react-router";
import { LegalPage } from "@/components/site/LegalPage";

export const Route = createFileRoute("/impressum")({
  head: () => ({ meta: [{ title: "Impressum — Orbetra" }] }),
  component: () => (
    <LegalPage updated="July 2026" title="Impressum" label="COMPANY INFORMATION">
      <p>
        <strong>Orbetra</strong> is a product operated by <strong>MB Dokigo</strong>, a limited liability
        company (mažoji bendrija) registered in Lithuania. Orbetra is the trading/brand name; MB Dokigo is
        the legal entity that owns and operates the platform and the orbetra.com domain.
      </p>
      <p>
        <strong>MB Dokigo</strong>
        <br />
        Krivių g. 5, LT-01204 Vilnius, Lithuania
        <br />
        Company code (įmonės kodas): 307575857
        <br />
        Register: Register of Legal Entities of the Republic of Lithuania (Registrų centras)
        <br />
        Represented by: Ernestas Dubovskich (Director)
      </p>
      <p>
        Contact: <a href="mailto:hello@orbetra.com">hello@orbetra.com</a>
      </p>
    </LegalPage>
  ),
});
