import { createFileRoute } from "@tanstack/react-router";
import { LocalizedLegalPage } from "@/components/site/LegalContent";
import { impressum } from "@/content/legal/impressum";

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
  component: () => <LocalizedLegalPage doc={impressum} />,
});
