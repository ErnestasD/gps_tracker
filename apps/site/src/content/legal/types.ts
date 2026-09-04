import type { Lang } from "@/lib/i18n";

/**
 * Structured long-form content model for the legal + docs pages (W9 i18n follow-up).
 *
 * Long-form prose is a poor fit for flat i18n keys, so each document is authored as an
 * array of blocks whose translatable text is a plain string carrying a tiny, safe inline
 * markup subset — `**bold**`, `` `code` `` and `[text](/path)` links — parsed by
 * LegalContent. That keeps translation a pure prose task (translators/agents edit strings,
 * never JSX) while the shape stays type-enforced across every language: a missing document
 * or block is a typecheck error, exactly like the UI locales.
 */
export interface DocBlock {
  /** section heading (rendered as <h2>) */
  h2?: string;
  /**
   * Stable anchor for this heading, so a product screen can deep-link into the docs.
   *
   * Authored rather than slugified from the text: the heading is translated, and an anchor that
   * changes with the reader's language is a link that works in English and 404s the fragment in
   * Lithuanian. Language-independent by construction.
   */
  id?: string;
  /** paragraph — inline markup allowed */
  p?: string;
  /** bulleted list — each item allows inline markup */
  ul?: string[];
  /** numbered list — each item allows inline markup */
  ol?: string[];
  /** simple table; cells allow inline markup */
  table?: { head: string[]; rows: string[][] };
  /** preformatted code block — NEVER translated (kept byte-identical across languages) */
  code?: string;
}

export interface LegalDoc {
  /** page title (h1) */
  title: string;
  /** the "LAST UPDATED · …" value */
  updated: string;
  /** the small eyebrow label above the title */
  label: string;
  /** optional notice rendered under the title (e.g. the convenience-translation disclaimer) */
  notice?: string;
  blocks: DocBlock[];
}

/** A document available in every offered language (type-enforced — no silent English fallback). */
export type LocalizedDoc = Record<Lang, LegalDoc>;
