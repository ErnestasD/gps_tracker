import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
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

type PartnerMe = {
  name?: string;
  email?: string;
  referralCode?: string;
  commissionRate?: number;
  commissionWindowMonths?: number;
};

type Commission = {
  id?: string;
  createdAt?: string;
  customer?: string;
  amount?: number;
  currency?: string;
  status?: string;
};

function PartnerDashboard() {
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
        setError(err instanceof Error ? err.message : "Could not load your data");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [token, navigate]);

  if (!token) return null;

  const code = me?.referralCode ?? "—";
  const link = me?.referralCode ? `https://orbetra.com/?ref=${me.referralCode}` : "—";

  return (
    <div className="mx-auto max-w-5xl px-6 pt-24 md:pt-32 pb-24">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <span className="section-label">
            <span className="h-[1px] w-6 bg-[var(--brand-blue)]" />
            — PARTNER DASHBOARD
          </span>
          <h1 className="display text-3xl md:text-4xl font-bold mt-4 text-ink">
            {me?.name ? `Hi, ${me.name}` : "Your partner account"}
          </h1>
        </div>
        <button
          onClick={() => {
            setPartnerToken(null);
            void navigate({ to: "/partner/login" });
          }}
          className="pill-ghost cursor-pointer inline-flex items-center gap-2"
        >
          <LogOut className="h-4 w-4" /> Sign out
        </button>
      </div>

      {error && <p className="mt-6 text-sm text-[#DC2626]">{error}</p>}

      <div className="mt-10 grid gap-5 md:grid-cols-3">
        <div className="surface-card p-6 md:col-span-2">
          <div className="mono text-[10px] tracking-[0.2em] uppercase text-muted-foreground">Referral link</div>
          <div className="mt-3 flex items-center gap-3 flex-wrap">
            <code className="mono text-sm text-ink break-all">{link}</code>
            {me?.referralCode && (
              <button
                onClick={() => {
                  void navigator.clipboard.writeText(link);
                  setCopied(true);
                  setTimeout(() => setCopied(false), 1600);
                }}
                className="h-8 px-3 inline-flex items-center gap-2 rounded border border-[var(--hairline)] mono text-[10px] uppercase tracking-widest text-muted-foreground hover:text-ink cursor-pointer"
              >
                <Copy className="h-3 w-3" /> {copied ? "Copied" : "Copy"}
              </button>
            )}
          </div>
          <div className="mt-3 mono text-[11px] text-muted-foreground">Code · {code}</div>
        </div>
        <div className="surface-card p-6">
          <div className="mono text-[10px] tracking-[0.2em] uppercase text-muted-foreground">Your terms</div>
          <div className="mt-3 display text-3xl font-bold text-ink">
            {me?.commissionRate != null ? `${me.commissionRate}%` : "—"}
          </div>
          <div className="mono text-[11px] text-muted-foreground mt-1">
            {me?.commissionWindowMonths != null ? `${me.commissionWindowMonths} months per referral` : "Recurring, limited window"}
          </div>
        </div>
      </div>

      <div className="mt-10 surface-card overflow-x-auto">
        <div className="px-5 py-4 mono text-[10px] tracking-[0.2em] uppercase text-muted-foreground border-b border-[var(--hairline)]">
          Commission history
        </div>
        {rows.length === 0 ? (
          <p className="px-5 py-8 text-sm text-muted-foreground">
            No commissions yet. Share your link to get started.
          </p>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
                <th className="text-left px-5 py-3">Date</th>
                <th className="text-left px-5 py-3">Customer</th>
                <th className="text-left px-5 py-3">Amount</th>
                <th className="text-left px-5 py-3">Status</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={r.id ?? i} className="border-t border-[var(--hairline)]">
                  <td className="px-5 py-3 mono text-[12px] text-muted-foreground">
                    {r.createdAt ? new Date(r.createdAt).toLocaleDateString() : "—"}
                  </td>
                  <td className="px-5 py-3 text-ink">{r.customer ?? "—"}</td>
                  <td className="px-5 py-3 mono text-ink">
                    {r.amount != null ? `${r.amount.toFixed(2)} ${r.currency ?? "EUR"}` : "—"}
                  </td>
                  <td className="px-5 py-3">
                    <span className="mono text-[10px] uppercase tracking-widest text-[color:var(--brand-cyan)]">
                      {r.status ?? "pending"}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <p className="mt-8 text-sm text-muted-foreground">
        Questions about payouts?{" "}
        <a href="mailto:hello@orbetra.com" className="text-[color:var(--brand-cyan)] hover:underline">hello@orbetra.com</a>{" "}
        · <Link to="/partners" className="text-[color:var(--brand-cyan)] hover:underline">Program details</Link>
      </p>
    </div>
  );
}
