import * as React from "react";
import { useNavigate } from "@tanstack/react-router";
import {
  LayoutDashboard, Map as MapIcon, Car, Users, Wrench, Route as RouteIcon, History,
  Hexagon, ListChecks, Bell, BarChart3, Terminal, AlertTriangle,
  Palette, CreditCard, KeyRound, Webhook, ScrollText, Settings, Search, CornerDownLeft,
  FileText,
} from "lucide-react";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import {
  generateDevices, generateDrivers, generateTrips, generateEvents,
  generateGeofences, generateRules, generateMaintenance, generateCommands,
  generateApiKeys, generateWebhooks, generateAudit, generateInvoices,
} from "@/lib/admin-mock";

type Item = {
  to: string;
  label: string;
  hint?: string;
  group: string;
  icon: (props: { className?: string; strokeWidth?: number }) => React.ReactNode;
  keywords?: string;
};

const NAV_ITEMS: Item[] = [
  { to: "/app", label: "Apžvalga", group: "Puslapiai", icon: LayoutDashboard, keywords: "dashboard overview kpi" },
  { to: "/app/map", label: "Žemėlapis", group: "Puslapiai", icon: MapIcon, keywords: "map live realtime" },
  { to: "/app/devices", label: "Įrenginiai", group: "Puslapiai", icon: Car, keywords: "devices gps trackers" },
  { to: "/app/drivers", label: "Vairuotojai", group: "Puslapiai", icon: Users, keywords: "drivers users staff" },
  { to: "/app/maintenance", label: "Priežiūra", group: "Puslapiai", icon: Wrench, keywords: "maintenance service" },
  { to: "/app/trips", label: "Kelionės", group: "Puslapiai", icon: RouteIcon, keywords: "trips journeys" },
  { to: "/app/history", label: "Istorija", group: "Puslapiai", icon: History, keywords: "history playback" },
  { to: "/app/geofences", label: "Geozonos", group: "Puslapiai", icon: Hexagon, keywords: "geofences zones" },
  { to: "/app/rules", label: "Taisyklės", group: "Puslapiai", icon: ListChecks, keywords: "rules automation" },
  { to: "/app/events", label: "Įvykiai", group: "Puslapiai", icon: AlertTriangle, keywords: "events alerts" },
  { to: "/app/notifications", label: "Pranešimai", group: "Puslapiai", icon: Bell, keywords: "notifications inbox" },
  { to: "/app/reports", label: "Ataskaitos", group: "Puslapiai", icon: BarChart3, keywords: "reports analytics" },
  { to: "/app/commands", label: "Komandos", group: "Puslapiai", icon: Terminal, keywords: "commands console" },
  { to: "/app/branding", label: "Prekės ženklas", group: "Puslapiai", icon: Palette, keywords: "branding whitelabel" },
  { to: "/app/billing", label: "Atsiskaitymai", group: "Puslapiai", icon: CreditCard, keywords: "billing invoices" },
  { to: "/app/api-keys", label: "API raktai", group: "Puslapiai", icon: KeyRound, keywords: "api keys tokens" },
  { to: "/app/webhooks", label: "Webhooks", group: "Puslapiai", icon: Webhook, keywords: "webhooks hooks" },
  { to: "/app/audit", label: "Audito žurnalas", group: "Puslapiai", icon: ScrollText, keywords: "audit log" },
  { to: "/app/settings", label: "Nustatymai", group: "Puslapiai", icon: Settings, keywords: "settings preferences" },
];

