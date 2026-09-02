import * as React from "react";
import { useNavigate } from "@tanstack/react-router";
import {
  LayoutDashboard, Map as MapIcon, Car, Users, Wrench, Route as RouteIcon, History,
  Hexagon, ListChecks, Bell, BarChart3, Terminal, AlertTriangle,
  Palette, CreditCard, KeyRound, Webhook, ScrollText, Settings, Search, CornerDownLeft,
  FileText,
} from "lucide-react";
import type { TFunction } from "i18next";
import { useTranslation } from "react-i18next";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import {
  generateDevices, generateDrivers, generateTrips,
  generateRules, generateMaintenance, generateCommands,
  generateApiKeys, generateWebhooks, generateAudit, generateInvoices,
} from "@/lib/admin-mock";
import { demoDetail, deviceName, localizeEvents } from "@/lib/demo-events";
import { contentFor } from "@/lib/demo-content";
import { demoZones } from "@/lib/demo-zones";

type Item = {
  to: string;
  label: string;
  hint?: string;
  group: string;
  icon: (props: { className?: string; strokeWidth?: number }) => React.ReactNode;
  keywords?: string;
};

/**
 * Page targets. `label` is a KEY — the palette used to hold Lithuanian literals ("Apžvalga",
 * "Žemėlapis") and its group headings too, so a German visitor pressing ⌘K got a wholly Lithuanian
 * palette on top of a German interface. The `shell.*` keys it needed already existed, including
 * `shell.palettePages` and `shell.paletteEmpty`, which nothing was reading.
 */
const NAV_ITEMS: { to: string; labelKey: string; keywords?: string; icon: Item["icon"] }[] = [
  { to: "/app", labelKey: "shell.overview", icon: LayoutDashboard, keywords: "dashboard overview kpi" },
  { to: "/app/map", labelKey: "shell.map", icon: MapIcon, keywords: "map live realtime" },
  { to: "/app/devices", labelKey: "shell.devices", icon: Car, keywords: "devices gps trackers" },
  { to: "/app/drivers", labelKey: "shell.drivers", icon: Users, keywords: "drivers users staff" },
  { to: "/app/maintenance", labelKey: "shell.maintenance", icon: Wrench, keywords: "maintenance service" },
  { to: "/app/trips", labelKey: "shell.trips", icon: RouteIcon, keywords: "trips journeys" },
  { to: "/app/history", labelKey: "shell.history", icon: History, keywords: "history playback" },
  { to: "/app/geofences", labelKey: "shell.geofences", icon: Hexagon, keywords: "geofences zones" },
  { to: "/app/rules", labelKey: "shell.rules", icon: ListChecks, keywords: "rules automation" },
  { to: "/app/events", labelKey: "shell.events", icon: AlertTriangle, keywords: "events alerts" },
  { to: "/app/notifications", labelKey: "shell.notifications", icon: Bell, keywords: "notifications inbox" },
  { to: "/app/reports", labelKey: "shell.reports", icon: BarChart3, keywords: "reports analytics" },
  { to: "/app/commands", labelKey: "shell.commands", icon: Terminal, keywords: "commands console" },
  { to: "/app/branding", labelKey: "shell.branding", icon: Palette, keywords: "branding whitelabel" },
  { to: "/app/billing", labelKey: "shell.billing", icon: CreditCard, keywords: "billing invoices" },
  { to: "/app/api-keys", labelKey: "shell.apiKeys", icon: KeyRound, keywords: "api keys tokens" },
  { to: "/app/webhooks", labelKey: "shell.webhooks", icon: Webhook, keywords: "webhooks hooks" },
  { to: "/app/audit", labelKey: "shell.audit", icon: ScrollText, keywords: "audit log" },
  { to: "/app/settings", labelKey: "shell.settings", icon: Settings, keywords: "settings preferences" },
];

function navItems(t: TFunction): Item[] {
  const group = t("shell.palettePages");
  return NAV_ITEMS.map((n) => ({ to: n.to, label: t(n.labelKey), group, icon: n.icon, keywords: n.keywords }));
}

