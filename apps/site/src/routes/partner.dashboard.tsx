import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
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

/** These MUST mirror the wire shape of GET /v1/partner/me, /v1/partner/commissions and
 *  /v1/partner/customers (apps/api/src/routes/partner.ts). Fields are REQUIRED on purpose: optional
 *  fields let a rename silently render "—" everywhere instead of failing the typecheck — which is
 *  exactly how the whole dashboard shipped blank (review HIGH). Decimals arrive as STRINGS. */
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
  customer: string;
  amountCents: number;
  baseAmountCents: number | null;
  ratePct: string | null;
  currency: string;
  status: string;
  sourceInvoiceId: string;
  at: string;
};

type Customer = {
  id: string;
  name: string;
  plan: string;
  subscriptionStatus: string | null;
  since: string | null;
  windowEndsAt: string | null;
  windowOpen: boolean;
  paidCents: number;
  earnedCents: number;
  currency: string;
};

/** Money, in the currency the commission was actually accrued in — never a hard-coded €. */
function money(cents: number, currency: string, locale: string) {
  return new Intl.NumberFormat(locale, { style: "currency", currency: currency.toUpperCase() }).format(cents / 100);
}

/** `pending` and `paid` are the only states a partner can act on, so they get colour; `void` is a
 *  reversal and reads as muted rather than alarming. */
const STATUS_COLOR: Record<string, string> = {
  paid: "var(--brand-cyan)",
  pending: "#E0A030",
  void: "var(--muted-foreground)",
};

