import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Copy, LogOut, Plus } from "lucide-react";
import { ApiError, apiGet, apiPost } from "@/lib/api";
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

type Deal = {
  id: string;
  company: string;
  domain: string;
  status: "pending" | "approved" | "rejected" | "converted";
  reason: string | null;
  expiresAt: string | null;
  createdAt: string;
};

type Funnel = { clicksTotal: number; clicks30: number; leads: number; signups: number; paying: number };

type CurrencyTotal = { currency: string; commissionableCents: number; earnedCents: number };

type Customer = {
  id: string;
  name: string;
  plan: string;
  state: "trial" | "active" | "ended";
  since: string | null;
  windowEndsAt: string | null;
  windowOpen: boolean;
  totals: CurrencyTotal[];
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
  const [funnel, setFunnel] = useState<Funnel | null>(null);
  const [deals, setDeals] = useState<Deal[]>([]);
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
        // /customers is SETTLED SEPARATELY, not awaited alongside the other two. apps/site is a
        // static SPA deployed independently of the API: ship the page before the server and a 404
        // on the new route would take the referral link — which worked yesterday — down with it.
        const customersP = apiGet<Customer[] | { data?: Customer[] }>("/v1/partner/customers", token).catch(() => [] as Customer[]);
        const funnelP = apiGet<Funnel>("/v1/partner/funnel", token).catch(() => null);
        const dealsP = apiGet<Deal[]>("/v1/partner/deals", token).catch(() => [] as Deal[]);
        const [meRes, comRes] = await Promise.all([
          apiGet<PartnerMe>("/v1/partner/me", token),
          apiGet<Commission[] | { data?: Commission[] }>("/v1/partner/commissions", token),
        ]);
        const [cusRes, funnelRes, dealsRes] = await Promise.all([customersP, funnelP, dealsP]);
        if (cancelled) return;
        setFunnel(funnelRes);
        setDeals(Array.isArray(dealsRes) ? dealsRes : []);
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
   * The numbers a partner opens this page for, BUCKETED BY CURRENCY.
   *
   * Adding cents across currencies and stamping one symbol on the result invents an exchange rate
   * we do not have — €100 + $100 is not €200, and the symbol would flip with whichever row happened
   * to be newest. A partner earning in two currencies gets two rows of tiles instead.
   *
   * `void` rows are reversals — a refunded customer payment — and are excluded from EARNED rather
   * than shown as money that exists: a total counting cancelled commissions is the one number on
   * this page that would be a lie.
   */
  const buckets = useMemo(() => {
    const by = new Map<string, { currency: string; earned: number; paid: number; pending: number }>();
    for (const r of rows) {
      if (r.status === "void") continue;
      const b = by.get(r.currency) ?? { currency: r.currency, earned: 0, paid: 0, pending: 0 };
      b.earned += r.amountCents;
      if (r.status === "paid") b.paid += r.amountCents;
      if (r.status === "pending") b.pending += r.amountCents;
      by.set(r.currency, b);
    }
    // no commissions yet ⇒ still show the zeroed tiles rather than an empty strip
    return by.size > 0 ? [...by.values()] : [{ currency: "eur", earned: 0, paid: 0, pending: 0 }];
  }, [rows]);

  // a customer stops earning when their window closes; knowing how many are still live is the
  // difference between "I have 8 customers" and "I am still being paid for 3 of them"
  const earning = useMemo(() => customers.filter((c) => c.windowOpen && c.since !== null).length, [customers]);

  /**
   * Dates on this page are UTC, deliberately.
   *
   * The window end is a CONTRACTUAL date computed in UTC by the accrual, and rendering it in the
   * viewer's zone would show a partner in Los Angeles one day earlier than the day the server
   * enforces. A ledger that reads differently depending on where you open it is worse than one that
   * reads in a zone you have to know about (hard rule 7).
   */
  const fmtDate = (iso: string | null) =>
    iso === null ? "—" : new Date(iso).toLocaleDateString(locale, { timeZone: "UTC" });

  if (!token) return null;

  const code = me?.code ?? "—";
  // the shareable link the partner actually gives out; origin-relative so it works on any deploy
  // the SHORT link: `/r/<code>` counts the click and forwards to the site with `?ref=` attached.
  // A partner pastes this into an email; `?ref=BALTIC25` on a long URL looks like tracking junk and
  // was also unmeasurable — nothing counted an open before it existed.
  const link = me?.code ? `${typeof window !== "undefined" ? window.location.origin : "https://orbetra.com"}/r/${me.code}` : "—";

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

      {/* ── the funnel: where people fall out, which is the question "how much did I earn" can't answer ── */}
      {funnel !== null && (
        <div className="mt-10 surface-card p-6" data-testid="partner-funnel">
          <div className="flex flex-wrap items-baseline justify-between gap-3">
            <div className="mono text-[10px] tracking-[0.2em] uppercase text-muted-foreground">{t("partner.dashboard.funnel")}</div>
            <div className="mono text-[11px] text-muted-foreground">{t("partner.dashboard.funnel30", { n: funnel.clicks30 })}</div>
          </div>
          <div className="mt-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <FunnelStep label={t("partner.dashboard.stepClicks")} value={funnel.clicksTotal} hint={t("partner.dashboard.stepClicksHint")} />
            <FunnelStep label={t("partner.dashboard.stepLeads")} value={funnel.leads} hint={t("partner.dashboard.stepLeadsHint")} from={funnel.clicksTotal} />
            <FunnelStep label={t("partner.dashboard.stepSignups")} value={funnel.signups} hint={t("partner.dashboard.stepSignupsHint")} from={funnel.clicksTotal} />
            <FunnelStep label={t("partner.dashboard.stepPaying")} value={funnel.paying} hint={t("partner.dashboard.stepPayingHint")} from={funnel.signups} />
          </div>
        </div>
      )}

      {/* ── the headline numbers, one strip per currency ─────────────────────────────────────── */}
      {buckets.map((b, i) => (
        <div key={b.currency} className="mt-5 grid gap-5 sm:grid-cols-2 lg:grid-cols-4 first-of-type:mt-10">
          <Tile
            label={t("partner.dashboard.totalEarned")}
            value={money(b.earned, b.currency, locale)}
            hint={t("partner.dashboard.totalEarnedHint")}
          />
          <Tile
            label={t("partner.dashboard.paidOut")}
            value={money(b.paid, b.currency, locale)}
            hint={t("partner.dashboard.paidOutHint")}
          />
          <Tile
            label={t("partner.dashboard.awaiting")}
            value={money(b.pending, b.currency, locale)}
            hint={t("partner.dashboard.awaitingHint")}
            accent="#E0A030"
          />
          {/* the customer count belongs to the partner, not to a currency — render it once */}
          {i === 0 ? (
            <Tile
              label={t("partner.dashboard.customers")}
              value={String(customers.length)}
              hint={t("partner.dashboard.customersHint", { n: earning })}
            />
          ) : (
            <div className="hidden lg:block" />
          )}
        </div>
      ))}

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
                    {c.state !== "active" && (
                      <span className="ml-2 text-[10px] uppercase tracking-widest" style={{ color: c.state === "ended" ? "var(--muted-foreground)" : "#E0A030" }}>
                        {t(`partner.dashboard.state.${c.state}`)}
                      </span>
                    )}
                  </td>
                  <td className="px-5 py-3 mono text-[12px] text-muted-foreground">{fmtDate(c.since)}</td>
                  <td className="px-5 py-3 mono text-right text-muted-foreground">
                    {c.totals.length === 0 ? "—" : c.totals.map((x) => <div key={x.currency}>{money(x.commissionableCents, x.currency, locale)}</div>)}
                  </td>
                  <td className="px-5 py-3 mono text-right text-ink">
                    {c.totals.length === 0 ? "—" : c.totals.map((x) => <div key={x.currency}>{money(x.earnedCents, x.currency, locale)}</div>)}
                  </td>
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

      {/* ── protect a prospect you introduced yourself ──────────────────────────────────────── */}
      <DealsSection token={token} deals={deals} onRegistered={(d) => setDeals((prev) => [d, ...prev])} />

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
                    {fmtDate(r.at)}
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

/**
 * One funnel stage, with the conversion from the stage it is measured against.
 *
 * The percentage is deliberately omitted when the previous stage is zero rather than rendered as 0%
 * or NaN%: "0% of 0" tells a new partner their link is failing when in fact nobody has opened it
 * yet, which is the opposite conclusion.
 */
function FunnelStep({ label, value, hint, from }: { label: string; value: number; hint: string; from?: number }) {
  // Suppressed above 100%, not clamped. Click counting started the day it shipped while sign-ups and
  // enquiries are historical, so every existing partner shows twelve sign-ups from one open — and
  // "1200%" is a lie where a blank is merely silent. It settles by itself as clicks accumulate.
  const ratio = from !== undefined && from > 0 ? Math.round((value / from) * 100) : null;
  const pct = ratio !== null && ratio <= 100 ? ratio : null;
  return (
    <div>
      <div className="mono text-[10px] tracking-[0.2em] uppercase text-muted-foreground">{label}</div>
      <div className="mt-2 flex items-baseline gap-2">
        <span className="display text-2xl font-bold text-ink">{value}</span>
        {pct !== null && <span className="mono text-[11px] text-muted-foreground">{pct}%</span>}
      </div>
      <div className="mono text-[11px] text-muted-foreground mt-1">{hint}</div>
    </div>
  );
}

/**
 * Deal registration: the claim that protects a partner who introduced a fleet in person.
 *
 * The one thing this section has to communicate, because getting it wrong costs a partner money, is
 * WHEN it applies: a claim covers a customer who arrives with no link. It does not override someone
 * else's referral link, and it does nothing until we approve it. Both are stated in the copy rather
 * than discovered when a commission fails to appear.
 */
function DealsSection({ token, deals, onRegistered }: { token: string; deals: Deal[]; onRegistered: (d: Deal) => void }) {
  const { t, i18n } = useTranslation();
  const [open, setOpen] = useState(false);
  const [company, setCompany] = useState("");
  const [domain, setDomain] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const locale = i18n.resolvedLanguage ?? "en";

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const created = await apiPost<Deal>("/v1/partner/deals", { company: company.trim(), domain: domain.trim(), ...(note.trim() !== "" ? { note: note.trim() } : {}) }, token);
      onRegistered(created);
      setCompany("");
      setDomain("");
      setNote("");
      setOpen(false);
    } catch (err) {
      // the two 400s a partner can actually hit have their own copy — "invalid request" would send
      // them to support for a rule we could simply have told them
      const detail = err instanceof ApiError ? err.detail : null;
      setError(
        detail === "free_mail_domain" ? t("partner.dashboard.dealFreeMail")
        : detail === "own_domain" ? t("partner.dashboard.dealOwnDomain")
        // the house-account rule: registration protects NEW business. ONE message for both "already
        // ours" and "already another partner's" — telling them apart would let any partner walk a
        // domain list and map our customer base against a rival's
        : detail === "not_eligible" ? t("partner.dashboard.dealNotEligible")
        : detail === "too_many_pending" ? t("partner.dashboard.dealTooMany")
        : t("partner.dashboard.dealError"),
      );
    } finally {
      setBusy(false);
    }
  };

  const tone: Record<Deal["status"], string> = {
    pending: "#E0A030",
    approved: "var(--brand-cyan)",
    converted: "var(--brand-cyan)",
    rejected: "var(--muted-foreground)",
  };

  return (
    <div className="mt-10 surface-card overflow-x-auto" data-testid="partner-deals">
      <div className="flex flex-wrap items-start justify-between gap-3 px-5 py-4 border-b border-[var(--hairline)]">
        <div>
          <div className="mono text-[10px] tracking-[0.2em] uppercase text-muted-foreground">{t("partner.dashboard.deals")}</div>
          <p className="mt-1.5 max-w-2xl text-[12px] text-muted-foreground">{t("partner.dashboard.dealsNote")}</p>
        </div>
        <button onClick={() => setOpen((v) => !v)} className="pill-ghost cursor-pointer inline-flex items-center gap-2">
          <Plus className="h-4 w-4" /> {t("partner.dashboard.dealAdd")}
        </button>
      </div>

      {open && (
        <form onSubmit={(e) => void submit(e)} className="grid gap-3 px-5 py-4 border-b border-[var(--hairline)] sm:grid-cols-2">
          <label className="grid gap-1.5">
            <span className="mono text-[10px] tracking-[0.2em] uppercase text-muted-foreground">{t("partner.dashboard.dealCompany")}</span>
            <input value={company} onChange={(e) => setCompany(e.target.value)} required maxLength={160} className="auth-input" data-testid="deal-company" />
          </label>
          <label className="grid gap-1.5">
            <span className="mono text-[10px] tracking-[0.2em] uppercase text-muted-foreground">{t("partner.dashboard.dealDomain")}</span>
            <input value={domain} onChange={(e) => setDomain(e.target.value)} required placeholder="imone.lt" className="auth-input" data-testid="deal-domain" />
          </label>
          <label className="grid gap-1.5 sm:col-span-2">
            <span className="mono text-[10px] tracking-[0.2em] uppercase text-muted-foreground">{t("partner.dashboard.dealNote")}</span>
            <input value={note} onChange={(e) => setNote(e.target.value)} maxLength={2000} className="auth-input" data-testid="deal-note" />
          </label>
          {error !== null && <p role="alert" className="text-sm text-[#DC2626] sm:col-span-2" data-testid="deal-error">{error}</p>}
          <div className="sm:col-span-2">
            <button type="submit" disabled={busy} className="auth-submit" data-testid="deal-submit">{t("partner.dashboard.dealSubmit")}</button>
          </div>
        </form>
      )}

      {deals.length === 0 ? (
        <p className="px-5 py-8 text-sm text-muted-foreground">{t("partner.dashboard.noDeals")}</p>
      ) : (
        <table className="w-full text-sm">
          <thead>
            <tr className="mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
              <th className="text-left px-5 py-3">{t("partner.dashboard.dealCompany")}</th>
              <th className="text-left px-5 py-3">{t("partner.dashboard.dealDomain")}</th>
              <th className="text-left px-5 py-3">{t("partner.dashboard.status")}</th>
              <th className="text-left px-5 py-3">{t("partner.dashboard.dealProtectedUntil")}</th>
            </tr>
          </thead>
          <tbody>
            {deals.map((d) => (
              <tr key={d.id} className="border-t border-[var(--hairline)]">
                <td className="px-5 py-3 text-ink">{d.company}</td>
                <td className="px-5 py-3 mono text-[12px] text-muted-foreground">{d.domain}</td>
                <td className="px-5 py-3">
                  <span className="mono text-[10px] uppercase tracking-widest" style={{ color: tone[d.status] }}>
                    {t(`partner.dashboard.dealStatus.${d.status}`)}
                  </span>
                  {/* a rejection without its reason is the support ticket this avoids */}
                  {d.reason !== null && d.reason !== "" && <div className="mt-1 text-[11px] text-muted-foreground">{d.reason}</div>}
                </td>
                <td className="px-5 py-3 mono text-[12px] text-muted-foreground">
                  {d.expiresAt === null ? "—" : new Date(d.expiresAt).toLocaleDateString(locale, { timeZone: "UTC" })}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
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
