import { createFileRoute } from "@tanstack/react-router";
import * as React from "react";
import { useTranslation } from "react-i18next";
import { MoreHorizontal, Plus, Trash2 } from "lucide-react";
import { PageHeader, AdminButton, AdminSwitch, Badge } from "@/components/admin/AdminKit";
import { contentFor } from "@/lib/demo-content";

export const Route = createFileRoute("/app/rules")({
  component: RulesPage,
});

// ── Demo mirror of the real app/rules page (Lovable card rows, kind Badge + toggle) ──

type RuleKind = "overspeed" | "geofence" | "fuel_theft";

type DemoRule = {
  id: string;
  kind: RuleKind;
  name: string;
  cooldownS: number;
  /** channel chips exactly as the real page renders them: "webpush" → localized label,
   * email → the address itself, telegram → "Telegram {chatId}" */
  channels: string[];
  enabled: boolean;
};

// The rule names and the dispatch mailbox are things the OPERATOR typed, so they are in the
// operator's language — a German fleet does not have a rule called "Saldėnės geozona".
const RULE_OVERSPEED = "@overspeed";
const RULE_GEOFENCE = "@geofence";
const RULE_FUEL = "@fuel";
const DISPATCH_EMAIL = "@dispatch";

function localizeRule(r: DemoRule, lang: string): DemoRule {
  const c = contentFor(lang);
  const names: Record<string, string> = { [RULE_OVERSPEED]: c.rules.overspeed, [RULE_GEOFENCE]: c.rules.geofence, [RULE_FUEL]: c.rules.fuel };
  return {
    ...r,
    name: names[r.name] ?? r.name,
    channels: r.channels.map((ch) => (ch === DISPATCH_EMAIL ? c.dispatchEmail : ch)),
  };
}

const RULES: DemoRule[] = [
  {
    id: "rule_overspeed",
    kind: "overspeed",
    name: RULE_OVERSPEED,
    cooldownS: 300,
    channels: ["webpush"],
    enabled: true,
  },
  {
    id: "rule_geofence",
    kind: "geofence",
    name: RULE_GEOFENCE,
    cooldownS: 300,
    channels: ["webpush", DISPATCH_EMAIL],
    enabled: true,
  },
  {
    id: "rule_fuel",
    kind: "fuel_theft",
    name: RULE_FUEL,
    cooldownS: 600,
    channels: ["webpush"],
    enabled: true,
  },
];

function RulesPage() {
  const { t, i18n } = useTranslation("admin");
  const lang = i18n.language;
  const [rules, setRules] = React.useState<DemoRule[]>(() => RULES.map((r) => localizeRule(r, lang)));
  React.useEffect(() => setRules(RULES.map((r) => localizeRule(r, lang))), [lang]);

  const channelLabel = (c: string): string => (c === "webpush" ? t("rules.channels.webpush") : c);

  return (
    <div className="space-y-4 p-4 md:p-8">
      <PageHeader title={t("rules.title")} description={t("rules.desc")} className="mb-0">
        <AdminButton>
          <Plus className="h-4 w-4" aria-hidden />
          {t("rules.add")}
        </AdminButton>
      </PageHeader>

      <section className="space-y-2">
        <h2 className="text-sm font-semibold" style={{ color: "var(--admin-ink)" }}>{t("rules.list")}</h2>
        {rules.length === 0 ? (
          <div className="admin-card">
            <p className="py-10 text-center text-sm" style={{ color: "var(--admin-ink-soft)" }}>{t("rules.empty")}</p>
          </div>
        ) : (
          <ul className="flex flex-col gap-2">
            {rules.map((r) => (
              <li key={r.id} className="admin-card flex flex-wrap items-center gap-3 p-3 md:p-4">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <Badge tone="brand">{t(`rules.kind.${r.kind}`)}</Badge>
                    <span className="truncate text-sm font-semibold" style={{ color: "var(--admin-ink)" }}>{r.name}</span>
                  </div>
                  <div className="mt-1 text-xs" style={{ color: "var(--admin-ink-soft)" }}>
                    {t("rules.cooldown")}: {r.cooldownS} s
                  </div>
                </div>
                {r.channels.length > 0 ? (
                  <div className="flex flex-wrap gap-1">
                    {r.channels.map((c) => <Badge key={c} tone="neutral">{channelLabel(c)}</Badge>)}
                  </div>
                ) : (
                  <span className="text-xs" style={{ color: "var(--admin-warning)" }}>{t("rules.channels.none")}</span>
                )}
                <AdminSwitch
                  checked={r.enabled}
                  label={t("rules.enabled")}
                  onCheckedChange={(v) => setRules((rs) => rs.map((x) => (x.id === r.id ? { ...x, enabled: v } : x)))}
                />
                <button
                  type="button"
                  aria-label={t("rules.delete")}
                  className="grid h-8 w-8 place-items-center rounded-md transition-colors hover:bg-[var(--admin-danger-soft)]"
                  style={{ color: "var(--admin-danger)" }}
                  onClick={() => setRules((rs) => rs.filter((x) => x.id !== r.id))}
                >
                  <Trash2 className="h-4 w-4" aria-hidden />
                </button>
                <button
                  type="button"
                  aria-label={t("rules.actions")}
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
