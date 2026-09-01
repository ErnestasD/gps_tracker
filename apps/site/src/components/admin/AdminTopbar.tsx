import * as React from "react";
import { Sun, Moon, Search, Bell, Menu, ChevronRight, CheckCheck, Languages, LogOut } from "lucide-react";
import { Link, useRouterState } from "@tanstack/react-router";
import { useAdminTheme } from "@/lib/admin-theme";
import { useNotifications } from "@/lib/admin-notifications";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { fmtDateTime } from "@/lib/admin-format";
import { CommandPalette } from "@/components/admin/CommandPalette";

const CRUMBS: Record<string, string> = {
  "/app": "Apžvalga",
  "/app/map": "Žemėlapis",
  "/app/devices": "Įrenginiai",
  "/app/drivers": "Vairuotojai",
  "/app/maintenance": "Priežiūra",
  "/app/trips": "Kelionės",
  "/app/routing": "Maršrutai",
  "/app/history": "Istorija",
  "/app/geofences": "Geozonos",
  "/app/rules": "Taisyklės",
  "/app/events": "Įvykiai",
  "/app/reports": "Ataskaitos",
  "/app/commands": "Komandos",
  "/app/branding": "Prekės ženklas",
  "/app/billing": "Atsiskaitymai",
  "/app/api-keys": "API raktai",
  "/app/webhooks": "Webhooks",
  "/app/audit": "Audito žurnalas",
  "/app/settings": "Nustatymai",
  "/app/notifications": "Pranešimai",
};

export function AdminTopbar({ onOpenSidebar }: { onOpenSidebar: () => void }) {
  const { theme, toggle } = useAdminTheme();
  const rawPathname = useRouterState({ select: (s) => s.location.pathname });
  // "/app/" and "/app" are the same page — normalise so the crumb lookup never falls through
  const pathname = rawPathname !== "/app" && rawPathname.endsWith("/") ? rawPathname.slice(0, -1) : rawPathname;
  const title = CRUMBS[pathname] ?? "Administravimas";
  const [paletteOpen, setPaletteOpen] = React.useState(false);

  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = e.ctrlKey || e.metaKey;
      if (mod && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setPaletteOpen((v) => !v);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <header
      className="admin-hairline-b sticky top-0 z-30 flex h-14 items-center gap-3 px-4 md:px-6"
      style={{ background: "color-mix(in oklab, var(--admin-surface) 92%, transparent)", backdropFilter: "blur(10px)" }}
    >
      <button
        onClick={onOpenSidebar}
        className="grid h-9 w-9 cursor-pointer place-items-center rounded-md md:hidden"
        style={{ color: "var(--admin-ink)" }}
        aria-label="Meniu"
      >
        <Menu className="h-5 w-5" />
      </button>

      <nav className="hidden items-center gap-1.5 text-sm md:flex" style={{ color: "var(--admin-ink-soft)" }}>
        <Link to="/app" className="hover:text-[var(--admin-ink)]">Administravimas</Link>
        {pathname !== "/app" && (
          <>
            <ChevronRight className="h-3.5 w-3.5" />
            <span style={{ color: "var(--admin-ink)" }} className="font-medium">{title}</span>
          </>
        )}
      </nav>

      <div className="flex-1" />

      <button
        type="button"
        onClick={() => setPaletteOpen(true)}
        className="hidden cursor-pointer items-center gap-2 rounded-md border px-2.5 py-1.5 text-sm transition-colors hover:border-[var(--admin-ink-soft)] md:inline-flex"
        style={{ borderColor: "var(--admin-hairline)", background: "var(--admin-surface)", color: "var(--admin-ink)" }}
        aria-label="Atverti paiešką"
      >
        <Search className="h-3.5 w-3.5 opacity-70" />
        <span>Ieškoti</span>
        <span className="mx-1 h-3 w-px" style={{ background: "var(--admin-hairline)" }} />
        <kbd
          className="mono inline-flex h-4 items-center rounded px-1 text-[10px] font-medium leading-none tracking-tight"
          style={{
            background: "var(--admin-surface-sunken)",
            color: "var(--admin-ink-soft)",
            fontFamily: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
          }}
        >
          ⌘K
        </kbd>
      </button>

      <button
        type="button"
        onClick={() => setPaletteOpen(true)}
        className="grid h-9 w-9 cursor-pointer place-items-center rounded-md border md:hidden"
        style={{ borderColor: "var(--admin-hairline)", background: "var(--admin-surface)", color: "var(--admin-ink)" }}
        aria-label="Ieškoti"
      >
        <Search className="h-4 w-4" />
      </button>

      <NotificationsBell />


      <button
        onClick={toggle}
        className="grid h-9 w-9 cursor-pointer place-items-center rounded-md border transition-colors"
        style={{ borderColor: "var(--admin-hairline)", background: "var(--admin-surface)", color: "var(--admin-ink)" }}
        aria-label="Perjungti temą"
        title={theme === "light" ? "Tamsi tema" : "Šviesi tema"}
      >
        {theme === "light" ? <Moon className="h-4 w-4" /> : <Sun className="h-4 w-4" />}
      </button>

      <button
        className="hidden h-9 w-9 cursor-pointer place-items-center rounded-md border md:grid"
        style={{ borderColor: "var(--admin-hairline)", background: "var(--admin-surface)", color: "var(--admin-ink)" }}
        aria-label="Kalba"
        title="Kalba"
      >
        <Languages className="h-4 w-4" />
      </button>

      <Link
        to="/"
        className="hidden items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-sm md:inline-flex"
        style={{ borderColor: "var(--admin-hairline)", background: "var(--admin-surface)", color: "var(--admin-ink)" }}
        title="Baigti demonstraciją"
      >
        <LogOut className="h-3.5 w-3.5 opacity-70" />
        Atsijungti
      </Link>

      <CommandPalette open={paletteOpen} onOpenChange={setPaletteOpen} />
    </header>
  );
}

