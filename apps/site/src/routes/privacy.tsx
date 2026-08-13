import { createFileRoute } from "@tanstack/react-router";
import { LocalizedLegalPage } from "@/components/site/LegalContent";
import { privacy } from "@/content/legal/privacy";

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
  component: () => <LocalizedLegalPage doc={privacy} />,
});
