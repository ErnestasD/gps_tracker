import { createFileRoute } from "@tanstack/react-router";
import { Suspense, lazy } from "react";

/**
 * The knowledge-base index route.
 *
 * A route module is EAGER — its `head` is resolved before anything renders, so whatever it imports
 * at module scope lands in the site's main bundle. The page itself reads every article in four
 * languages, so it is lazily loaded and nothing but this shell ships to a visitor who never opens
 * the knowledge base.
 */
const LearnIndexPage = lazy(() => import("@/components/site/LearnIndex"));

export const Route = createFileRoute("/learn/")({
  head: () => ({
    meta: [
      { title: "Knowledge base — Orbetra" },
      {
        name: "description",
        content:
          "Plain-language guides to GPS fleet tracking: trackers and SIM cards, the live map, trips, geofences and alerts, reports, billing, white-label and the API.",
      },
      { property: "og:title", content: "Knowledge base — Orbetra" },
      { property: "og:type", content: "website" },
    ],
  }),
  component: () => (
    <Suspense fallback={null}>
      <LearnIndexPage />
    </Suspense>
  ),
});