function NotificationsBell() {
  const { items, unread, markAllRead, markRead } = useNotifications();
  const [open, setOpen] = React.useState(false);
  const recent = items.slice(0, 6);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          className="relative grid h-9 w-9 cursor-pointer place-items-center rounded-md border"
          style={{ borderColor: "var(--admin-hairline)", background: "var(--admin-surface)", color: "var(--admin-ink)" }}
          aria-label="Pranešimai"
        >
          <Bell className="h-4 w-4" />
          {unread > 0 && (
            <span
              className="absolute -right-1 -top-1 grid h-4 min-w-4 place-items-center rounded-full px-1 text-[10px] font-semibold"
              style={{ background: "var(--admin-danger)", color: "#fff" }}
            >
              {unread > 99 ? "99+" : unread}
            </span>
          )}
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="end"
        className="w-80 p-0 !opacity-100 !animate-none"
        style={{ background: "var(--admin-surface)", borderColor: "var(--admin-hairline)" }}
      >
        <div className="admin-hairline-b flex items-center justify-between px-3 py-2">
          <div className="text-sm font-semibold" style={{ color: "var(--admin-ink)" }}>Pranešimai</div>
          <button
            onClick={markAllRead}
            className="inline-flex cursor-pointer items-center gap-1 text-[11px]"
            style={{ color: "var(--admin-brand)" }}
          >
            <CheckCheck className="h-3 w-3" />Pažymėti visus
          </button>
        </div>
        <ul className="max-h-80 overflow-y-auto">
          {recent.length === 0 && (
            <li className="p-6 text-center text-sm" style={{ color: "var(--admin-ink-soft)" }}>Nėra pranešimų</li>
          )}
          {recent.map((n) => {
            const tone = n.severity === "critical" ? "var(--admin-danger)" : n.severity === "warning" ? "var(--admin-warning)" : "var(--admin-brand)";
            return (
              <li key={n.id}>
                <button
                  onClick={() => markRead(n.id)}
                  className="flex w-full cursor-pointer items-start gap-2.5 px-3 py-2.5 text-left admin-hairline-b"
                  style={{ background: n.read ? "transparent" : "var(--admin-brand-soft)" }}
                >
                  <span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: tone }} />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm" style={{ color: "var(--admin-ink)", fontWeight: n.read ? 400 : 600 }}>
                      {n.detail}
                    </div>
                    <div className="text-[11px]" style={{ color: "var(--admin-ink-soft)" }}>
                      {n.device} · {fmtDateTime(n.ts)}
                    </div>
                  </div>
                </button>
              </li>
            );
          })}
        </ul>
        <div className="admin-hairline-t p-2">
          <Link
            to="/app/notifications"
            onClick={() => setOpen(false)}
            className="block rounded-md px-3 py-2 text-center text-sm font-medium"
            style={{ background: "var(--admin-brand-soft)", color: "var(--admin-brand)" }}
          >
            Visi pranešimai
          </Link>
        </div>
      </PopoverContent>
    </Popover>
  );
}
