import { createFileRoute } from "@tanstack/react-router";
import { LocalizedLegalPage } from "@/components/site/LegalContent";
import { dpa } from "@/content/legal/dpa";

export const Route = createFileRoute("/dpa")({
  head: () => ({
    meta: [
      { title: "Data Processing Addendum — Orbetra" },
      { name: "description", content: "Orbetra's DPA: controller and processor roles, processing scope, security measures, sub-processors, transfers and data-subject requests." },
      { property: "og:title", content: "Data Processing Addendum — Orbetra" },
      { property: "og:description", content: "Roles, scope, security measures, sub-processors and transfers." },
      { property: "og:type", content: "article" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: () => <LocalizedLegalPage doc={dpa} />,
});
