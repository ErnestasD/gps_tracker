import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Copy, LogOut } from "lucide-react";
import { ApiError, apiGet } from "@/lib/api";
import { usePartnerToken, setPartnerToken } from "@/lib/partner-auth";

export const Route = createFileRoute("/partner/dashboard")({
  head: () => ({
    meta: [
      { title: "Partner dashboard — Orbetra" },
      { name: "description", content: "Your Orbetra partner referral link, commission rate and payout history." },
      { property: "og:title", content: "Partner dashboard — Orbetra" },
      { property: "og:description", content: "Referral link, commission rate and payout history." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: PartnerDashboard,
});

/** These MUST mirror the wire shape of GET /v1/partner/me and /v1/partner/commissions
 *  (apps/api/src/routes/partner.ts). Fields are REQUIRED on purpose: optional fields let a rename
 *  silently render "—" everywhere instead of failing the typecheck — which is exactly how the whole
 *  dashboard shipped blank (review HIGH). `commissionPct` is a Decimal serialized as a STRING. */
type PartnerMe = {
  id: string;
  name: string;
  email: string;
  code: string;
  commissionPct: string;
  commissionMonths: number;
  status: string;
  createdAt: string;
};

type Commission = {
  id: string;
  amountCents: number;
  currency: string;
  status: string;
  sourceInvoiceId: string;
  createdAt: string;
};

function PartnerDashboard() {
  const { t, i18n } = useTranslation();
  const token = usePartnerToken();
  const navigate = useNavigate();
  const [me, setMe] = useState<PartnerMe | null>(null);
  const [rows, setRows] = useState<Commission[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!token) {
      void navigate({ to: "/partner/login" });
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        const [meRes, comRes] = await Promise.all([
          apiGet<PartnerMe>("/v1/partner/me", token),
          apiGet<Commission[] | { data?: Commission[] }>("/v1/partner/commissions", token),
        ]);
        if (cancelled) return;
        setMe(meRes);
        setRows(Array.isArray(comRes) ? comRes : (comRes?.data ?? []));
      } catch (err) {
        if (cancelled) return;
        // 401 = token expired/invalid → back to sign-in; anything else (network, 5xx)
        // keeps the session and shows the error instead of bouncing the partner out.
        if (err instanceof ApiError && err.status === 401) {
          setPartnerToken(null);
          void navigate({ to: "/partner/login" });
          return;
        }
        setError(err instanceof Error ? err.message : t("partner.dashboard.loadError"));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [token, navigate, t]);

  if (!token) return null;

  const code = me?.code ?? "—";
  // the shareable link the partner actually gives out; origin-relative so it works on any deploy
  const link = me?.code ? `${typeof window !== "undefined" ? window.location.origin : "https://orbetra.com"}/?ref=${me.code}` : "—";

  return (
    <div className="mx-auto max-w-5xl px-6 pt-24 md:pt-32 pb-24">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <span className="section-label">
            <span className="h-[1px] w-6 bg-[var(--brand-blue)]" />
            {t("partner.dashboard.label")}
          </span>
          <h1 className="display text-3xl md:text-4xl font-bold mt-4 text-ink">
            {me?.name ? t("partner.dashboard.hi", { name: me.name }) : t("partner.dashboard.fallbackTitle")}
          </h1>
        </div>
        <button
          onClick={() => {
            setPartnerToken(null);
            void navigate({ to: "/partner/login" });
          }}
          className="pill-ghost cursor-pointer inline-flex items-center gap-2"
        >
          <LogOut className="h-4 w-4" /> {t("partner.dashboard.signout")}
        </button>
      </div>

      {error && <p className="mt-6 text-sm text-[#DC2626]">{error}</p>}

      <div className="mt-10 grid gap-5 md:grid-cols-3">
        <div className="surface-card p-6 md:col-span-2">
          <div className="mono text-[10px] tracking-[0.2em] uppercase text-muted-foreground">{t("partner.dashboard.referralLink")}</div>
          <div className="mt-3 flex items-center gap-3 flex-wrap">
            <code className="mono text-sm text-ink break-all">{link}</code>
            {me?.code && (
              <button
                onClick={() => {
                  void navigator.clipboard.writeText(link);
                  setCopied(true);
                  setTimeout(() => setCopied(false), 1600);
                }}
                className="h-8 px-3 inline-flex items-center gap-2 rounded border border-[var(--hairline)] mono text-[10px] uppercase tracking-widest text-muted-foreground hover:text-ink cursor-pointer"
              >
                <Copy className="h-3 w-3" /> {copied ? t("partner.dashboard.copied") : t("partner.dashboard.copy")}
              </button>
            )}
          </div>
          <div className="mt-3 mono text-[11px] text-muted-foreground">{t("partner.dashboard.code", { code })}</div>
        </div>
        <div className="surface-card p-6">
          <div className="mono text-[10px] tracking-[0.2em] uppercase text-muted-foreground">{t("partner.dashboard.terms")}</div>
          <div className="mt-3 display text-3xl font-bold text-ink">
            {me?.commissionPct != null ? `${Number(me.commissionPct)}%` : "—"}
          </div>
          <div className="mono text-[11px] text-muted-foreground mt-1">
            {me?.commissionMonths != null
              ? t("partner.dashboard.window", { count: me.commissionMonths })
              : t("partner.dashboard.windowFallback")}
          </div>
        </div>
      </div>

      <div className="mt-10 surface-card overflow-x-auto">
        <div className="px-5 py-4 mono text-[10px] tracking-[0.2em] uppercase text-muted-foreground border-b border-[var(--hairline)]">
          {t("partner.dashboard.history")}
        </div>
        {rows.length === 0 ? (
          <p className="px-5 py-8 text-sm text-muted-foreground">
            {t("partner.dashboard.empty")}
          </p>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
                <th className="text-left px-5 py-3">{t("partner.dashboard.date")}</th>
                <th className="text-left px-5 py-3">{t("partner.dashboard.invoice")}</th>
                <th className="text-left px-5 py-3">{t("partner.dashboard.amount")}</th>
                <th className="text-left px-5 py-3">{t("partner.dashboard.status")}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className="border-t border-[var(--hairline)]">
                  <td className="px-5 py-3 mono text-[12px] text-muted-foreground">
                    {new Date(r.createdAt).toLocaleDateString(i18n.resolvedLanguage)}
                  </td>
                  <td className="px-5 py-3 mono text-[12px] text-muted-foreground">{r.sourceInvoiceId}</td>
                  <td className="px-5 py-3 mono text-ink">
                    {(r.amountCents / 100).toFixed(2)} {r.currency.toUpperCase()}
                  </td>
                  <td className="px-5 py-3">
                    <span className="mono text-[10px] uppercase tracking-widest text-[color:var(--brand-cyan)]">
                      {r.status}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <p className="mt-8 text-sm text-muted-foreground">
        {t("partner.dashboard.payoutAsk")}{" "}
        <a href="mailto:hello@orbetra.com" className="text-[color:var(--brand-cyan)] hover:underline">hello@orbetra.com</a>{" "}
        · <Link to="/partners" className="text-[color:var(--brand-cyan)] hover:underline">{t("partner.dashboard.programLink")}</Link>
      </p>
    </div>
  );
}
