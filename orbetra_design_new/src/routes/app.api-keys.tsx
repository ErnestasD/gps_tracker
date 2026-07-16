import { createFileRoute } from "@tanstack/react-router";
import { fmtDate, fmtDateTime } from "@/lib/admin-format";
import * as React from "react";
import { Plus, Copy, Trash2, KeyRound } from "lucide-react";
import { generateApiKeys, type ApiKey } from "@/lib/admin-mock";
import { PageHeader, AdminButton, Badge, AdminInput, AdminLabel, AdminCheckbox, EmptyState } from "@/components/admin/AdminKit";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger, SheetFooter } from "@/components/ui/sheet";
import { toast } from "sonner";

export const Route = createFileRoute("/app/api-keys")({
  component: ApiKeysPage,
});

function ApiKeysPage() {
  const [keys, setKeys] = React.useState<ApiKey[]>(generateApiKeys());
  const [open, setOpen] = React.useState(false);
  const [scopes, setScopes] = React.useState({ read: true, write: false, webhook: false });

  return (
    <div className="mx-auto max-w-6xl px-4 py-6 md:px-8 md:py-8">
      <PageHeader title="API raktai" description="Prieigos raktai integracijoms.">
        <Sheet open={open} onOpenChange={setOpen}>
          <SheetTrigger asChild><AdminButton><Plus className="h-4 w-4" />Naujas raktas</AdminButton></SheetTrigger>
          <SheetContent side="right" className="w-full sm:max-w-md">
            <SheetHeader><SheetTitle>Naujas API raktas</SheetTitle></SheetHeader>
            <form onSubmit={(e) => { e.preventDefault(); setOpen(false); toast.success("Raktas sukurtas (demo)"); }} className="mt-4 flex flex-col gap-3">
              <div><AdminLabel>Etiketė</AdminLabel><AdminInput required placeholder="pvz. Production backend" /></div>
              <div>
                <AdminLabel>Aprėptys</AdminLabel>
                <div className="flex flex-col gap-2">
                  <AdminCheckbox checked={scopes.read} onCheckedChange={(v) => setScopes((s) => ({ ...s, read: v }))} label="read — skaitymas" />
                  <AdminCheckbox checked={scopes.write} onCheckedChange={(v) => setScopes((s) => ({ ...s, write: v }))} label="write — rašymas" />
                  <AdminCheckbox checked={scopes.webhook} onCheckedChange={(v) => setScopes((s) => ({ ...s, webhook: v }))} label="webhook — kanalų valdymas" />
                </div>
              </div>
              <SheetFooter className="mt-2">
                <AdminButton type="button" variant="secondary" onClick={() => setOpen(false)}>Atšaukti</AdminButton>
                <AdminButton type="submit">Kurti</AdminButton>
              </SheetFooter>
            </form>
          </SheetContent>
        </Sheet>
      </PageHeader>

      {keys.length === 0 ? (
        <EmptyState icon={<KeyRound className="h-5 w-5" />} title="Raktų dar nėra" description="Sukurk pirmąjį raktą integracijai." />
      ) : (
        <div className="admin-card overflow-hidden">
          <ul>
            {keys.map((k) => (
              <li key={k.id} className="admin-hairline-b flex flex-wrap items-center gap-3 p-4 last:border-b-0">
                <div className="grid h-9 w-9 place-items-center rounded-lg" style={{ background: "var(--admin-brand-soft)", color: "var(--admin-brand)" }}>
                  <KeyRound className="h-4 w-4" />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="font-medium" style={{ color: "var(--admin-ink)" }}>{k.label}</div>
                  <div className="mono text-xs" style={{ color: "var(--admin-ink-soft)" }}>{k.prefix}</div>
                </div>
                <div className="flex gap-1">{k.scopes.map((s) => <Badge key={s} tone="neutral">{s}</Badge>)}</div>
                <div className="text-xs" style={{ color: "var(--admin-ink-soft)" }}>
                  Naudota: {fmtDateTime(k.lastUsed)}
                </div>
                <div className="flex gap-1">
                  <button className="grid h-8 w-8 place-items-center rounded-md hover:bg-[var(--admin-surface-sunken)]" onClick={() => toast.success("Nukopijuota")}>
                    <Copy className="h-4 w-4" />
                  </button>
                  <button className="grid h-8 w-8 place-items-center rounded-md text-[var(--admin-danger)] hover:bg-[var(--admin-danger-soft)]" onClick={() => setKeys((all) => all.filter((x) => x.id !== k.id))}>
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
