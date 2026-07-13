import { createFileRoute } from "@tanstack/react-router";
import { LegalPage } from "@/components/site/LegalPage";

export const Route = createFileRoute("/impressum")({
  head: () => ({ meta: [{ title: "Impressum — Orbetra" }] }),
  component: () => (
    <LegalPage updated="July 2026" title="Impressum" label="— LEGAL (§5 TMG)">
      <p>TODO-LEGAL: Anbieter (Company legal name)</p>
      <p>Address line 1, Address line 2, City, Country</p>
      <p>Handelsregister / Register-Nr.: TODO</p>
      <p>Vertretungsberechtigt: TODO</p>
      <p>Kontakt: hello@orbetra.eu</p>
      <p>USt-IdNr.: TODO</p>
    </LegalPage>
  ),
});
