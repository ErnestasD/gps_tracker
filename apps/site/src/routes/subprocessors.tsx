import { createFileRoute } from "@tanstack/react-router";
import { LocalizedLegalPage } from "@/components/site/LegalContent";
import { subprocessors } from "@/content/legal/subprocessors";

export const Route = createFileRoute("/subprocessors")({
  head: () => ({
    meta: [
      { title: "Subprocessors — Orbetra" },
      { name: "description", content: "Current list of Orbetra sub-processors, what they do, where they process data, and our 30-day change notice." },
      { property: "og:title", content: "Subprocessors — Orbetra" },
      { property: "og:description", content: "Who we use, for what, and where data is processed." },
      { property: "og:type", content: "article" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: () => <LocalizedLegalPage doc={subprocessors} />,
});
