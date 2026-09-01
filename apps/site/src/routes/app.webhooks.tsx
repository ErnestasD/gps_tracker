import { createFileRoute } from "@tanstack/react-router";
import { Plus, Trash2, Webhook as WebhookIcon } from "lucide-react";
import * as React from "react";
import { AdminButton, AdminCheckbox, AdminInput, AdminLabel, AdminSwitch, Badge, PageHeader } from "@/components/admin/AdminKit";
import { Sheet, SheetContent, SheetFooter, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { fmtDateTime } from "@/lib/admin-format";

export const Route = createFileRoute("/app/webhooks")({
  component: WebhooksPage,
});

// Mirrors apps/web/src/routes/app/webhooks.tsx (E06-4 UI, ADR-028 round 2) with the hardcoded
// LT strings from apps/web/src/i18n/lt.json: create form in a right Sheet (URL + event-kind
// checkbox chips), show-once signing-secret banner, tile rows (icon chip, mono URL, kind
// badges, AdminSwitch, danger delete) and the recent-deliveries table. Local demo state.

const KIND_LABELS: Record<string, string> = {
  geofence: "Geozona",
  overspeed: "Greičio viršijimas",
  ignition: "Uždegimas",
  din_change: "Įvesties pokytis",
  power_cut: "Maitinimo nutrūkimas",
  low_battery: "Žema baterija",
  panic: "Pavojaus mygtukas",
  device_offline: "Įrenginys neprisijungęs",
  fuel_theft: "Kuro vagystė",
};

const EVENT_KINDS = Object.keys(KIND_LABELS);

type DemoHook = { id: string; url: string; events: string[]; enabled: boolean };

const INITIAL_HOOKS: DemoHook[] = [
  { id: "w1", url: "https://erp.klientas.lt/orbetra/webhook", events: ["geofence", "panic"], enabled: true },
  { id: "w2", url: "https://hooks.slack.com/services/T024F/B99/xxxx", events: ["overspeed", "power_cut", "device_offline"], enabled: true },
  { id: "w3", url: "https://staging.klientas.lt/hook", events: [], enabled: false },
];

type DemoDelivery = { id: string; at: string; kind: string; success: boolean; statusCode: number | null };

const DELIVERIES: DemoDelivery[] = [
  { id: "d1", at: "2026-08-31T14:32:00Z", kind: "geofence", success: true, statusCode: 200 },
  { id: "d2", at: "2026-08-31T13:07:00Z", kind: "overspeed", success: true, statusCode: 200 },
  { id: "d3", at: "2026-08-31T11:48:00Z", kind: "panic", success: true, statusCode: 204 },
  { id: "d4", at: "2026-08-30T22:15:00Z", kind: "device_offline", success: false, statusCode: 500 },
  { id: "d5", at: "2026-08-30T18:02:00Z", kind: "power_cut", success: false, statusCode: null },
  { id: "d6", at: "2026-08-30T09:26:00Z", kind: "geofence", success: true, statusCode: 200 },
];

const DEMO_SECRET = "3f9c1b7a4e2d8f60b5a9c3e7d1f4a8b2c6e0d9f3a7b1c5e8d2f6a0b4c8e1d5f9";

const th = "px-4 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wider";
const thStyle: React.CSSProperties = { color: "var(--admin-ink-soft)" };

function WebhooksPage() {
  const [hooks, setHooks] = React.useState<DemoHook[]>(INITIAL_HOOKS);
  const [addOpen, setAddOpen] = React.useState(false);
  const [freshSecret, setFreshSecret] = React.useState<string | null>(null);
  const [url, setUrl] = React.useState("");
  const [kinds, setKinds] = React.useState<string[]>([]);

  const toggleKind = (k: string) => setKinds((cur) => (cur.includes(k) ? cur.filter((x) => x !== k) : [...cur, k]));
  const validUrl = /^https?:\/\/.+/.test(url.trim());

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!validUrl) return;
    setHooks((all) => [...all, { id: `w${Date.now()}`, url: url.trim(), events: kinds, enabled: true }]);
    setFreshSecret(DEMO_SECRET);
    setUrl("");
    setKinds([]);
    setAddOpen(false);
  };

  return (
    <div className="space-y-4 p-4 md:p-8">
      <PageHeader className="mb-0" title="Webhooks" description="HTTP kanalai pasirašytiems įvykiams siųsti į išorines sistemas.">
        <Sheet open={addOpen} onOpenChange={setAddOpen}>
          <SheetTrigger asChild>
            <AdminButton>
              <Plus className="h-4 w-4" aria-hidden />
              Pridėti webhook
            </AdminButton>
          </SheetTrigger>
          <SheetContent side="right" className="w-full overflow-y-auto sm:max-w-md">
            <SheetHeader>
              <SheetTitle>Naujas webhook</SheetTitle>
            </SheetHeader>
            <form onSubmit={submit} className="mt-2 flex flex-col gap-3">
              <div>
                <AdminLabel htmlFor="webhook-url">Endpoint URL</AdminLabel>
                <AdminInput id="webhook-url" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://…" className="w-full" />
              </div>
              <div>
                <div className="mb-1 text-xs font-medium" style={{ color: "var(--admin-ink-soft)" }}>
                  Įvykiai <span className="opacity-70">(nieko = visi tipai)</span>
                </div>
                <div className="flex flex-wrap gap-2">
                  {EVENT_KINDS.map((k) => {
                    const on = kinds.includes(k);
                    return (
                      <div
                        key={k}
                        className="flex items-center rounded-md border px-2 py-1 text-xs transition-colors"
                        style={{
                          borderColor: on ? "var(--admin-brand)" : "var(--admin-hairline)",
                          background: on ? "var(--admin-brand-soft)" : "var(--admin-surface)",
                          color: "var(--admin-ink)",
                        }}
                      >
                        <AdminCheckbox checked={on} onCheckedChange={() => toggleKind(k)} label={KIND_LABELS[k]} />
                      </div>
                    );
                  })}
                </div>
              </div>
              <SheetFooter className="mt-2">
                <AdminButton type="button" variant="secondary" onClick={() => setAddOpen(false)}>Atšaukti</AdminButton>
                <AdminButton type="submit" disabled={!validUrl}>Sukurti</AdminButton>
              </SheetFooter>
            </form>
          </SheetContent>
        </Sheet>
      </PageHeader>

      {freshSecret !== null && (
        <div className="admin-card p-4" style={{ background: "var(--admin-brand-soft)", borderColor: "var(--admin-brand)" }}>
          <div className="mb-2 text-sm font-semibold" style={{ color: "var(--admin-ink)" }}>Webhook sukurtas</div>
          <p className="mb-2 text-sm" style={{ color: "var(--admin-warning)" }}>
            Nukopijuokite pasirašymo raktą dabar — jis tikrina X-Signature ir rodomas tik vieną kartą.
          </p>
          <code
            className="mono block overflow-x-auto rounded-md border p-2 text-xs"
            style={{ borderColor: "var(--admin-hairline)", background: "var(--admin-surface)", color: "var(--admin-ink)" }}
          >
            {freshSecret}
          </code>
          <AdminButton size="sm" variant="ghost" className="mt-2" onClick={() => setFreshSecret(null)}>Gerai</AdminButton>
        </div>
      )}

      <div className="admin-card overflow-hidden">
        <div className="admin-hairline-b px-4 py-3 text-sm font-semibold" style={{ color: "var(--admin-ink)" }}>
          Webhooks
        </div>
        {hooks.length === 0 ? (
          <p className="px-4 py-8 text-center text-sm" style={{ color: "var(--admin-ink-soft)" }}>Webhook’ų dar nėra.</p>
        ) : (
          <ul>
            {hooks.map((w) => (
              <li key={w.id} className="admin-hairline-b flex flex-wrap items-center gap-3 p-4 text-sm last:border-b-0">
                <div
                  className="grid h-9 w-9 shrink-0 place-items-center rounded-lg"
                  style={
                    w.enabled
                      ? { background: "var(--admin-brand-soft)", color: "var(--admin-brand)" }
                      : { background: "var(--admin-surface-sunken)", color: "var(--admin-ink-soft)" }
                  }
                  aria-hidden
                >
                  <WebhookIcon className="h-4 w-4" />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="mono truncate text-sm" style={{ color: "var(--admin-ink)" }}>{w.url}</div>
                  <div className="mt-1 flex flex-wrap gap-1">
                    {w.events.length === 0 ? (
                      <Badge tone="neutral">visi tipai</Badge>
                    ) : (
                      w.events.map((k) => <Badge key={k} tone="neutral">{KIND_LABELS[k] ?? k}</Badge>)
                    )}
                  </div>
                </div>
                <AdminSwitch
                  checked={w.enabled}
                  onCheckedChange={(v) => setHooks((all) => all.map((x) => (x.id === w.id ? { ...x, enabled: v } : x)))}
                  label="Įjungta"
                />
                <button
                  type="button"
                  aria-label="Ištrinti"
                  className="grid h-8 w-8 place-items-center rounded-md transition-colors hover:bg-[var(--admin-danger-soft)]"
                  style={{ color: "var(--admin-danger)" }}
                  onClick={() => setHooks((all) => all.filter((x) => x.id !== w.id))}
                >
                  <Trash2 className="h-4 w-4" aria-hidden />
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="admin-card overflow-hidden">
        <div className="admin-hairline-b px-4 py-3 text-sm font-semibold" style={{ color: "var(--admin-ink)" }}>
          Paskutiniai pristatymai
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr style={{ background: "var(--admin-surface-sunken)" }}>
                <th className={th} style={thStyle}>Kada</th>
                <th className={th} style={thStyle}>Įvykis</th>
                <th className={th} style={thStyle}>Būsena</th>
              </tr>
            </thead>
            <tbody>
              {DELIVERIES.map((d) => (
                <tr key={d.id} className="admin-hairline-b transition-colors last:border-b-0 hover:bg-[var(--admin-surface-sunken)]">
                  <td className="px-4 py-2.5 tabular-nums" style={{ color: "var(--admin-ink-soft)" }}>{fmtDateTime(d.at)}</td>
                  <td className="px-4 py-2.5" style={{ color: "var(--admin-ink)" }}>{KIND_LABELS[d.kind] ?? d.kind}</td>
                  <td className="px-4 py-2.5">
                    <Badge tone={d.success ? "success" : "danger"}>
                      {d.success ? "✓" : "✗"} {d.statusCode ?? "nėra atsakymo"}
                    </Badge>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
