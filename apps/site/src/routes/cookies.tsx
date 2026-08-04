import { createFileRoute, Link } from "@tanstack/react-router";
import { LegalPage } from "@/components/site/LegalPage";
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
  { name: "orbetra_cookie_consent", type: "Essential", purpose: "Stores your cookie choice so we don't ask again.", duration: "Local storage — until you change it or clear site data" },
  { name: "orbetra_lang", type: "Essential", purpose: "Remembers your interface language (EN/PL/DE/LT).", duration: "Local storage — until you change it or clear site data" },
  { name: "orb_refresh", type: "Essential", purpose: "Keeps you signed in to the Orbetra app. HttpOnly and SameSite=Strict, and sent only to the authentication endpoint — never with map or data requests.", duration: "14 days, renewed while you stay signed in" },
  { name: "tc_ref", type: "Optional", purpose: "Credits a partner referral when you arrive via a ?ref= link. Set only if you accept, and deleted if you choose essential only.", duration: "60 days" },
  { name: "tc_ref_pending", type: "Optional", purpose: "Holds a referral code from a ?ref= link until you answer the banner, so the referral is not lost while you decide. Discarded if you choose essential only.", duration: "Session storage — cleared when you close the tab" },
];

function CookiesPage() {
  const { choice, setChoice } = useConsent();
  return (
    <LegalPage updated="August 2026" title="Cookie Policy" label="— LEGAL">
      <p>
        Orbetra uses minimal cookies: essential ones needed to run the site and the app, and one
        optional cookie that credits a partner referral. Our product analytics is cookieless and
        aggregated — we do not run advertising or cross-site tracking cookies.
      </p>

      <h2>1. What cookies are</h2>
      <p>
        A cookie is a small file a site stores in your browser and reads back on later requests.
        Local storage and session storage do the same job with a different browser API, and the same
        rules apply — so we list all three below. Cookies that are strictly necessary to deliver a
        service you asked for do not need consent; anything else does, and we ask for it before
        setting it.
      </p>

      <h2>2. What we set</h2>
      <div className="not-prose mt-6 surface-card overflow-x-auto">
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
      <p className="mt-6">
        The optional <code>tc_ref</code> cookie is the only non-essential item. It is written only
        after you choose "Accept all", it holds nothing but the partner code from the{" "}
        <code>?ref=</code> link, and choosing "Essential only" deletes it.
      </p>

      <h2>3. Analytics</h2>
      <p>
        Our website analytics is aggregated and cookieless: it counts page views and referrers
        without storing anything in your browser and without building a profile of you. We do not
        use Google Analytics, advertising pixels, or cross-site trackers, and we do not sell or
        share visitor data.
      </p>

      <h2>4. Third-party requests from maps</h2>
      <p>
        Map tiles are loaded from Mapbox in the product and from CARTO on this marketing site.
        Loading a tile is a normal web request, so those providers receive technical metadata — your
        IP address, browser user agent and the map area requested. We do not send them your account
        details or your fleet data, and neither provider is used to track you across sites. See the{" "}
        <a href="/privacy">Privacy Policy</a> for the transfer safeguards that apply.
      </p>

      <h2>5. Your choice</h2>
      <p>
        You can change your decision at any time, here or from the banner. Withdrawing consent is
        as easy as giving it: choosing "Essential only" deletes the referral cookie immediately.
      </p>
      <p>
        Current setting:{" "}
        <span className="mono text-[color:var(--brand-cyan)]">
          {choice === "accepted" ? "All cookies accepted" : choice === "essential" ? "Essential only" : "Not set"}
        </span>
      </p>
      <div className="not-prose mt-5 flex flex-wrap gap-3">
        <button onClick={() => setChoice("accepted")} className="pill-primary hover:pill-primary-hover cursor-pointer">
          Accept all
        </button>
        <button onClick={() => setChoice("essential")} className="pill-ghost cursor-pointer">
          Essential only
        </button>
      </div>
      <p className="mt-6">
        Your browser can also block or delete cookies and clear local storage for a site — the
        settings live under Privacy or Site data in Chrome, Firefox, Safari and Edge. Blocking
        essential items will sign you out of the app and reset your language choice.
      </p>

      <h2>6. Changes and contact</h2>
      <p>
        If we add or change a cookie we update this page, and we ask for consent again if the change
        affects a non-essential one. Questions go to{" "}
        <a href="mailto:hello@orbetra.com">hello@orbetra.com</a>. How we handle personal data more
        generally is described in the{" "}
        <Link to="/privacy">Privacy Policy</Link>.
      </p>
    </LegalPage>
  );
}
