import { createFileRoute } from "@tanstack/react-router";
import { LocalizedLegalPage } from "@/components/site/LegalContent";
import { docs } from "@/content/legal/docs";

export const Route = createFileRoute("/docs")({
  head: () => ({
    meta: [
      { title: "Docs & API Reference — Orbetra" },
      {
        name: "description",
        content:
          "Orbetra developer docs: authentication, devices, positions, trips and webhooks. REST endpoints, examples and hardware onboarding for supported trackers.",
      },
      { property: "og:title", content: "Docs & API Reference — Orbetra" },
      {
        property: "og:description",
        content: "REST API reference, authentication, webhooks and device onboarding for Orbetra.",
      },
      { property: "og:type", content: "article" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: () => <LocalizedLegalPage doc={docs} />,
});
