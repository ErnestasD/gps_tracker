import { Link, useRouterState } from "@tanstack/react-router";
import {
  LayoutDashboard, Map, Car, Users, Wrench, Route, History,
  Hexagon, ListChecks, Bell, BarChart3, Terminal, AlertTriangle,
  Palette, CreditCard, KeyRound, Webhook, ScrollText, Settings,
  Circle,
} from "lucide-react";

type NavItem = { to: string; label: string; icon: React.ComponentType<{ className?: string; strokeWidth?: number }> };
type NavGroup = { label: string; items: NavItem[] };

const groups: NavGroup[] = [
  {
    label: "Gyvai",
    items: [
      { to: "/app", label: "Apžvalga", icon: LayoutDashboard },
      { to: "/app/map", label: "Žemėlapis", icon: Map },
    ],
  },
  {
    label: "Parkas",
    items: [
      { to: "/app/devices", label: "Įrenginiai", icon: Car },
      { to: "/app/drivers", label: "Vairuotojai", icon: Users },
      { to: "/app/maintenance", label: "Priežiūra", icon: Wrench },
      { to: "/app/trips", label: "Kelionės", icon: Route },
      { to: "/app/history", label: "Istorija", icon: History },
    ],
  },
  {
    label: "Automatika",
    items: [
      { to: "/app/geofences", label: "Geozonos", icon: Hexagon },
      { to: "/app/rules", label: "Taisyklės", icon: ListChecks },
      { to: "/app/events", label: "Įvykiai", icon: AlertTriangle },
      { to: "/app/notifications", label: "Pranešimai", icon: Bell },
    ],
  },
  {
    label: "Įžvalgos",
    items: [{ to: "/app/reports", label: "Ataskaitos", icon: BarChart3 }],
  },
  {
    label: "Operacijos",
    items: [{ to: "/app/commands", label: "Komandos", icon: Terminal }],
  },
  {
    label: "Administravimas",
    items: [
      { to: "/app/branding", label: "Prekės ženklas", icon: Palette },
      { to: "/app/billing", label: "Atsiskaitymai", icon: CreditCard },
      { to: "/app/api-keys", label: "API raktai", icon: KeyRound },
      { to: "/app/webhooks", label: "Webhooks", icon: Webhook },
      { to: "/app/audit", label: "Audito žurnalas", icon: ScrollText },
      { to: "/app/settings", label: "Nustatymai", icon: Settings },
    ],
  },
];

export function AdminSidebar({ onNavigate }: { onNavigate?: () => void }) {
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
          <span className="text-sm font-semibold">Orbetra</span>
          <span className="text-[10px] uppercase tracking-widest" style={{ color: "var(--admin-ink-soft)" }}>
            Admin
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
              {g.label}
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
                      <span className="truncate">{item.label}</span>
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
            EK
          </div>
          <div className="min-w-0 flex-1 text-xs">
            <div className="truncate font-medium">Edvinas K.</div>
            <div className="truncate" style={{ color: "var(--admin-ink-soft)" }}>Kaunas Fleet · Admin</div>
          </div>
        </div>
      </div>
    </aside>
  );
}
