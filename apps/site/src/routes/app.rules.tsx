import { createFileRoute } from "@tanstack/react-router";
import * as React from "react";
import { Plus, Trash2 } from "lucide-react";
import { generateRules, type Rule } from "@/lib/admin-mock";
import { PageHeader, AdminButton, Badge, AdminInput, AdminLabel, AdminSwitch, AdminCheckbox } from "@/components/admin/AdminKit";
import { Combobox } from "@/components/admin/Combobox";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger, SheetFooter } from "@/components/ui/sheet";
import { toast } from "sonner";

export const Route = createFileRoute("/app/rules")({
  component: RulesPage,
});

function RulesPage() {
  const [rules, setRules] = React.useState<Rule[]>(generateRules());
  const [open, setOpen] = React.useState(false);
  const [type, setType] = React.useState("speeding");
  const [channels, setChannels] = React.useState({ email: true, sms: false, webhook: false });

  return (
    <div className="mx-auto max-w-7xl px-4 py-6 md:px-8 md:py-8">
      <PageHeader title="Taisyklės" description="Automatika: signalai, pranešimai ir kanalai.">
        <Sheet open={open} onOpenChange={setOpen}>
          <SheetTrigger asChild><AdminButton><Plus className="h-4 w-4" />Nauja taisyklė</AdminButton></SheetTrigger>
          <SheetContent side="right" className="w-full sm:max-w-md">
            <SheetHeader><SheetTitle>Nauja taisyklė</SheetTitle></SheetHeader>
            <form onSubmit={(e) => { e.preventDefault(); setOpen(false); toast.success("Taisyklė sukurta (demo)"); }} className="mt-4 flex flex-col gap-3">
              <div><AdminLabel>Pavadinimas</AdminLabel><AdminInput required /></div>
              <div>
                <AdminLabel>Tipas</AdminLabel>
                <Combobox
                  value={type}
                  onChange={setType}
                  options={[
                    { value: "speeding", label: "Greičio viršijimas" },
                    { value: "offline", label: "Įrenginys neprisijungęs" },
                    { value: "panic", label: "Pavojaus mygtukas" },
                    { value: "geofence", label: "Geozonos įvykis" },
                    { value: "idle", label: "Ilgas idle" },
                  ]}
                />
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div><AdminLabel>Greitis (km/h)</AdminLabel><AdminInput type="number" defaultValue={90} /></div>
                <div><AdminLabel>Atvėsimas (s)</AdminLabel><AdminInput type="number" defaultValue={300} /></div>
              </div>
              <div>
                <AdminLabel>Kanalai</AdminLabel>
                <div className="flex flex-col gap-2">
                  <AdminCheckbox checked={channels.email} onCheckedChange={(v) => setChannels((c) => ({ ...c, email: v }))} label="El. paštas" />
                  <AdminCheckbox checked={channels.sms} onCheckedChange={(v) => setChannels((c) => ({ ...c, sms: v }))} label="SMS" />
                  <AdminCheckbox checked={channels.webhook} onCheckedChange={(v) => setChannels((c) => ({ ...c, webhook: v }))} label="Webhook" />
                </div>
              </div>
              <SheetFooter className="mt-2">
                <AdminButton type="button" variant="secondary" onClick={() => setOpen(false)}>Atšaukti</AdminButton>
                <AdminButton type="submit">Sukurti</AdminButton>
              </SheetFooter>
            </form>
          </SheetContent>
        </Sheet>
      </PageHeader>

      <div className="flex flex-col gap-2">
        {rules.map((r) => (
          <div key={r.id} className="admin-card flex flex-wrap items-center gap-3 p-4">
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <Badge tone="brand">{r.type}</Badge>
                <span className="truncate font-semibold" style={{ color: "var(--admin-ink)" }}>{r.name}</span>
              </div>
              <div className="mt-1 flex flex-wrap items-center gap-3 text-xs" style={{ color: "var(--admin-ink-soft)" }}>
                <span>Atvėsimas: {r.cooldown}s</span>
                <span>·</span>
                <span>Aprėptis: {r.scope}</span>
                <span>·</span>
                <span>Trigeriai (30d): {r.triggered}</span>
              </div>
            </div>
            <div className="flex items-center gap-2">
              {r.channels.map((c) => <Badge key={c} tone="neutral">{c}</Badge>)}
            </div>
            <AdminSwitch
              checked={r.enabled}
              onCheckedChange={(v) => setRules((rs) => rs.map((x) => (x.id === r.id ? { ...x, enabled: v } : x)))}
              label={r.enabled ? "Įjungta" : "Išjungta"}
            />
            <button className="grid h-8 w-8 place-items-center rounded-md text-[var(--admin-danger)] hover:bg-[var(--admin-danger-soft)]" onClick={() => setRules((rs) => rs.filter((x) => x.id !== r.id))} aria-label="Šalinti">
              <Trash2 className="h-4 w-4" />
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
