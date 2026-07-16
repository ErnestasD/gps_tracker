import { createFileRoute } from "@tanstack/react-router";
import { LegalPage } from "@/components/site/LegalPage";

export const Route = createFileRoute("/terms")({
  head: () => ({ meta: [{ title: "Terms of Service — Orbetra" }] }),
  component: () => (
    <LegalPage updated="July 2026" title="Terms of Service" label="— LEGAL">
      <p>TODO-LEGAL: master service agreement, acceptable use, liability caps, term & termination.</p>
      <p>Draft placeholder — do not rely on for contracts.</p>
    </LegalPage>
  ),
});
