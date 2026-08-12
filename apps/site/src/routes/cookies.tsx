import { createFileRoute } from "@tanstack/react-router";
import { LocalizedLegalPage, useActiveLang } from "@/components/site/LegalContent";
import { cookies } from "@/content/legal/cookies";
import { useConsent } from "@/lib/consent";
import type { Lang } from "@/lib/i18n";

export const Route = createFileRoute("/cookies")({
  head: () => ({
    meta: [
      { title: "Cookie Policy — Orbetra" },
      { name: "description", content: "Which cookies Orbetra sets, why, and how long they last. Essential cookies only, plus one optional partner-referral cookie. Analytics is cookieless." },
      { property: "og:title", content: "Cookie Policy — Orbetra" },
      { property: "og:description", content: "Essential cookies only, plus one optional partner-referral cookie." },
      { property: "og:type", content: "article" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: CookiesPage,
});

/** Localized labels for the interactive consent control on this page (the prose is in the doc). */
const UI: Record<Lang, { heading: string; current: string; accepted: string; essential: string; notset: string; acceptBtn: string; essentialBtn: string }> = {
  en: { heading: "Your current choice", current: "Current setting:", accepted: "All cookies accepted", essential: "Essential only", notset: "Not set", acceptBtn: "Accept all", essentialBtn: "Essential only" },
  lt: { heading: "Jūsų dabartinis pasirinkimas", current: "Dabartinis nustatymas:", accepted: "Priimti visi slapukai", essential: "Tik būtinieji", notset: "Nenustatyta", acceptBtn: "Priimti visus", essentialBtn: "Tik būtinieji" },
  pl: { heading: "Twój bieżący wybór", current: "Bieżące ustawienie:", accepted: "Zaakceptowano wszystkie pliki cookie", essential: "Tylko niezbędne", notset: "Nie ustawiono", acceptBtn: "Zaakceptuj wszystkie", essentialBtn: "Tylko niezbędne" },
  de: { heading: "Ihre aktuelle Auswahl", current: "Aktuelle Einstellung:", accepted: "Alle Cookies akzeptiert", essential: "Nur notwendige", notset: "Nicht festgelegt", acceptBtn: "Alle akzeptieren", essentialBtn: "Nur notwendige" },
};

function CookiesPage() {
  const lang = useActiveLang();
  const { choice, setChoice } = useConsent();
  const ui = UI[lang];
  const status = choice === "accepted" ? ui.accepted : choice === "essential" ? ui.essential : ui.notset;
  return (
    <LocalizedLegalPage
      doc={cookies}
      after={
        <div className="not-prose mt-8 rounded-lg border border-[var(--hairline)] bg-[rgba(10,20,40,0.4)] p-5">
          <div className="text-sm font-semibold text-ink">{ui.heading}</div>
          <p className="mt-1 text-sm text-muted-foreground">
            {ui.current} <span className="mono text-[color:var(--brand-cyan)]">{status}</span>
          </p>
          <div className="mt-4 flex flex-wrap gap-3">
            <button onClick={() => setChoice("accepted")} className="pill-primary hover:pill-primary-hover cursor-pointer">
              {ui.acceptBtn}
            </button>
            <button onClick={() => setChoice("essential")} className="pill-ghost cursor-pointer">
              {ui.essentialBtn}
            </button>
          </div>
        </div>
      }
    />
  );
}