// Build data items lazily (memoized once per palette open)
function buildDataItems(t: TFunction, lang: string): Item[] {
  const c = contentFor(lang);
  const out: Item[] = [];
  generateDevices(c).forEach((d) => out.push({
    to: "/app/devices", label: d.name, hint: `${d.plate} · ${d.driver} · ${d.location}`,
    group: t("shell.devices"), icon: Car, keywords: `${d.imei} ${d.plate} ${d.driver} ${d.location} ${d.status}`,
  }));
  generateDrivers(c).forEach((d) => out.push({
    to: "/app/drivers", label: d.name, hint: `${d.license} · ${d.vehicle}`,
    group: t("shell.drivers"), icon: Users, keywords: `${d.phone} ${d.license} ${d.vehicle} ${d.status}`,
  }));
  generateTrips(c).slice(0, 30).forEach((trip) => out.push({
    to: "/app/trips", label: `${trip.from} → ${trip.to}`, hint: `${trip.device} · ${trip.distance} km · ${trip.driver}`,
    group: t("shell.trips"), icon: RouteIcon, keywords: `${trip.id} ${trip.device} ${trip.driver}`,
  }));
  localizeEvents(lang).forEach((e) => {
    const device = deviceName(e.deviceId);
    out.push({
      to: "/app/events", label: demoDetail(t, e), hint: `${device} · ${t(`events.k.${e.kind}`)}`,
      group: t("shell.events"), icon: AlertTriangle, keywords: `${e.kind} ${device}`,
    });
  });
  // the same three zones the geofences page lists and the live map draws — the palette used to
  // search a fourth, invented set ("Vilnius Depot", "Kaunas Hub") that existed on no screen
  demoZones(lang).forEach((g) => out.push({
    to: "/app/geofences", label: g.name, hint: t(`geofences.${g.kind}`),
    group: t("shell.geofences"), icon: Hexagon, keywords: g.kind,
  }));
  generateRules(c).forEach((r) => out.push({
    to: "/app/rules", label: r.name, hint: `${r.type} · ${r.scope}`,
    group: t("shell.rules"), icon: ListChecks, keywords: `${r.type} ${r.scope} ${r.channels.join(" ")}`,
  }));
  generateMaintenance(c).forEach((m) => out.push({
    to: "/app/maintenance", label: `${m.device} — ${m.service}`, hint: `${m.status} · ${m.dueKm.toLocaleString()} km`,
    group: t("shell.maintenance"), icon: Wrench, keywords: `${m.service} ${m.status}`,
  }));
  generateCommands(c).forEach((c) => out.push({
    to: "/app/commands", label: `${c.command} → ${c.device}`, hint: `${c.status} · ${c.operator}`,
    group: t("shell.commands"), icon: Terminal, keywords: `${c.command} ${c.status} ${c.operator}`,
  }));
  generateApiKeys().forEach((k) => out.push({
    to: "/app/api-keys", label: k.label, hint: `${k.prefix} · ${k.scopes.join(", ")}`,
    group: t("shell.apiKeys"), icon: KeyRound, keywords: `${k.prefix} ${k.scopes.join(" ")}`,
  }));
  generateWebhooks(c).forEach((w) => out.push({
    to: "/app/webhooks", label: w.url, hint: `${w.status} · ${w.successRate}%`,
    group: t("shell.webhooks"), icon: Webhook, keywords: `${w.events.join(" ")} ${w.status}`,
  }));
  generateAudit(c).slice(0, 30).forEach((a) => out.push({
    to: "/app/audit", label: `${a.action}`, hint: `${a.actor} · ${a.target}`,
    group: t("shell.audit"), icon: ScrollText, keywords: `${a.actor} ${a.target} ${a.ip}`,
  }));
  generateInvoices().forEach((i) => out.push({
    to: "/app/billing", label: i.number, hint: `${i.period} · ${i.amount} € · ${i.status}`,
    group: t("shell.billing"), icon: FileText, keywords: `${i.status} ${i.period}`,
  }));
  return out;
}

export function CommandPalette({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  const { t, i18n } = useTranslation("admin");
  const navigate = useNavigate();
  const [q, setQ] = React.useState("");
  const [active, setActive] = React.useState(0);
  const inputRef = React.useRef<HTMLInputElement>(null);
  const listRef = React.useRef<HTMLDivElement>(null);

  const nav = React.useMemo(() => navItems(t), [t]);
  const dataItems = React.useMemo(() => (open ? buildDataItems(t, i18n.language) : []), [open, t, i18n.language]);
  const allItems = React.useMemo(() => [...nav, ...dataItems], [nav, dataItems]);

  React.useEffect(() => {
    if (open) {
      setQ("");
      setActive(0);
      setTimeout(() => inputRef.current?.focus(), 30);
    }
  }, [open]);

  const filtered = React.useMemo(() => {
    const ql = q.trim().toLowerCase();
    if (!ql) return nav; // empty query → show pages only
    return allItems.filter((i) =>
      (i.label + " " + (i.hint ?? "") + " " + i.group + " " + (i.keywords ?? "")).toLowerCase().includes(ql),
    ).slice(0, 80);
  }, [q, nav, allItems]);

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
            placeholder={t("shell.paletteSearch")}
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
              {t("shell.paletteNoMatch", { q })}
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
