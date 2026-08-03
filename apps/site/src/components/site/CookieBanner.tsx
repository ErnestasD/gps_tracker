import { useConsent } from "@/lib/consent";
import { Link } from "@tanstack/react-router";

export function CookieBanner() {
  const { bannerOpen, setChoice } = useConsent();
  if (!bannerOpen) return null;

  return (
    <div className="fixed inset-x-0 bottom-0 z-[60] px-4 pb-4">
      <div
        className="mx-auto max-w-4xl rounded-lg p-5 md:p-6 flex flex-col md:flex-row md:items-center gap-4"
        style={{
          background: "rgba(4,7,15,0.94)",
          border: "1px solid var(--hairline)",
          backdropFilter: "blur(10px)",
          boxShadow: "0 24px 60px -24px rgba(0,0,0,0.9)",
        }}
      >
        <div className="flex-1 text-sm text-muted-foreground">
          <div className="mono text-[10px] tracking-[0.22em] uppercase text-[#4c4dcf] mb-2">
            — COOKIES
          </div>
          Orbetra uses minimal cookies — essential ones to run the site, and one optional
          cookie to credit a partner referral. Analytics is cookieless.{" "}
          <Link to="/cookies" className="text-[color:var(--brand-cyan)] hover:underline">
            Cookie policy
          </Link>
          .
        </div>
        <div className="flex flex-wrap gap-2 shrink-0">
          <button
            onClick={() => setChoice("essential")}
            className="h-9 px-4 rounded mono text-[11px] tracking-wide uppercase border border-[var(--hairline)] text-muted-foreground hover:text-ink cursor-pointer"
          >
            Reject non-essential
          </button>
          <Link
            to="/cookies"
            className="h-9 px-4 inline-flex items-center rounded mono text-[11px] tracking-wide uppercase border border-[var(--hairline)] text-muted-foreground hover:text-ink"
          >
            Preferences
          </Link>
          <button
            onClick={() => setChoice("accepted")}
            className="h-9 px-4 rounded mono text-[11px] tracking-wide uppercase bg-[var(--brand-blue)] text-white hover:opacity-90 cursor-pointer"
          >
            Accept
          </button>
        </div>
      </div>
    </div>
  );
}