function PartnerDashboard() {
  const { t, i18n } = useTranslation();
  const token = usePartnerToken();
  const navigate = useNavigate();
  const [me, setMe] = useState<PartnerMe | null>(null);
  const [rows, setRows] = useState<Commission[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);
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
        const [meRes, comRes, cusRes] = await Promise.all([
          apiGet<PartnerMe>("/v1/partner/me", token),
          apiGet<Commission[] | { data?: Commission[] }>("/v1/partner/commissions", token),
          apiGet<Customer[] | { data?: Customer[] }>("/v1/partner/customers", token),
        ]);
        if (cancelled) return;
        setMe(meRes);
        setRows(Array.isArray(comRes) ? comRes : (comRes?.data ?? []));
        setCustomers(Array.isArray(cusRes) ? cusRes : (cusRes?.data ?? []));
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

  const locale = i18n.resolvedLanguage ?? "en";

  /**
   * The four numbers a partner opens this page for. `void` rows are reversals — a refunded customer
   * payment — and are excluded from EARNED rather than shown as money that exists: a total that
   * counts cancelled commissions is the one number on the page that would be a lie.
   */
  const totals = useMemo(() => {
    const live = rows.filter((r) => r.status !== "void");
    const currency = live[0]?.currency ?? customers[0]?.currency ?? "eur";
    const sum = (rs: Commission[]) => rs.reduce((a, r) => a + r.amountCents, 0);
    return {
      currency,
      earned: sum(live),
      paid: sum(live.filter((r) => r.status === "paid")),
      pending: sum(live.filter((r) => r.status === "pending")),
      customers: customers.length,
      // a customer stops earning when their window closes; knowing how many are still live is the
      // difference between "I have 8 customers" and "I am still being paid for 3 of them"
      earning: customers.filter((c) => c.windowOpen && c.since !== null).length,
    };
  }, [rows, customers]);

  const fmtDate = (iso: string | null) => (iso === null ? "—" : new Date(iso).toLocaleDateString(locale));

  if (!token) return null;

  const code = me?.code ?? "—";
  // the shareable link the partner actually gives out; origin-relative so it works on any deploy
  const link = me?.code ? `${typeof window !== "undefined" ? window.location.origin : "https://orbetra.com"}/?ref=${me.code}` : "—";

  return (
    <div className="mx-auto max-w-6xl px-6 pt-24 md:pt-32 pb-24">
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

      {/* ── the headline numbers ─────────────────────────────────────────────────────────────── */}
      <div className="mt-10 grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
        <Tile
          label={t("partner.dashboard.totalEarned")}
          value={money(totals.earned, totals.currency, locale)}
          hint={t("partner.dashboard.totalEarnedHint")}
        />
        <Tile
          label={t("partner.dashboard.paidOut")}
          value={money(totals.paid, totals.currency, locale)}
          hint={t("partner.dashboard.paidOutHint")}
        />
        <Tile
          label={t("partner.dashboard.awaiting")}
          value={money(totals.pending, totals.currency, locale)}
          hint={t("partner.dashboard.awaitingHint")}
          accent="#E0A030"
        />
        <Tile
          label={t("partner.dashboard.customers")}
          value={String(totals.customers)}
          hint={t("partner.dashboard.customersHint", { count: totals.earning })}
        />
      </div>

      {/* ── link + terms ─────────────────────────────────────────────────────────────────────── */}
      <div className="mt-5 grid gap-5 md:grid-cols-3">
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

      {/* ── who is actually paying ───────────────────────────────────────────────────────────── */}
      <Section title={t("partner.dashboard.yourCustomers")} note={t("partner.dashboard.yourCustomersNote")}>
        {customers.length === 0 ? (
          <p className="px-5 py-8 text-sm text-muted-foreground">{t("partner.dashboard.noCustomers")}</p>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
                <th className="text-left px-5 py-3">{t("partner.dashboard.customer")}</th>
                <th className="text-left px-5 py-3">{t("partner.dashboard.plan")}</th>
                <th className="text-left px-5 py-3">{t("partner.dashboard.since")}</th>
                <th className="text-right px-5 py-3">{t("partner.dashboard.theyPaid")}</th>
                <th className="text-right px-5 py-3">{t("partner.dashboard.youEarned")}</th>
                <th className="text-left px-5 py-3">{t("partner.dashboard.windowCol")}</th>
              </tr>
            </thead>
            <tbody>
              {customers.map((c) => (
                <tr key={c.id} className="border-t border-[var(--hairline)]">
                  <td className="px-5 py-3 text-ink">{c.name}</td>
                  <td className="px-5 py-3 mono text-[12px] text-muted-foreground">
                    {c.plan}
                    {c.subscriptionStatus !== null && c.subscriptionStatus !== "active" && (
                      <span className="ml-2 text-[10px] uppercase tracking-widest" style={{ color: "#E0A030" }}>
                        {c.subscriptionStatus}
                      </span>
                    )}
                  </td>
                  <td className="px-5 py-3 mono text-[12px] text-muted-foreground">{fmtDate(c.since)}</td>
                  <td className="px-5 py-3 mono text-right text-muted-foreground">{money(c.paidCents, c.currency, locale)}</td>
                  <td className="px-5 py-3 mono text-right text-ink">{money(c.earnedCents, c.currency, locale)}</td>
                  <td className="px-5 py-3 mono text-[12px]">
                    {c.since === null ? (
                      <span className="text-muted-foreground">{t("partner.dashboard.notYetPaying")}</span>
                    ) : c.windowOpen ? (
                      <span style={{ color: "var(--brand-cyan)" }}>{t("partner.dashboard.windowUntil", { date: fmtDate(c.windowEndsAt) })}</span>
                    ) : (
                      <span className="text-muted-foreground">{t("partner.dashboard.windowClosed", { date: fmtDate(c.windowEndsAt) })}</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Section>

      {/* ── the ledger, with the arithmetic on show ──────────────────────────────────────────── */}
      <Section title={t("partner.dashboard.history")} note={t("partner.dashboard.historyNote")}>
        {rows.length === 0 ? (
          <p className="px-5 py-8 text-sm text-muted-foreground">{t("partner.dashboard.empty")}</p>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
                <th className="text-left px-5 py-3">{t("partner.dashboard.date")}</th>
                <th className="text-left px-5 py-3">{t("partner.dashboard.customer")}</th>
                <th className="text-right px-5 py-3">{t("partner.dashboard.theyPaid")}</th>
                <th className="text-right px-5 py-3">{t("partner.dashboard.rate")}</th>
                <th className="text-right px-5 py-3">{t("partner.dashboard.yourCommission")}</th>
                <th className="text-left px-5 py-3">{t("partner.dashboard.status")}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className="border-t border-[var(--hairline)]">
                  <td className="px-5 py-3 mono text-[12px] text-muted-foreground" title={r.sourceInvoiceId}>
                    {new Date(r.at).toLocaleDateString(locale)}
                  </td>
                  <td className="px-5 py-3 text-ink">{r.customer}</td>
                  <td className="px-5 py-3 mono text-right text-muted-foreground">
                    {r.baseAmountCents === null ? "—" : money(r.baseAmountCents, r.currency, locale)}
                  </td>
                  <td className="px-5 py-3 mono text-right text-muted-foreground">
                    {r.ratePct === null ? "—" : `${Number(r.ratePct)}%`}
                  </td>
                  <td
                    className="px-5 py-3 mono text-right"
                    style={{ color: r.status === "void" ? "var(--muted-foreground)" : "var(--ink)", textDecoration: r.status === "void" ? "line-through" : undefined }}
                  >
                    {money(r.amountCents, r.currency, locale)}
                  </td>
                  <td className="px-5 py-3">
                    <span
                      className="mono text-[10px] uppercase tracking-widest"
                      style={{ color: STATUS_COLOR[r.status] ?? "var(--muted-foreground)" }}
                    >
                      {t(`partner.dashboard.statusLabel.${r.status}`, { defaultValue: r.status })}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Section>

      {/* ── how the money works, in plain words ──────────────────────────────────────────────── */}
      <div className="mt-10 surface-card p-6">
        <div className="mono text-[10px] tracking-[0.2em] uppercase text-muted-foreground">{t("partner.dashboard.howTitle")}</div>
        <ul className="mt-4 grid gap-3 text-sm text-muted-foreground">
          {(["accrual", "window", "statuses", "refunds", "snapshot", "payout"] as const).map((k) => (
            <li key={k} className="flex gap-3">
              <span className="mono text-[color:var(--brand-cyan)] shrink-0">·</span>
              <span>{t(`partner.dashboard.how.${k}`)}</span>
            </li>
          ))}
        </ul>
      </div>

      <p className="mt-8 text-sm text-muted-foreground">
        {t("partner.dashboard.payoutAsk")}{" "}
        <a href="mailto:hello@orbetra.com" className="text-[color:var(--brand-cyan)] hover:underline">hello@orbetra.com</a>{" "}
        · <Link to="/partners" className="text-[color:var(--brand-cyan)] hover:underline">{t("partner.dashboard.programLink")}</Link>
      </p>
    </div>
  );
}

function Tile({ label, value, hint, accent }: { label: string; value: string; hint: string; accent?: string }) {
  return (
    <div className="surface-card p-6">
      <div className="mono text-[10px] tracking-[0.2em] uppercase text-muted-foreground">{label}</div>
      <div className="mt-3 display text-2xl md:text-3xl font-bold" style={{ color: accent ?? "var(--ink)" }}>
        {value}
      </div>
      <div className="mono text-[11px] text-muted-foreground mt-1">{hint}</div>
    </div>
  );
}

function Section({ title, note, children }: { title: string; note: string; children: React.ReactNode }) {
  return (
    <div className="mt-10 surface-card overflow-x-auto">
      <div className="px-5 py-4 border-b border-[var(--hairline)]">
        <div className="mono text-[10px] tracking-[0.2em] uppercase text-muted-foreground">{title}</div>
        <p className="mt-1.5 text-[12px] text-muted-foreground">{note}</p>
      </div>
      {children}
    </div>
  );
}
