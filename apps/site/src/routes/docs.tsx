import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowRight } from "lucide-react";
import { useTranslation } from "react-i18next";

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
  component: DocsPage,
});

function DocsPage() {
  return <LocalizedLegalPage doc={docs} after={<KnowledgeBaseFooter />} />;
}

/**
 * The other half of the documentation.
 *
 * This page answers "how do I call the API"; most people arriving at a tracking product are asking
 * "what is an APN" and have no reason to guess that the answer lives somewhere else.
 */
function KnowledgeBaseFooter() {
  const { t } = useTranslation();
  return (
    <div className="surface-card mt-12 px-5 py-5">
      <p className="text-ink/80">{t("learn.docsIntro")}</p>
      <Link to="/learn" className="mt-4 inline-flex items-center gap-1.5 text-[var(--brand-blue)] underline-offset-2 hover:underline">
        {t("learn.nav")} <ArrowRight className="h-3.5 w-3.5" aria-hidden />
      </Link>
    </div>
  );
}
