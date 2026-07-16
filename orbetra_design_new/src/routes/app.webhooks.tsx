import { createFileRoute } from "@tanstack/react-router";
import { fmtDate, fmtDateTime } from "@/lib/admin-format";
import * as React from "react";
import { Plus, Trash2, Send } from "lucide-react";
import { generateWebhooks, type Webhook } from "@/lib/admin-mock";
import { PageHeader, AdminButton, Badge, AdminInput, AdminLabel } from "@/components/admin/AdminKit";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger, SheetFooter } from "@/components/ui/sheet";
import { toast } from "sonner";

export const Route = createFileRoute("/app/webhooks")({
  component: WebhooksPage,
});

function WebhooksPage() {
  const [hooks, setHooks] = React.useState<Webhook[]>(generateWebhooks());
  const [open, setOpen] = React.useState(false);

  return (
    <div className="mx-auto max-w-6xl px-4 py-6 md:px-8 md:py-8">
      <PageHeader title="Webhooks" description="HTTP kanalai įvykiams siųsti į išorines sistemas.">
        <Sheet open={open} onOpenChange={setOpen}>
          <SheetTrigger asChild><AdminButton><Plus className="h-4 w-4" />Naujas webhook</AdminButton></SheetTrigger>
          <SheetContent side="right" className="w-full sm:max-w-md">
            <SheetHeader><SheetTitle>Naujas webhook</SheetTitle></SheetHeader>
            <form onSubmit={(e) => { e.preventDefault(); setOpen(false); toast.success("Webhook sukurtas (demo)"); }} className="mt-4 flex flex-col gap-3">
              <div><AdminLabel>URL</AdminLabel><AdminInput required placeholder="https://api.jusu.lt/hook" /></div>
              <div><AdminLabel>Įvykių filtras</AdminLabel><AdminInput placeholder="event.* arba event.sos" /></div>
              <div><AdminLabel>Slaptažodis (HMAC)</AdminLabel><AdminInput placeholder="paliktas tuščias — nesigneruojama" /></div>
              <SheetFooter className="mt-2">
                <AdminButton type="button" variant="secondary" onClick={() => setOpen(false)}>Atšaukti</AdminButton>
                <AdminButton type="submit">Kurti</AdminButton>
              </SheetFooter>
            </form>
          </SheetContent>
        </Sheet>
      </PageHeader>

      <div className="admin-card overflow-hidden">
        <ul>
          {hooks.map((h) => (
            <li key={h.id} className="admin-hairline-b p-4 last:border-b-0">
              <div className="flex flex-wrap items-center gap-3">
                <div className="min-w-0 flex-1">
                  <div className="mono truncate text-sm" style={{ color: "var(--admin-ink)" }}>{h.url}</div>
                  <div className="mt-1 flex flex-wrap gap-1">
                    {h.events.map((e) => <Badge key={e} tone="neutral">{e}</Badge>)}
                  </div>
                </div>
                <div className="text-right">
                  <Badge tone={h.status === "active" ? "success" : h.status === "failing" ? "danger" : "warning"}>{h.status}</Badge>
                  <div className="mt-1 text-xs" style={{ color: "var(--admin-ink-soft)" }}>
                    sėkmė {h.successRate}% · {fmtDateTime(h.lastDelivery)}
                  </div>
                </div>
                <div className="flex gap-1">
                  <button className="grid h-8 w-8 place-items-center rounded-md hover:bg-[var(--admin-surface-sunken)]" onClick={() => toast.success("Test įvykis išsiųstas")}>
                    <Send className="h-4 w-4" />
                  </button>
                  <button className="grid h-8 w-8 place-items-center rounded-md text-[var(--admin-danger)] hover:bg-[var(--admin-danger-soft)]" onClick={() => setHooks((all) => all.filter((x) => x.id !== h.id))}>
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              </div>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
