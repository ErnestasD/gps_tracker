import {
  KB_CATEGORIES,
  articlesByCategory,
  searchArticles,
  visibleArticles,
  type KbArticle,
  type KbCategoryId,
  type KbLang,
} from "@orbetra/kb";
import { KB_ARTICLES } from "@orbetra/kb/content";

import { useActiveLang } from "@/components/site/LegalContent";

/**
 * The knowledge base as the PUBLIC site sees it.
 *
 * The site is always our own brand and has no plan, no role and no tenant, so the audience gates
 * that matter inside the dashboard do not apply here — a visitor is allowed to read about
 * white-label and the API before buying either. `visibleArticles` still runs, because an article
 * may be authored for the app only, and that decision belongs to the content, not to this file.
 */
export const SITE_ARTICLES: readonly KbArticle[] = visibleArticles(KB_ARTICLES, { surface: "site" });

export const SITE_GROUPS = articlesByCategory(SITE_ARTICLES);

export function categoryMeta(id: KbCategoryId) {
  return KB_CATEGORIES.find((c) => c.id === id)!;
}

export function findArticle(slug: string): KbArticle | undefined {
  return SITE_ARTICLES.find((a) => a.slug === slug);
}

/** Previous and next in reading order — the spine that turns a pile of pages into a manual. */
export function neighbours(slug: string): { prev?: KbArticle; next?: KbArticle } {
  const i = SITE_ARTICLES.findIndex((a) => a.slug === slug);
  if (i < 0) return {};
  return { prev: SITE_ARTICLES[i - 1], next: SITE_ARTICLES[i + 1] };
}

/** The other articles on the same shelf, minus this one. */
export function related(article: KbArticle): KbArticle[] {
  return SITE_ARTICLES.filter((a) => a.category === article.category && a.slug !== article.slug);
}

export function search(lang: KbLang, query: string): KbArticle[] {
  return searchArticles(SITE_ARTICLES, lang, query);
}

/** The reader's language, subscribed to the configured i18n instance (see LegalContent). */
export { useActiveLang as useKbLang };
