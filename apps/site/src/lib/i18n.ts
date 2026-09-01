import i18n from "i18next";
import { useEffect } from "react";
import { initReactI18next } from "react-i18next";

import { en } from "./locales/en";
import { pl } from "./locales/pl";
import { de } from "./locales/de";
import { lt } from "./locales/lt";
// the REAL dashboard's translations (copied from apps/web/src/i18n) — the demo admin speaks
// the product's own strings in every language the product supports
import adminEn from "./admin-locales/en.json";
import adminPl from "./admin-locales/pl.json";
import adminDe from "./admin-locales/de.json";
import adminLt from "./admin-locales/lt.json";

/**
 * i18n for the marketing surfaces. EN is the source of truth (`locales/en.ts`);
 * pl/de/lt are typed against it, so a missing key is a typecheck error rather
 * than a silent English fallback at runtime.
 */
export const LANGUAGES = ["en", "pl", "de", "lt"] as const;
export type Lang = (typeof LANGUAGES)[number];

export const LANGUAGE_NAMES: Record<Lang, string> = {
  en: "English",
  pl: "Polski",
  de: "Deutsch",
  lt: "Lietuvių",
};

function detectLang(): Lang {
  if (typeof window === "undefined") return "en";
  try {
    const stored = window.localStorage.getItem("orbetra_lang") as Lang | null;
    if (stored && LANGUAGES.includes(stored)) return stored;
  } catch {
    /* ignore */
  }
  const nav = (navigator.language || "en").slice(0, 2).toLowerCase() as Lang;
  return LANGUAGES.includes(nav) ? nav : "en";
}

if (!i18n.isInitialized) {
  void i18n.use(initReactI18next).init({
    resources: {
      en: { translation: en, admin: adminEn },
      pl: { translation: pl, admin: adminPl },
      de: { translation: de, admin: adminDe },
      lt: { translation: lt, admin: adminLt },
    },
    // Always start in EN so SSR markup and the first client render match.
    // The stored / browser language is applied after hydration.
    // Resolve the stored / browser language SYNCHRONOUSLY at init so the very first render is
    // already correct. Pure client SPA (createRoot, no SSR/prerender) — there is no server markup
    // to match, and deferring the switch to a post-mount effect races component subscriptions:
    // the header updated while the hero/footer/long-form content stayed English ("half-English").
    lng: detectLang(),
    fallbackLng: "en",
    interpolation: {
      escapeValue: false,
      // `{{name, lowercase}}` lets EN keep its sentence-case-free phrasing
      // ("Discover delivery & courier") while PL/DE/LT keep proper capitalisation.
      format: (value: unknown, format?: string) =>
        format === "lowercase" && typeof value === "string" ? value.toLowerCase() : String(value),
    },
    react: { useSuspense: false },
  });
}

/** Applies the stored / browser language after hydration (avoids SSR mismatch). */
export function useLanguageBootstrap() {
  useEffect(() => {
    const lang = detectLang();
    if (lang !== i18n.resolvedLanguage) void i18n.changeLanguage(lang);
  }, []);
}

export function setLanguage(lang: Lang) {
  void i18n.changeLanguage(lang);
  try {
    window.localStorage.setItem("orbetra_lang", lang);
  } catch {
    /* ignore */
  }
}

export default i18n;
