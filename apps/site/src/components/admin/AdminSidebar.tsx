import { Link, useRouterState } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { contentFor } from "@/lib/demo-content";
import {
  LayoutDashboard, Map, Car, Users, Wrench, Route, History,
  Hexagon, ListChecks, Bell, BarChart3, Terminal, Waypoints,
  Palette, CreditCard, KeyRound, Webhook, ScrollText, Settings,
  Circle,
} from "lucide-react";

type NavItem = { to: string; label: string; icon: (props: { className?: string; strokeWidth?: number }) => React.ReactNode };
type NavGroup = { label: string; items: NavItem[] };
// labels are keys into the PRODUCT translations (admin namespace = apps/web i18n copies)

const groups: NavGroup[] = [
  {
    label: "shell.live",
    items: [
      { to: "/app/map", label: "shell.map", icon: Map },
      { to: "/app", label: "shell.overview", icon: LayoutDashboard },
    ],
  },
  {
    label: "shell.fleet",
    items: [
      { to: "/app/devices", label: "shell.devices", icon: Car },
      { to: "/app/drivers", label: "shell.drivers", icon: Users },
      { to: "/app/maintenance", label: "shell.maintenance", icon: Wrench },
      { to: "/app/trips", label: "shell.trips", icon: Route },
      { to: "/app/routing", label: "shell.routing", icon: Waypoints },
      { to: "/app/history", label: "shell.history", icon: History },
    ],
  },
  {
    label: "shell.automation",
    items: [
      { to: "/app/geofences", label: "shell.geofences", icon: Hexagon },
      { to: "/app/rules", label: "shell.rules", icon: ListChecks },
      { to: "/app/events", label: "shell.events", icon: Bell },
    ],
  },
  {
    label: "shell.insights",
    items: [{ to: "/app/reports", label: "shell.reports", icon: BarChart3 }],
  },
  {
    label: "shell.ops",
    items: [{ to: "/app/commands", label: "shell.commands", icon: Terminal }],
  },
  {
    label: "shell.admin",
    items: [
      { to: "/app/branding", label: "shell.branding", icon: Palette },
      { to: "/app/billing", label: "shell.billing", icon: CreditCard },
      { to: "/app/api-keys", label: "shell.apiKeys", icon: KeyRound },
      { to: "/app/webhooks", label: "shell.webhooks", icon: Webhook },
      { to: "/app/audit", label: "shell.audit", icon: ScrollText },
      { to: "/app/settings", label: "shell.settings", icon: Settings },
    ],
  },
];

export function AdminSidebar({ onNavigate }: { onNavigate?: () => void }) {
  const { t, i18n } = useTranslation("admin");
  const pathname = useRouterState({ select: (s) => s.location.pathname });

  return (
    <aside
      className="admin-hairline-r flex h-full w-64 shrink-0 flex-col"
      style={{ background: "var(--admin-surface)" }}
    >
      <div className="flex h-14 items-center gap-2 px-5 admin-hairline-b">
        <div
          className="grid h-8 w-8 place-items-center rounded-lg"
          style={{ background: "var(--admin-brand-soft)", color: "var(--admin-brand)" }}
        >
          <Circle className="h-4 w-4" strokeWidth={2.5} />
        </div>
        <div className="flex flex-col leading-none">
          <span className="text-sm font-semibold">{contentFor(i18n.language).company}</span>
          <span className="text-[10px] uppercase tracking-widest" style={{ color: "var(--admin-ink-soft)" }}>
            {t("shell.admin")}
          </span>
        </div>
      </div>

      <nav className="flex-1 overflow-y-auto px-3 py-4">
        {groups.map((g) => (
          <div key={g.label} className="mb-5">
            <div
              className="mb-1.5 px-2 text-[10px] font-semibold uppercase tracking-widest"
              style={{ color: "var(--admin-ink-soft)" }}
            >
              {t(g.label)}
            </div>
            <ul className="flex flex-col gap-0.5">
              {g.items.map((item) => {
                const active = pathname === item.to;
                const Icon = item.icon;
                return (
                  <li key={item.to}>
                    <Link
                      to={item.to}
                      onClick={onNavigate}
                      className="group flex items-center gap-2.5 rounded-md px-2 py-1.5 text-sm transition-colors"
                      style={{
                        background: active ? "var(--admin-brand-soft)" : "transparent",
                        color: active ? "var(--admin-brand)" : "var(--admin-ink)",
                        fontWeight: active ? 600 : 500,
                      }}
                    >
                      <Icon className="h-4 w-4 shrink-0" strokeWidth={active ? 2.2 : 1.8} />
                      <span className="truncate">{t(item.label)}</span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </nav>

      <div className="admin-hairline-t p-3">
        <div className="flex items-center gap-2.5 rounded-lg px-2 py-2" style={{ background: "var(--admin-surface-sunken)" }}>
          <div
            className="grid h-8 w-8 place-items-center rounded-full text-xs font-semibold"
            style={{ background: "var(--admin-brand)", color: "#fff" }}
          >
            DE
          </div>
          <div className="min-w-0 flex-1 text-xs">
            <div className="truncate font-medium">demo@orbetra.test</div>
            <div className="truncate" style={{ color: "var(--admin-ink-soft)" }}>{t("roles.tsp_admin")}</div>
          </div>
        </div>
      </div>
    </aside>
  );
}
