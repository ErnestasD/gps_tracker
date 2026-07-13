import { createFileRoute } from "@tanstack/react-router";
import { LegalPage } from "@/components/site/LegalPage";

export const Route = createFileRoute("/subprocessors")({
  head: () => ({ meta: [{ title: "Subprocessors — Orbetra" }] }),
  component: () => (
    <LegalPage updated="July 2026" title="Subprocessors" label="— LEGAL">
      <p>TODO-LEGAL: current list of subprocessors, location, purpose. Updated on change with 30-day notice.</p>
    </LegalPage>
  ),
});