// Build data items lazily (memoized once per palette open)
function buildDataItems(): Item[] {
  const out: Item[] = [];
  generateDevices().forEach((d) => out.push({
    to: "/app/devices", label: d.name, hint: `${d.plate} · ${d.driver} · ${d.location}`,
    group: "Įrenginiai", icon: Car, keywords: `${d.imei} ${d.plate} ${d.driver} ${d.location} ${d.status}`,
  }));
  generateDrivers().forEach((d) => out.push({
    to: "/app/drivers", label: d.name, hint: `${d.license} · ${d.vehicle}`,
    group: "Vairuotojai", icon: Users, keywords: `${d.phone} ${d.license} ${d.vehicle} ${d.status}`,
  }));
  generateTrips().slice(0, 30).forEach((t) => out.push({
    to: "/app/trips", label: `${t.from} → ${t.to}`, hint: `${t.device} · ${t.distance} km · ${t.driver}`,
    group: "Kelionės", icon: RouteIcon, keywords: `${t.id} ${t.device} ${t.driver}`,
  }));
  generateEvents().slice(0, 40).forEach((e) => out.push({
    to: "/app/events", label: e.detail, hint: `${e.device} · ${e.severity}`,
    group: "Įvykiai", icon: AlertTriangle, keywords: `${e.type} ${e.device} ${e.driver} ${e.severity}`,
  }));
  generateGeofences().forEach((g) => out.push({
    to: "/app/geofences", label: g.name, hint: `${g.type} · ${g.devices} įreng.`,
    group: "Geozonos", icon: Hexagon, keywords: `${g.type}`,
  }));
  generateRules().forEach((r) => out.push({
    to: "/app/rules", label: r.name, hint: `${r.type} · ${r.scope}`,
    group: "Taisyklės", icon: ListChecks, keywords: `${r.type} ${r.scope} ${r.channels.join(" ")}`,
  }));
  generateMaintenance().forEach((m) => out.push({
    to: "/app/maintenance", label: `${m.device} — ${m.service}`, hint: `${m.status} · ${m.dueKm.toLocaleString()} km`,
    group: "Priežiūra", icon: Wrench, keywords: `${m.service} ${m.status}`,
  }));
  generateCommands().forEach((c) => out.push({
    to: "/app/commands", label: `${c.command} → ${c.device}`, hint: `${c.status} · ${c.operator}`,
    group: "Komandos", icon: Terminal, keywords: `${c.command} ${c.status} ${c.operator}`,
  }));
  generateApiKeys().forEach((k) => out.push({
    to: "/app/api-keys", label: k.label, hint: `${k.prefix} · ${k.scopes.join(", ")}`,
    group: "API raktai", icon: KeyRound, keywords: `${k.prefix} ${k.scopes.join(" ")}`,
  }));
  generateWebhooks().forEach((w) => out.push({
    to: "/app/webhooks", label: w.url, hint: `${w.status} · ${w.successRate}%`,
    group: "Webhooks", icon: Webhook, keywords: `${w.events.join(" ")} ${w.status}`,
  }));
  generateAudit().slice(0, 30).forEach((a) => out.push({
    to: "/app/audit", label: `${a.action}`, hint: `${a.actor} · ${a.target}`,
    group: "Audito žurnalas", icon: ScrollText, keywords: `${a.actor} ${a.target} ${a.ip}`,
  }));
  generateInvoices().forEach((i) => out.push({
    to: "/app/billing", label: i.number, hint: `${i.period} · ${i.amount} € · ${i.status}`,
    group: "Sąskaitos", icon: FileText, keywords: `${i.status} ${i.period}`,
  }));
  return out;
}

