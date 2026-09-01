import { createFileRoute } from "@tanstack/react-router";
import { AdminButton, Badge, PageHeader } from "@/components/admin/AdminKit";

export const Route = createFileRoute("/app/billing")({
  component: BillingPage,
});

// Mirrors apps/web/src/routes/app/billing.tsx (Stripe billing, ADR-024/ADR-028) with the
// hardcoded LT strings from apps/web/src/i18n/lt.json. Demo tenant: `direct_100` on a
// self-serve trial — the state where the real page shows BOTH the Direct→TSP upgrade card
// and the plan picker (trialing is subscribable), plus the subscription card with the
// Stripe portal hand-off button. All buttons are visual no-ops in the demo.

const UPGRADE_FEATURES = [
  "Baltos etiketės prekės ženklas — jūsų logotipas, spalvos ir produkto pavadinimas",
  "Individualūs domenai jūsų klientų portalui",
  "Antrinės paskyros klientų parkams tvarkyti",
  "REST API prieiga integracijoms",
  "Webhook'ai realaus laiko įvykiams pristatyti",
];

const PLANS = [
  { id: "direct_25", name: "Orbetra Direct 25", price: "€35" },
  { id: "direct_50", name: "Orbetra Direct 50", price: "€65" },
  { id: "direct_100", name: "Orbetra Direct 100", price: "€119" },
];

function BillingPage() {
  return (
    <div className="space-y-4 p-4 md:p-8">
      <PageHeader className="mb-0" title="Atsiskaitymai" description="Prenumeratos planas ir mokėjimai per Stripe." />

      <div className="admin-card overflow-hidden">
        <div className="flex flex-col gap-4 p-5 md:flex-row md:items-center md:justify-between">
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <Badge tone="brand">White-label / TSP</Badge>
              <span className="text-sm font-semibold" style={{ color: "var(--admin-ink)" }}>
                Atrakinkite baltos etiketės ir perpardavimo funkcijas
              </span>
            </div>
            <p className="max-w-xl text-sm" style={{ color: "var(--admin-ink-soft)" }}>
              Jūsų planas priklauso Direct krypčiai. Pereikite prie White-label / TSP plano, kad valdytumėte Orbetra su
              savo prekės ženklu ir perparduotumėte jį savo klientams.
            </p>
            <ul className="grid grid-cols-1 gap-x-6 gap-y-1 pt-1 sm:grid-cols-2">
              {UPGRADE_FEATURES.map((f) => (
                <li key={f} className="flex items-start gap-2 text-sm" style={{ color: "var(--admin-ink)" }}>
                  <span aria-hidden style={{ color: "var(--admin-brand)" }}>✓</span>
                  <span>{f}</span>
                </li>
              ))}
            </ul>
          </div>
          <div className="shrink-0">
            <a href="mailto:sales@orbetra.com?subject=Orbetra%20White-label%2FTSP%20upgrade">
              <AdminButton variant="primary">Susisiekite dėl atnaujinimo</AdminButton>
            </a>
            <p className="mt-2 max-w-[16rem] text-xs" style={{ color: "var(--admin-ink-soft)" }}>
              Padėsime migruoti — jokie duomenys neprarandami.
            </p>
          </div>
        </div>
      </div>

      <div className="admin-card">
        <div className="admin-hairline-b flex items-center justify-between px-4 py-3">
          <span className="text-sm font-semibold" style={{ color: "var(--admin-ink)" }}>Prenumerata</span>
          <Badge tone="success">Bandomasis laikotarpis</Badge>
        </div>
        <div className="flex flex-col gap-4 p-4">
          <p className="text-sm" style={{ color: "var(--admin-ink-soft)" }}>
            Skaidri kaina — žr. savo planą. Prenumeratą, mokėjimo būdą ir sąskaitas valdykite Stripe portale.
          </p>
          <p className="text-sm" style={{ color: "var(--admin-ink)" }}>Atsinaujina: 2026-09-15</p>
          <div>
            <AdminButton variant="primary">Valdyti atsiskaitymus</AdminButton>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {PLANS.map((p) => (
          <div key={p.id} className="admin-card flex flex-col gap-3 p-5" style={{ borderColor: "var(--admin-brand)" }}>
            <div className="text-sm font-semibold" style={{ color: "var(--admin-ink)" }}>{p.name}</div>
            <p className="display text-2xl font-semibold tracking-tight" style={{ color: "var(--admin-ink)" }}>
              {p.price}
              <span className="text-sm font-normal" style={{ color: "var(--admin-ink-soft)" }}> / mėn.</span>
            </p>
            <div>
              <AdminButton size="sm">Prenumeruoti</AdminButton>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
