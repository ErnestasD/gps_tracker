import * as React from "react";
import { Link, useRouterState } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { contentFor } from "@/lib/demo-content";
import {
  LayoutDashboard, Map, Car, Users, Wrench, Route, History,
  Hexagon, ListChecks, Bell, BarChart3, Terminal, Waypoints,
  Palette, CreditCard, KeyRound, Webhook, ScrollText, Settings,
  Circle, ChevronsLeft, ChevronsRight, BookOpen,
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
  // The real product carries the knowledge base here, on its own domain. The demo has no dashboard
  // of its own to render it in, so this one entry leaves for the public copy — same articles.
  {
    label: "shell.support",
    items: [{ to: "/learn", label: "shell.help", icon: BookOpen }],
  },
];

/** Mirrors apps/web AppShell's rail EXACTLY — width, paddings, row geometry and the collapse
 *  toggle. The demo's job is to show the real product, so drift here is the demo misrepresenting it.
 *  `withCollapse` is false in the mobile drawer, where the rail is already a sheet. */
export function AdminSidebar({ onNavigate, withCollapse = true }: { onNavigate?: () => void; withCollapse?: boolean }) {
  const { t, i18n } = useTranslation("admin");
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const [collapsed, setCollapsed] = React.useState(false);
  const mini = collapsed && withCollapse;

  return (
    <aside
      className={`admin-hairline-r flex h-full shrink-0 flex-col transition-[width] duration-150 ${mini ? "w-16" : "w-60"}`}
      style={{ background: "var(--admin-surface)" }}
    >
      <div className={`flex h-14 items-center gap-2.5 admin-hairline-b ${mini ? "justify-center px-0" : "px-4"}`}>
        <div
          className="grid h-8 w-8 place-items-center rounded-lg"
          style={{ background: "var(--admin-brand-soft)", color: "var(--admin-brand)" }}
        >
          <Circle className="h-4 w-4" strokeWidth={2.5} />
        </div>
        {!mini && (
          <div className="min-w-0 leading-tight">
            <div className="display truncate text-sm font-semibold" style={{ color: "var(--admin-ink)" }}>
              {contentFor(i18n.language).company}
            </div>
            <div className="mono text-[9px] uppercase tracking-[0.18em]" style={{ color: "var(--admin-ink-soft)" }}>
              {t("shell.admin")}
            </div>
          </div>
        )}
      </div>

      <nav className="flex-1 overflow-y-auto py-3">
        {groups.map((g) => (
          <div key={g.label} className="mb-4">
            {!mini && (
              <div
                className="px-4 pb-1 text-[10px] font-semibold uppercase tracking-[0.14em]"
                style={{ color: "var(--admin-ink-soft)" }}
              >
                {t(g.label)}
              </div>
            )}
            {g.items.map((item) => {
              const active = pathname === item.to;
              const Icon = item.icon;
              return (
                <Link
                  key={item.to}
                  to={item.to}
                  onClick={onNavigate}
                  aria-current={active ? "page" : undefined}
                  className={`mx-2 flex w-[calc(100%-1rem)] items-center gap-3 rounded-md px-2.5 py-2 text-left text-sm transition-colors ${mini ? "justify-center" : ""} ${active ? "" : "admin-row"}`}
                  style={
                    active
                      ? { background: "var(--admin-brand-soft)", color: "var(--admin-brand)", fontWeight: 600 }
                      : { color: "var(--admin-ink)" }
                  }
                >
                  <Icon className="h-4 w-4 shrink-0" aria-hidden />
                  {!mini && <span>{t(item.label)}</span>}
                </Link>
              );
            })}
          </div>
        ))}
      </nav>

      <div className="admin-hairline-t p-2">
        {!mini && (
          <div className="mb-1 flex items-center gap-2.5 rounded-md px-2 py-1.5">
            <div
              className="grid h-8 w-8 shrink-0 place-items-center rounded-full text-[11px] font-semibold"
              style={{ background: "var(--admin-brand-soft)", color: "var(--admin-brand)" }}
            >
              DE
            </div>
            <div className="min-w-0 leading-tight">
              <div className="truncate text-xs font-medium" style={{ color: "var(--admin-ink)" }}>demo@orbetra.test</div>
              <div className="truncate text-[10px]" style={{ color: "var(--admin-ink-soft)" }}>{t("roles.tsp_admin")}</div>
            </div>
          </div>
        )}
        {withCollapse && (
          <button
            type="button"
            onClick={() => setCollapsed((c) => !c)}
            aria-label={t(collapsed ? "shell.expand" : "shell.collapse")}
            className="inline-flex h-8 w-full cursor-pointer items-center justify-center rounded-md admin-ghost"
          >
            {collapsed ? <ChevronsRight className="h-4 w-4" /> : <ChevronsLeft className="h-4 w-4" />}
          </button>
        )}
      </div>
    </aside>
  );
}
