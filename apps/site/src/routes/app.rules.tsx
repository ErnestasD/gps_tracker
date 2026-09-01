import { createFileRoute } from "@tanstack/react-router";
import * as React from "react";
import { MoreHorizontal, Plus, Trash2 } from "lucide-react";
import { PageHeader, AdminButton, AdminSwitch, Badge } from "@/components/admin/AdminKit";

export const Route = createFileRoute("/app/rules")({
  component: RulesPage,
});

// ── Demo mirror of the real app/rules page (Lovable card rows, kind Badge + toggle) ──

type DemoRule = {
  id: string;
  kindLabel: string;
  name: string;
  cooldownS: number;
  /** channel chips exactly as the real page renders them: webpush → localized label,
   * email → the address itself, telegram → "Telegram {chatId}" */
  channels: string[];
  enabled: boolean;
};

const RULES: DemoRule[] = [
  {
    id: "rule_overspeed",
    kindLabel: "Greičio viršijimas",
    name: "Greičio viršijimas 90",
    cooldownS: 300,
    channels: ["Naršyklės pranešimai"],
    enabled: true,
  },
  {
    id: "rule_geofence",
    kindLabel: "Geozona",
    name: "Saldėnės geozona",
    cooldownS: 300,
    channels: ["Naršyklės pranešimai", "dispecerine@transportas.lt"],
    enabled: true,
  },
  {
    id: "rule_fuel",
    kindLabel: "Kuro vagystė",
    name: "100l kuro vagystė",
    cooldownS: 600,
    channels: ["Naršyklės pranešimai"],
    enabled: true,
  },
];

function RulesPage() {
  const [rules, setRules] = React.useState<DemoRule[]>(RULES);

  return (
    <div className="space-y-4 p-4 md:p-8">
      <PageHeader title="Taisyklės" description="Automatika: signalai, pranešimai ir kanalai." className="mb-0">
        <AdminButton>
          <Plus className="h-4 w-4" aria-hidden />
          Pridėti taisyklę
        </AdminButton>
      </PageHeader>

      <section className="space-y-2">
        <h2 className="text-sm font-semibold" style={{ color: "var(--admin-ink)" }}>Taisyklės</h2>
        {rules.length === 0 ? (
          <div className="admin-card">
            <p className="py-10 text-center text-sm" style={{ color: "var(--admin-ink-soft)" }}>Taisyklių dar nėra.</p>
          </div>
        ) : (
          <ul className="flex flex-col gap-2">
            {rules.map((r) => (
              <li key={r.id} className="admin-card flex flex-wrap items-center gap-3 p-3 md:p-4">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <Badge tone="brand">{r.kindLabel}</Badge>
                    <span className="truncate text-sm font-semibold" style={{ color: "var(--admin-ink)" }}>{r.name}</span>
                  </div>
                  <div className="mt-1 text-xs" style={{ color: "var(--admin-ink-soft)" }}>
                    Atvėsimas: {r.cooldownS} s
                  </div>
                </div>
                {r.channels.length > 0 ? (
                  <div className="flex flex-wrap gap-1">
                    {r.channels.map((c) => <Badge key={c} tone="neutral">{c}</Badge>)}
                  </div>
                ) : (
                  <span className="text-xs" style={{ color: "var(--admin-warning)" }}>nėra kanalų</span>
                )}
                <AdminSwitch
                  checked={r.enabled}
                  label="Įjungta"
                  onCheckedChange={(v) => setRules((rs) => rs.map((x) => (x.id === r.id ? { ...x, enabled: v } : x)))}
                />
                <button
                  type="button"
                  aria-label="Šalinti"
                  className="grid h-8 w-8 place-items-center rounded-md transition-colors hover:bg-[var(--admin-danger-soft)]"
                  style={{ color: "var(--admin-danger)" }}
                  onClick={() => setRules((rs) => rs.filter((x) => x.id !== r.id))}
                >
                  <Trash2 className="h-4 w-4" aria-hidden />
                </button>
                <button
                  type="button"
                  aria-label="Veiksmai"
                  className="grid h-7 w-7 place-items-center rounded-md transition-colors hover:bg-[var(--admin-surface-sunken)]"
                >
                  <MoreHorizontal className="h-4 w-4" style={{ color: "var(--admin-ink-soft)" }} aria-hidden />
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