export function CommandPalette({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  const navigate = useNavigate();
  const [q, setQ] = React.useState("");
  const [active, setActive] = React.useState(0);
  const inputRef = React.useRef<HTMLInputElement>(null);
  const listRef = React.useRef<HTMLDivElement>(null);

  const dataItems = React.useMemo(() => (open ? buildDataItems() : []), [open]);
  const allItems = React.useMemo(() => [...NAV_ITEMS, ...dataItems], [dataItems]);

  React.useEffect(() => {
    if (open) {
      setQ("");
      setActive(0);
      setTimeout(() => inputRef.current?.focus(), 30);
    }
  }, [open]);

  const filtered = React.useMemo(() => {
    const ql = q.trim().toLowerCase();
    if (!ql) return NAV_ITEMS; // empty query → show pages only
    return allItems.filter((i) =>
      (i.label + " " + (i.hint ?? "") + " " + i.group + " " + (i.keywords ?? "")).toLowerCase().includes(ql),
    ).slice(0, 80);
  }, [q, allItems]);

  React.useEffect(() => {
    setActive(0);
  }, [q]);

  const go = (to: string) => {
    onOpenChange(false);
    void navigate({ to });
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((a) => Math.min(filtered.length - 1, a + 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((a) => Math.max(0, a - 1));
    } else if (e.key === "Enter") {
      e.preventDefault();
      const item = filtered[active];
      if (item) go(item.to);
    }
  };

  // group results preserving insertion order
  const grouped = React.useMemo(() => {
    const map = new Map<string, Item[]>();
    filtered.forEach((i) => {
      if (!map.has(i.group)) map.set(i.group, []);
      map.get(i.group)!.push(i);
    });
    return Array.from(map.entries());
  }, [filtered]);

  React.useEffect(() => {
    const el = listRef.current?.querySelector<HTMLElement>(`[data-idx="${active}"]`);
    el?.scrollIntoView({ block: "nearest" });
  }, [active]);

  let idx = -1;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        aria-describedby={undefined}
        className="top-[15%] max-w-xl translate-y-0 gap-0 overflow-hidden p-0 !opacity-100 !animate-none [&>button]:hidden"
        style={{ background: "var(--admin-surface)", borderColor: "var(--admin-hairline)", color: "var(--admin-ink)" }}
      >
        <div className="admin-hairline-b flex items-center gap-2 px-4 py-3">
          <Search className="h-4 w-4 opacity-60" />
          <input
            ref={inputRef}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder="Ieškoti puslapio, įrenginio, vairuotojo, įvykio…"
            className="w-full bg-transparent text-sm outline-none placeholder:opacity-60"
            style={{ color: "var(--admin-ink)" }}
          />
          <kbd
            className="mono hidden h-5 items-center rounded border px-1.5 text-[10px] sm:inline-flex"
            style={{ borderColor: "var(--admin-hairline)", color: "var(--admin-ink-soft)" }}
          >
            ESC
          </kbd>
        </div>

        <div ref={listRef} className="max-h-[60vh] overflow-y-auto p-2">
          {filtered.length === 0 && (
            <div className="px-4 py-12 text-center text-sm" style={{ color: "var(--admin-ink-soft)" }}>
              Nieko nerasta pagal „{q}"
            </div>
          )}
          {grouped.map(([group, items]) => (
            <div key={group} className="mb-2">
              <div
                className="px-2 pb-1 pt-2 text-[10px] font-semibold uppercase tracking-widest"
                style={{ color: "var(--admin-ink-soft)" }}
              >
                {group}
              </div>
              <ul>
                {items.map((it) => {
                  idx++;
                  const isActive = idx === active;
                  const Icon = it.icon;
                  const myIdx = idx;
                  return (
                    <li key={`${it.group}-${myIdx}`}>
                      <button
                        type="button"
                        data-idx={myIdx}
                        onMouseEnter={() => setActive(myIdx)}
                        onClick={() => go(it.to)}
                        className="flex w-full cursor-pointer items-center gap-2.5 rounded-md px-2.5 py-2 text-left text-sm"
                        style={{
                          background: isActive ? "var(--admin-brand-soft)" : "transparent",
                          color: isActive ? "var(--admin-brand)" : "var(--admin-ink)",
                        }}
                      >
                        <Icon className="h-4 w-4 shrink-0" strokeWidth={1.8} />
                        <span className="min-w-0 flex-1 truncate">
                          <span className="truncate">{it.label}</span>
                          {it.hint && (
                            <span className="ml-2 text-[11px]" style={{ color: "var(--admin-ink-soft)" }}>
                              {it.hint}
                            </span>
                          )}
                        </span>
                        {isActive && <CornerDownLeft className="h-3.5 w-3.5 shrink-0 opacity-70" />}
                      </button>
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
        </div>

        <div
          className="admin-hairline-t flex items-center justify-between px-4 py-2 text-[11px]"
          style={{ color: "var(--admin-ink-soft)" }}
        >
          <div className="flex items-center gap-3">
            <span><kbd className="mono">↑</kbd> <kbd className="mono">↓</kbd> naršyti</span>
            <span><kbd className="mono">↵</kbd> atidaryti</span>
          </div>
          <span>{filtered.length} rezultatai</span>
        </div>
      </DialogContent>
    </Dialog>
  );
}
