import { createFileRoute } from "@tanstack/react-router";
import { KeyRound, Plus, Trash2 } from "lucide-react";
import * as React from "react";
import { useTranslation } from "react-i18next";
import { AdminButton, AdminInput, AdminLabel, Badge, EmptyState, PageHeader } from "@/components/admin/AdminKit";
import { Combobox } from "@/components/admin/Combobox";
import { Sheet, SheetContent, SheetFooter, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { fmtDateTime } from "@/lib/admin-format";
import { LANGUAGES, type Lang } from "@/lib/i18n";

export const Route = createFileRoute("/app/api-keys")({
  component: ApiKeysPage,
});

// Mirrors apps/web/src/routes/app/apiKeys.tsx (E06-3 UI, ADR-028 round 2) using the product's
// own translations (admin namespace, apiKeys.*): create form in a right Sheet (name + account
// scope Combobox), the show-once plaintext-key banner, tile rows with active/revoked badges
// and last-used, danger revoke icon-button. Demo state lives in local React state.

// Demo-only fixture names (not part of the product's i18n JSON) in all four demo languages.
const L: Record<Lang, { k1: string; k2: string; k3: string; a1: string; a2: string }> = {
  lt: { k1: "Sandėlio ERP integracija", k2: "Power BI ataskaitos", k3: "Zapier bandymas", a1: "Vilniaus filialas", a2: "Kauno filialas" },
  en: { k1: "Warehouse ERP integration", k2: "Power BI reports", k3: "Zapier trial", a1: "Vilnius branch", a2: "Kaunas branch" },
  pl: { k1: "Integracja ERP magazynu", k2: "Raporty Power BI", k3: "Test Zapier", a1: "Oddział Wilno", a2: "Oddział Kowno" },
  de: { k1: "Lager-ERP-Integration", k2: "Power-BI-Berichte", k3: "Zapier-Test", a1: "Niederlassung Vilnius", a2: "Niederlassung Kaunas" },
};

type DemoName = "k1" | "k2" | "k3";

type DemoKey = {
  id: string;
  /** literal name for keys created in the demo; seeded rows carry `demoName` instead */
  name: string;
  demoName?: DemoName;
  prefix: string;
  revokedAt: string | null;
  lastUsedAt: string | null;
};

const INITIAL_KEYS: DemoKey[] = [
  { id: "k1", name: "", demoName: "k1", prefix: "orb_live_a94fQx", revokedAt: null, lastUsedAt: "2026-08-31T09:41:00Z" },
  { id: "k2", name: "", demoName: "k2", prefix: "orb_live_71cdWm", revokedAt: null, lastUsedAt: "2026-08-28T17:05:00Z" },
  { id: "k3", name: "", demoName: "k3", prefix: "orb_live_bb02Ns", revokedAt: "2026-07-14T10:00:00Z", lastUsedAt: "2026-07-12T08:30:00Z" },
];

const DEMO_PLAINTEXT = "orb_live_9f2kQx7Lm3RtYv81uWq4Zs6NcE0aHbJd";

function ApiKeysPage() {
  const { t, i18n } = useTranslation("admin");
  const lang: Lang = LANGUAGES.includes(i18n.resolvedLanguage as Lang) ? (i18n.resolvedLanguage as Lang) : "lt";
  const l = L[lang];

  const [keys, setKeys] = React.useState<DemoKey[]>(INITIAL_KEYS);
  const [addOpen, setAddOpen] = React.useState(false);
  const [name, setName] = React.useState("");
  const [account, setAccount] = React.useState("");
  const [fresh, setFresh] = React.useState<string | null>(null);
  const [copied, setCopied] = React.useState(false);

  const accountOptions = [
    { value: "", label: t("apiKeys.tenantWide") },
    { value: "a1", label: l.a1 },
    { value: "a2", label: l.a2 },
  ];

  const copy = () => {
    if (fresh) void navigator.clipboard?.writeText(fresh).then(() => setCopied(true)).catch(() => undefined);
  };

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (name.trim() === "") return;
    setKeys((all) => [
      ...all,
      { id: `k${Date.now()}`, name: name.trim(), prefix: DEMO_PLAINTEXT.slice(0, 14), revokedAt: null, lastUsedAt: null },
    ]);
    setFresh(DEMO_PLAINTEXT);
    setCopied(false);
    setName("");
    setAccount("");
    setAddOpen(false);
  };

  return (
    <div className="space-y-4 p-4 md:p-8">
      <PageHeader className="mb-0" title={t("apiKeys.title")} description={t("apiKeys.desc")}>
        <Sheet open={addOpen} onOpenChange={setAddOpen}>
          <SheetTrigger asChild>
            <AdminButton>
              <Plus className="h-4 w-4" aria-hidden />
              {t("apiKeys.add")}
            </AdminButton>
          </SheetTrigger>
          <SheetContent side="right" className="w-full overflow-y-auto sm:max-w-md">
            <SheetHeader>
              <SheetTitle>{t("apiKeys.addTitle")}</SheetTitle>
            </SheetHeader>
            <form onSubmit={submit} className="mt-2 flex flex-col gap-3">
              <div>
                <AdminLabel htmlFor="apikey-name">{t("apiKeys.name")}</AdminLabel>
                <AdminInput id="apikey-name" value={name} onChange={(e) => setName(e.target.value)} className="w-full" />
              </div>
              <div>
                <AdminLabel htmlFor="apikey-account">{t("apiKeys.account")}</AdminLabel>
                <Combobox value={account} onChange={setAccount} options={accountOptions} />
              </div>
              <SheetFooter className="mt-2">
                <AdminButton type="button" variant="secondary" onClick={() => setAddOpen(false)}>{t("admin.cancel")}</AdminButton>
                <AdminButton type="submit" disabled={name.trim() === ""}>{t("apiKeys.create")}</AdminButton>
              </SheetFooter>
            </form>
          </SheetContent>
        </Sheet>
      </PageHeader>

      {fresh !== null && (
        <div role="status" className="admin-card p-4" style={{ background: "var(--admin-brand-soft)", borderColor: "var(--admin-brand)" }}>
          <div className="mb-2 text-sm font-semibold" style={{ color: "var(--admin-ink)" }}>{t("apiKeys.created")}</div>
          <p className="mb-2 text-sm" style={{ color: "var(--admin-warning)" }}>
            {t("apiKeys.copyNow")}
          </p>
          <div className="flex items-center gap-2">
            <code
              className="mono flex-1 overflow-x-auto rounded-md border p-2 text-xs"
              style={{ borderColor: "var(--admin-hairline)", background: "var(--admin-surface)", color: "var(--admin-ink)" }}
            >
              {fresh}
            </code>
            <AdminButton size="sm" variant="secondary" onClick={copy}>
              {copied ? t("apiKeys.copied") : t("apiKeys.copy")}
            </AdminButton>
          </div>
          <AdminButton size="sm" variant="ghost" className="mt-2" onClick={() => setFresh(null)}>{t("apiKeys.dismiss")}</AdminButton>
        </div>
      )}

      <div className="admin-card overflow-hidden">
        <div className="admin-hairline-b px-4 py-3 text-sm font-semibold" style={{ color: "var(--admin-ink)" }}>
          {t("apiKeys.list")}
        </div>
        {keys.length === 0 ? (
          <EmptyState icon={<KeyRound className="h-5 w-5" />} title={t("apiKeys.empty")} description={t("apiKeys.emptyDesc")} />
        ) : (
          <ul>
            {keys.map((k) => (
              <li key={k.id} className="admin-hairline-b flex flex-wrap items-center gap-3 p-4 text-sm last:border-b-0">
                <div
                  className="grid h-9 w-9 shrink-0 place-items-center rounded-lg"
                  style={
                    k.revokedAt !== null
                      ? { background: "var(--admin-surface-sunken)", color: "var(--admin-ink-soft)" }
                      : { background: "var(--admin-brand-soft)", color: "var(--admin-brand)" }
                  }
                >
                  <KeyRound className="h-4 w-4" />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="truncate font-medium" style={{ color: k.revokedAt !== null ? "var(--admin-ink-soft)" : "var(--admin-ink)" }}>
                    {k.demoName ? l[k.demoName] : k.name}
                  </div>
                  <div className="mono text-xs" style={{ color: "var(--admin-ink-soft)" }}>{k.prefix}…</div>
                </div>
                {k.revokedAt !== null ? <Badge tone="neutral">{t("apiKeys.revoked")}</Badge> : <Badge tone="success">{t("apiKeys.active")}</Badge>}
                <span className="text-xs" style={{ color: "var(--admin-ink-soft)" }}>
                  {k.lastUsedAt ? `${t("apiKeys.lastUsed")}: ${fmtDateTime(k.lastUsedAt)}` : t("apiKeys.neverUsed")}
                </span>
                {k.revokedAt === null && (
                  <button
                    type="button"
                    aria-label={t("apiKeys.revoke")}
                    className="ml-auto grid h-8 w-8 place-items-center rounded-md transition-colors hover:bg-[var(--admin-danger-soft)]"
                    style={{ color: "var(--admin-danger)" }}
                    onClick={() => setKeys((all) => all.map((x) => (x.id === k.id ? { ...x, revokedAt: new Date().toISOString() } : x)))}
                  >
                    <Trash2 className="h-4 w-4" aria-hidden />
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
