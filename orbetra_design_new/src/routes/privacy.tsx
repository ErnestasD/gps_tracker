import { createFileRoute } from "@tanstack/react-router";
import { LegalPage } from "@/components/site/LegalPage";

export const Route = createFileRoute("/privacy")({
  head: () => ({ meta: [{ title: "Privacy Policy — Orbetra" }] }),
  component: () => (
    <LegalPage updated="July 2026" title="Privacy Policy" label="— LEGAL">
      <p>TODO-LEGAL: data collected, lawful basis, retention, rights under GDPR, contact for DPO.</p>
    </LegalPage>
  ),
});
