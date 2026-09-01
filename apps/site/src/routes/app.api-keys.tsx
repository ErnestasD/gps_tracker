import { createFileRoute } from "@tanstack/react-router";
import { KeyRound, Plus, Trash2 } from "lucide-react";
import * as React from "react";
import { AdminButton, AdminInput, AdminLabel, Badge, EmptyState, PageHeader } from "@/components/admin/AdminKit";
import { Combobox } from "@/components/admin/Combobox";
import { Sheet, SheetContent, SheetFooter, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { fmtDateTime } from "@/lib/admin-format";

export const Route = createFileRoute("/app/api-keys")({
  component: ApiKeysPage,
});

// Mirrors apps/web/src/routes/app/apiKeys.tsx (E06-3 UI, ADR-028 round 2) with the hardcoded
// LT strings from apps/web/src/i18n/lt.json: create form in a right Sheet (name + account
// scope Combobox), the show-once plaintext-key banner, tile rows with Aktyvus/Atšauktas
// badges and last-used, danger revoke icon-button. Demo state lives in local React state.

type DemoKey = {
  id: string;
  name: string;
  prefix: string;
  revokedAt: string | null;
  lastUsedAt: string | null;
};

const INITIAL_KEYS: DemoKey[] = [
  { id: "k1", name: "Sandėlio ERP integracija", prefix: "orb_live_a94fQx", revokedAt: null, lastUsedAt: "2026-08-31T09:41:00Z" },
  { id: "k2", name: "Power BI ataskaitos", prefix: "orb_live_71cdWm", revokedAt: null, lastUsedAt: "2026-08-28T17:05:00Z" },
  { id: "k3", name: "Zapier bandymas", prefix: "orb_live_bb02Ns", revokedAt: "2026-07-14T10:00:00Z", lastUsedAt: "2026-07-12T08:30:00Z" },
];

const DEMO_PLAINTEXT = "orb_live_9f2kQx7Lm3RtYv81uWq4Zs6NcE0aHbJd";

const ACCOUNT_OPTIONS = [
  { value: "", label: "Visos paskyros" },
  { value: "a1", label: "Vilniaus filialas" },
  { value: "a2", label: "Kauno filialas" },
];

function ApiKeysPage() {
  const [keys, setKeys] = React.useState<DemoKey[]>(INITIAL_KEYS);
  const [addOpen, setAddOpen] = React.useState(false);
  const [name, setName] = React.useState("");
  const [account, setAccount] = React.useState("");
  const [fresh, setFresh] = React.useState<string | null>(null);
  const [copied, setCopied] = React.useState(false);

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
      <PageHeader className="mb-0" title="API raktai" description="Prieigos raktai integracijoms.">
        <Sheet open={addOpen} onOpenChange={setAddOpen}>
          <SheetTrigger asChild>
            <AdminButton>
              <Plus className="h-4 w-4" aria-hidden />
              Sukurti raktą
            </AdminButton>
          </SheetTrigger>
          <SheetContent side="right" className="w-full overflow-y-auto sm:max-w-md">
            <SheetHeader>
              <SheetTitle>Naujas API raktas</SheetTitle>
            </SheetHeader>
            <form onSubmit={submit} className="mt-2 flex flex-col gap-3">
              <div>
                <AdminLabel htmlFor="apikey-name">Pavadinimas</AdminLabel>
                <AdminInput id="apikey-name" value={name} onChange={(e) => setName(e.target.value)} className="w-full" />
              </div>
              <div>
                <AdminLabel htmlFor="apikey-account">Paskyra</AdminLabel>
                <Combobox value={account} onChange={setAccount} options={ACCOUNT_OPTIONS} />
              </div>
              <SheetFooter className="mt-2">
                <AdminButton type="button" variant="secondary" onClick={() => setAddOpen(false)}>Atšaukti</AdminButton>
                <AdminButton type="submit" disabled={name.trim() === ""}>Sukurti</AdminButton>
              </SheetFooter>
            </form>
          </SheetContent>
        </Sheet>
      </PageHeader>

      {fresh !== null && (
        <div role="status" className="admin-card p-4" style={{ background: "var(--admin-brand-soft)", borderColor: "var(--admin-brand)" }}>
          <div className="mb-2 text-sm font-semibold" style={{ color: "var(--admin-ink)" }}>Raktas sukurtas</div>
          <p className="mb-2 text-sm" style={{ color: "var(--admin-warning)" }}>
            Nukopijuokite raktą dabar — jis rodomas tik vieną kartą ir vėliau nebus prieinamas.
          </p>
          <div className="flex items-center gap-2">
            <code
              className="mono flex-1 overflow-x-auto rounded-md border p-2 text-xs"
              style={{ borderColor: "var(--admin-hairline)", background: "var(--admin-surface)", color: "var(--admin-ink)" }}
            >
              {fresh}
            </code>
            <AdminButton size="sm" variant="secondary" onClick={copy}>
              {copied ? "Nukopijuota" : "Kopijuoti"}
            </AdminButton>
          </div>
          <AdminButton size="sm" variant="ghost" className="mt-2" onClick={() => setFresh(null)}>Gerai</AdminButton>
        </div>
      )}

      <div className="admin-card overflow-hidden">
        <div className="admin-hairline-b px-4 py-3 text-sm font-semibold" style={{ color: "var(--admin-ink)" }}>
          Raktai
        </div>
        {keys.length === 0 ? (
          <EmptyState icon={<KeyRound className="h-5 w-5" />} title="API raktų dar nėra." description="Sukurkite pirmąjį raktą integracijai." />
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
                    {k.name}
                  </div>
                  <div className="mono text-xs" style={{ color: "var(--admin-ink-soft)" }}>{k.prefix}…</div>
                </div>
                {k.revokedAt !== null ? <Badge tone="neutral">Atšauktas</Badge> : <Badge tone="success">Aktyvus</Badge>}
                <span className="text-xs" style={{ color: "var(--admin-ink-soft)" }}>
                  {k.lastUsedAt ? `naudotas: ${fmtDateTime(k.lastUsedAt)}` : "nenaudotas"}
                </span>
                {k.revokedAt === null && (
                  <button
                    type="button"
                    aria-label="Atšaukti"
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
