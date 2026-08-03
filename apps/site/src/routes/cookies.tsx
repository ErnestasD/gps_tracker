import { createFileRoute, Link } from "@tanstack/react-router";
import { useConsent } from "@/lib/consent";

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

const COOKIES = [
  { name: "orbetra_cookie_consent", type: "Essential", purpose: "Stores your cookie choice so we don't ask again.", duration: "12 months (local storage)" },
  { name: "orbetra_lang", type: "Essential", purpose: "Remembers your interface language (EN/PL/DE/LT).", duration: "12 months (local storage)" },
  { name: "session", type: "Essential", purpose: "Keeps you signed in to the Orbetra app.", duration: "Session / 30 days if you stay signed in" },
  { name: "tc_ref", type: "Optional", purpose: "Credits a partner referral when you arrive via a ?ref= link. Only set if you accept.", duration: "60 days" },
];

function CookiesPage() {
  const { choice, setChoice } = useConsent();
  return (
    <article className="mx-auto max-w-3xl px-6 pt-20 md:pt-28 pb-24">
      <div className="section-label">
        <span className="h-[1px] w-6 bg-[var(--brand-blue)]" />
        — LEGAL
      </div>
      <h1 className="display text-4xl md:text-5xl font-bold mt-4 text-ink">Cookie Policy</h1>
      <p className="mono text-xs tracking-widest text-muted-foreground mt-2">LAST UPDATED · AUGUST 2026</p>

      <p className="mt-8 text-ink/80">
        Orbetra uses minimal cookies: essential ones needed to run the site and the app, and one
        optional cookie that credits a partner referral. Our product analytics is cookieless and
        aggregated — we do not run advertising or cross-site tracking cookies.
      </p>

      <div className="mt-10 surface-card overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
              <th className="text-left px-4 py-3">Name</th>
              <th className="text-left px-4 py-3">Type</th>
              <th className="text-left px-4 py-3">Purpose</th>
              <th className="text-left px-4 py-3">Duration</th>
            </tr>
          </thead>
          <tbody>
            {COOKIES.map((c) => (
              <tr key={c.name} className="border-t border-[var(--hairline)]">
                <td className="px-4 py-3 mono text-[12px] text-ink">{c.name}</td>
                <td className="px-4 py-3 text-muted-foreground">{c.type}</td>
                <td className="px-4 py-3 text-ink/80">{c.purpose}</td>
                <td className="px-4 py-3 text-muted-foreground">{c.duration}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <h2 className="display text-2xl font-bold text-ink mt-12">Your choice</h2>
      <p className="mt-3 text-ink/80">
        Current setting:{" "}
        <span className="mono text-[color:var(--brand-cyan)]">
          {choice === "accepted" ? "All cookies accepted" : choice === "essential" ? "Essential only" : "Not set"}
        </span>
      </p>
      <div className="mt-5 flex flex-wrap gap-3">
        <button onClick={() => setChoice("accepted")} className="pill-primary hover:pill-primary-hover cursor-pointer">
          Accept all
        </button>
        <button onClick={() => setChoice("essential")} className="pill-ghost cursor-pointer">
          Essential only
        </button>
      </div>

      <p className="mt-10 text-sm text-muted-foreground">
        Questions? Write to{" "}
        <a href="mailto:hello@orbetra.com" className="text-[color:var(--brand-cyan)] hover:underline">hello@orbetra.com</a>{" "}
        or read our <Link to="/privacy" className="text-[color:var(--brand-cyan)] hover:underline">Privacy Policy</Link>.
      </p>
    </article>
  );
}
