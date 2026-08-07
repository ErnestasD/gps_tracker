import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { apiPost } from "@/lib/api";
import { setPartnerToken } from "@/lib/partner-auth";
import { PasswordInput } from "@/components/site/PasswordInput";

export const Route = createFileRoute("/partner/login")({
  head: () => ({
    meta: [
      { title: "Partner sign in — Orbetra" },
      { name: "description", content: "Sign in to the Orbetra partner dashboard to see your referral link, commission rate and payout history." },
      { property: "og:title", content: "Partner sign in — Orbetra" },
      { property: "og:description", content: "Access your Orbetra partner dashboard." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: PartnerLogin,
});


/** Text-input form values only — a File can never appear in these forms. */
function formVal(fd: FormData, k: string): string {
  const v = fd.get(k);
  return typeof v === "string" ? v : "";
}

function PartnerLogin() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    const fd = new FormData(e.currentTarget);
    try {
      const res = await apiPost<{ accessToken: string }>("/v1/partner/login", {
        email: formVal(fd, "email"),
        password: formVal(fd, "password"),
      });
      setPartnerToken(res.accessToken);
      void navigate({ to: "/partner/dashboard" });
    } catch (err) {
      setError(err instanceof Error ? err.message : t("partner.login.error"));
      setLoading(false);
    }
  }

  return (
    <div className="mx-auto max-w-md px-6 pt-28 md:pt-36 pb-28">
      <span className="section-label">
        <span className="h-[1px] w-6 bg-[var(--brand-blue)]" />
        {t("partner.portal")}
      </span>
      <h1 className="display text-3xl md:text-4xl font-bold mt-4 text-ink">{t("partner.login.title")}</h1>
      <form onSubmit={(e) => void onSubmit(e)} className="surface-card p-7 mt-8 grid gap-4">
        <label className="grid gap-1.5">
          <span className="mono text-[10px] tracking-[0.2em] uppercase text-muted-foreground">{t("partner.login.email")}</span>
          <input name="email" type="email" required autoComplete="email"
            className="h-11 rounded px-3 bg-[rgba(10,20,40,0.6)] border border-[var(--hairline)] text-ink text-sm outline-none focus:border-[color:var(--brand-blue)]" />
        </label>
        <label className="grid gap-1.5">
          <span className="mono text-[10px] tracking-[0.2em] uppercase text-muted-foreground">{t("partner.login.password")}</span>
          <PasswordInput name="password" required autoComplete="current-password" />
        </label>
        {error && <p className="text-sm text-[#DC2626]">{error}</p>}
        <button type="submit" disabled={loading}
          className="h-11 rounded bg-[var(--brand-blue)] text-white mono text-xs tracking-[0.18em] uppercase hover:opacity-90 disabled:opacity-60 cursor-pointer">
          {loading ? t("partner.login.submitting") : t("partner.login.submit")}
        </button>
        <p className="text-xs text-muted-foreground border-t border-[var(--hairline)] pt-4">
          {t("partner.login.inviteAsk")}{" "}
          <Link to="/partner/set-password" className="text-[color:var(--brand-cyan)] hover:underline">{t("partner.login.inviteLink")}</Link>
          . {t("partner.login.applyAsk")}{" "}
          <Link to="/partners" className="text-[color:var(--brand-cyan)] hover:underline">{t("partner.login.applyLink")}</Link>.
        </p>
      </form>
    </div>
  );
}
