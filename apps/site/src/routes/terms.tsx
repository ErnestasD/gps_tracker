import { createFileRoute } from "@tanstack/react-router";
import { LocalizedLegalPage } from "@/components/site/LegalContent";
import { terms } from "@/content/legal/terms";

export const Route = createFileRoute("/terms")({
  head: () => ({
    meta: [
      { title: "Terms of Service — Orbetra" },
      { name: "description", content: "Orbetra terms of service: subscriptions, trials, acceptable use, uptime commitments, liability and termination." },
      { property: "og:title", content: "Terms of Service — Orbetra" },
      { property: "og:description", content: "Subscriptions, trials, acceptable use, uptime, liability and termination." },
      { property: "og:type", content: "article" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: () => <LocalizedLegalPage doc={terms} />,
});
