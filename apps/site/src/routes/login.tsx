import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowRight } from "lucide-react";
import { useTranslation } from "react-i18next";

import { DASH_URL } from "@/lib/api";

/** Sign-in CHOOSER — the marketing site never authenticates tenant users itself.
 * There is NO /v1/public/login endpoint: fleet users sign in at the external
 * dashboard (apps/web, VITE_DASH_URL); partners have their own portal at
 * /partner/login (the only auth this site performs). */
export const Route = createFileRoute("/login")({
  head: () => ({
    meta: [
      { title: "Sign in — Orbetra" },
      {
        name: "description",
        content:
          "Sign in to Orbetra: open the fleet dashboard to track vehicles live, or use the partner portal for referral commissions.",
      },
      { property: "og:title", content: "Sign in — Orbetra" },
      { property: "og:description", content: "Access your Orbetra fleet tracking workspace." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: LoginPage,
});

function LoginPage() {
  const { t } = useTranslation();
  return (
    <div className="mx-auto max-w-md px-6 pt-24 md:pt-32 pb-24">
      <span className="section-label">
        <span className="h-[1px] w-6 bg-[var(--brand-blue)]" />
        {t("login.label")}
      </span>
      <h1 className="display text-3xl md:text-4xl font-bold mt-5 text-ink leading-[1.05]">
        {t("login.h1")}
      </h1>
      <p className="mt-3 text-sm text-muted-foreground">
        {t("login.sub")}
      </p>

      <div className="surface-card p-7 mt-8 grid gap-4">
        <a
          href={DASH_URL}
          className="inline-flex h-11 items-center justify-center gap-2 rounded bg-[var(--brand-blue)] text-white mono text-xs tracking-[0.18em] uppercase hover:opacity-90"
        >
          {t("login.dashboard")} <ArrowRight className="h-4 w-4" />
        </a>
        <p className="text-xs text-muted-foreground text-center">
          {t("login.note")}
        </p>
        <p className="text-xs text-muted-foreground border-t border-[var(--hairline)] pt-4">
          {t("login.partnerAsk")}{" "}
          <Link to="/partner/login" className="text-[color:var(--brand-cyan)] hover:underline">
            {t("login.partnerLink")}
          </Link>
        </p>
        <p className="text-xs text-muted-foreground">
          {t("login.noAccount")}{" "}
          <Link to="/signup" className="text-[color:var(--brand-cyan)] hover:underline">
            {t("login.trialLink")}
          </Link>
          {" · "}
          <Link to="/demo" className="text-[color:var(--brand-cyan)] hover:underline">
            {t("login.demoLink")}
          </Link>
        </p>
      </div>
    </div>
  );
}
