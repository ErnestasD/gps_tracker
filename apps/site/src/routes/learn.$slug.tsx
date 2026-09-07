import { createFileRoute } from "@tanstack/react-router";
import { Suspense, lazy } from "react";

import { metaBySlug } from "@orbetra/kb";

/**
 * One knowledge-base article.
 *
 * The page is lazily loaded — it reads every article, in four languages — but the TITLE and
 * DESCRIPTION cannot be: a search engine, a chat preview and a shared link all read them before
 * anything renders. They come from the content package's METADATA, which is titles and summaries
 * only and is cheap enough to sit in the eager bundle. A generic "Knowledge base" on fifty pages
 * is fifty pages that look identical from outside.
 *
 * EN, deliberately: the head is resolved at navigation, before i18n has necessarily settled on the
 * reader's language, and a stale title is worse than an English one. The BODY is fully localised.
 */
const ArticlePage = lazy(() => import("@/components/site/LearnArticle"));

export const Route = createFileRoute("/learn/$slug")({
  head: ({ params }) => {
    const meta = metaBySlug(params.slug);
    if (meta === undefined) return {};
    return {
      meta: [
        { title: `${meta.title.en} — Orbetra` },
        { name: "description", content: meta.summary.en },
        { property: "og:title", content: meta.title.en },
        { property: "og:description", content: meta.summary.en },
        { property: "og:type", content: "article" },
        { name: "twitter:card", content: "summary" },
      ],
    };
  },
  component: function ArticleRoute() {
    const { slug } = Route.useParams();
    return (
      <Suspense fallback={null}>
        <ArticlePage slug={slug} />
      </Suspense>
    );
  },
});
