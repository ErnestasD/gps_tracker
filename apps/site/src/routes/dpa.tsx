import { createFileRoute } from "@tanstack/react-router";
import { LegalPage } from "@/components/site/LegalPage";

export const Route = createFileRoute("/dpa")({
  head: () => ({ meta: [{ title: "Data Processing Addendum — Orbetra" }] }),
  component: () => (
    <LegalPage updated="July 2026" title="Data Processing Addendum" label="— LEGAL">
      <p>TODO-LEGAL: controller/processor roles, sub-processors, SCCs, security measures (Annex II).</p>
    </LegalPage>
  ),
});
