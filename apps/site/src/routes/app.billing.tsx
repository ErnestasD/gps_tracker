import { createFileRoute } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { AdminButton, Badge, PageHeader } from "@/components/admin/AdminKit";

export const Route = createFileRoute("/app/billing")({
  component: BillingPage,
});

// Mirrors apps/web/src/routes/app/billing.tsx (Stripe billing, ADR-024/ADR-028) using the
// product's own translations (admin namespace, billing.*). Demo tenant: `direct_100` on a
// self-serve trial — the state where the real page shows BOTH the Direct→TSP upgrade card
// and the plan picker (trialing is subscribable), plus the subscription card with the
// Stripe portal hand-off button. All buttons are visual no-ops in the demo.

const UPGRADE_FEATURE_KEYS = ["whiteLabel", "customDomains", "subAccounts", "api", "webhooks"] as const;

const PLANS = [
  { id: "direct_25", name: "Orbetra Direct 25", price: "€35" },
  { id: "direct_50", name: "Orbetra Direct 50", price: "€65" },
  { id: "direct_100", name: "Orbetra Direct 100", price: "€119" },
];

function BillingPage() {
  const { t } = useTranslation("admin");
  return (
    <div className="space-y-4 p-4 md:p-8">
      <PageHeader className="mb-0" title={t("billing.title")} description={t("billing.desc")} />

      <div className="admin-card overflow-hidden">
        <div className="flex flex-col gap-4 p-5 md:flex-row md:items-center md:justify-between">
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <Badge tone="brand">{t("billing.upgrade.badge")}</Badge>
              <span className="text-sm font-semibold" style={{ color: "var(--admin-ink)" }}>
                {t("billing.upgrade.title")}
              </span>
            </div>
            <p className="max-w-xl text-sm" style={{ color: "var(--admin-ink-soft)" }}>
              {t("billing.upgrade.desc")}
            </p>
            <ul className="grid grid-cols-1 gap-x-6 gap-y-1 pt-1 sm:grid-cols-2">
              {UPGRADE_FEATURE_KEYS.map((f) => (
                <li key={f} className="flex items-start gap-2 text-sm" style={{ color: "var(--admin-ink)" }}>
                  <span aria-hidden style={{ color: "var(--admin-brand)" }}>✓</span>
                  <span>{t(`billing.upgrade.features.${f}`)}</span>
                </li>
              ))}
            </ul>
          </div>
          <div className="shrink-0">
            <a href="mailto:sales@orbetra.com?subject=Orbetra%20White-label%2FTSP%20upgrade">
              <AdminButton variant="primary">{t("billing.upgrade.cta")}</AdminButton>
            </a>
            <p className="mt-2 max-w-[16rem] text-xs" style={{ color: "var(--admin-ink-soft)" }}>
              {t("billing.upgrade.note")}
            </p>
          </div>
        </div>
      </div>

      <div className="admin-card">
        <div className="admin-hairline-b flex items-center justify-between px-4 py-3">
          <span className="text-sm font-semibold" style={{ color: "var(--admin-ink)" }}>{t("billing.subscription")}</span>
          <Badge tone="success">{t("billing.st.trialing")}</Badge>
        </div>
        <div className="flex flex-col gap-4 p-4">
          <p className="text-sm" style={{ color: "var(--admin-ink-soft)" }}>
            {t("billing.pricingNote")}
          </p>
          <p className="text-sm" style={{ color: "var(--admin-ink)" }}>{t("billing.renews")}: 2026-09-15</p>
          <div>
            <AdminButton variant="primary">{t("billing.manage")}</AdminButton>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {PLANS.map((p) => (
          <div key={p.id} className="admin-card flex flex-col gap-3 p-5" style={{ borderColor: "var(--admin-brand)" }}>
            <div className="text-sm font-semibold" style={{ color: "var(--admin-ink)" }}>{p.name}</div>
            <p className="display text-2xl font-semibold tracking-tight" style={{ color: "var(--admin-ink)" }}>
              {p.price}
              <span className="text-sm font-normal" style={{ color: "var(--admin-ink-soft)" }}> / {t("billing.interval.month")}</span>
            </p>
            <div>
              <AdminButton size="sm">{t("billing.subscribe")}</AdminButton>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
