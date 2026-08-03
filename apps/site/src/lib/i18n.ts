import i18n from "i18next";
import { useEffect } from "react";
import { initReactI18next } from "react-i18next";

/**
 * Lightweight i18n setup. EN is complete; PL / DE / LT contain the
 * navigation, footer, hero and CTA keys — remaining keys fall back to EN.
 */
export const LANGUAGES = ["en", "pl", "de", "lt"] as const;
export type Lang = (typeof LANGUAGES)[number];

export const LANGUAGE_NAMES: Record<Lang, string> = {
  en: "English",
  pl: "Polski",
  de: "Deutsch",
  lt: "Lietuvių",
};

const en = {
  nav: {
    platform: "Platform",
    pricing: "Pricing",
    resellers: "Resellers",
    partners: "Partners",
    contact: "Contact",
    docs: "Docs",
    demo: "Live demo",
    menu: "Menu",
  },
  cta: {
    trial: "Start free trial",
    signin: "Sign in",
    pricing: "See pricing",
    whitelabel: "White-label it",
  },
  hero: {
    eyebrow: "Teltonika GPS · for fleets & resellers · EU-hosted",
    title1: "Know where every van is.",
    title2: "Down to the minute.",
    sub: "Live map, trip history, idle & speeding alerts, driver reports. Plug in your Teltonika device, open the dashboard on your phone, done — no IT team required. Running a tracking business? White-label the whole platform under your brand.",
    trial: "30-day free trial",
    nocard: "No card required",
    cancel: "Cancel anytime",
  },
  tracks: {
    label: "— TWO WAYS TO USE ORBETRA",
    ownTitle: "Run your own fleet",
    ownBody: "1–100 vehicles, Orbetra-branded, self-serve. Live map, trips, geofences, alerts and reports from day one.",
    resellTitle: "Resell it as your own",
    resellBody: "Uncapped devices under your brand and domain, sub-accounts per customer, shadow-mode migration from your current platform.",
    resellCta: "White-label platform",
  },
  footer: {
    product: "Product",
    legal: "Legal",
    language: "Language",
    tagline: "GPS tracking for small fleets and for resellers who white-label it. EU-hosted. Runs on Teltonika.",
  },
};

type Deep = { [k: string]: string | Deep };

const pl: Deep = {
  nav: { platform: "Platforma", pricing: "Cennik", resellers: "Resellerzy", partners: "Partnerzy", contact: "Kontakt", docs: "Dokumentacja", demo: "Demo na żywo", menu: "Menu" },
  cta: { trial: "Rozpocznij darmowy okres", signin: "Zaloguj się", pricing: "Zobacz cennik", whitelabel: "White-label" },
  hero: {
    eyebrow: "Teltonika GPS · dla flot i resellerów · hosting w UE",
    title1: "Wiedz, gdzie jest każdy pojazd.",
    title2: "Co do minuty.",
    sub: "Mapa na żywo, historia tras, alerty postoju i prędkości, raporty kierowców. Podłącz urządzenie Teltonika i otwórz panel na telefonie — bez działu IT. Prowadzisz firmę GPS? Sprzedawaj całą platformę pod własną marką.",
    trial: "30 dni za darmo", nocard: "Bez karty", cancel: "Anuluj kiedy chcesz",
  },
  footer: { product: "Produkt", legal: "Informacje prawne", language: "Język", tagline: "Monitoring GPS dla małych flot i dla resellerów w modelu white-label. Hosting w UE. Działa na Teltonika." },
};

const de: Deep = {
  nav: { platform: "Plattform", pricing: "Preise", resellers: "Reseller", partners: "Partner", contact: "Kontakt", docs: "Doku", demo: "Live-Demo", menu: "Menü" },
  cta: { trial: "Kostenlos testen", signin: "Anmelden", pricing: "Preise ansehen", whitelabel: "White-Label" },
  hero: {
    eyebrow: "Teltonika GPS · für Flotten & Reseller · EU-gehostet",
    title1: "Wissen, wo jeder Transporter ist.",
    title2: "Auf die Minute genau.",
    sub: "Live-Karte, Fahrtenhistorie, Leerlauf- und Tempowarnungen, Fahrerberichte. Teltonika-Gerät anschließen, Dashboard am Handy öffnen — ohne IT-Team. Sie verkaufen Tracking? White-Labeln Sie die ganze Plattform unter Ihrer Marke.",
    trial: "30 Tage kostenlos", nocard: "Keine Karte nötig", cancel: "Jederzeit kündbar",
  },
  footer: { product: "Produkt", legal: "Rechtliches", language: "Sprache", tagline: "GPS-Ortung für kleine Flotten und für Reseller im White-Label. EU-gehostet. Läuft auf Teltonika." },
};

const lt: Deep = {
  nav: { platform: "Platforma", pricing: "Kainos", resellers: "Perpardavėjams", partners: "Partneriai", contact: "Kontaktai", docs: "Dokumentacija", demo: "Gyva demo", menu: "Meniu" },
  cta: { trial: "Pradėti nemokamai", signin: "Prisijungti", pricing: "Žiūrėti kainas", whitelabel: "White-label" },
  hero: {
    eyebrow: "Teltonika GPS · autoparkams ir perpardavėjams · ES serveriai",
    title1: "Žinok, kur kiekvienas mikroautobusas.",
    title2: "Minutės tikslumu.",
    sub: "Gyvas žemėlapis, kelionių istorija, prastovų ir greičio pranešimai, vairuotojų ataskaitos. Prijunk Teltonika įrenginį, atidaryk skydelį telefone — IT komandos nereikia. Turi GPS verslą? Perparduok visą platformą su savo prekės ženklu.",
    trial: "30 d. nemokamai", nocard: "Kortelės nereikia", cancel: "Atšauk bet kada",
  },
  footer: { product: "Produktas", legal: "Teisinė info", language: "Kalba", tagline: "GPS sekimas mažiems autoparkams ir perpardavėjams su white-label. ES serveriai. Veikia su Teltonika." },
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
      en: { translation: en },
      pl: { translation: pl },
      de: { translation: de },
      lt: { translation: lt },
    },
    // Always start in EN so SSR markup and the first client render match.
    // The stored / browser language is applied after hydration.
    lng: "en",
    fallbackLng: "en",
    interpolation: { escapeValue: false },
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
