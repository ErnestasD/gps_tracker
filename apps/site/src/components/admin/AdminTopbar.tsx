import * as React from "react";
import { Sun, Moon, Search, Bell, Menu, CheckCheck, Languages, LogOut, Check } from "lucide-react";
import { useTranslation } from "react-i18next";

import { demoDetail, deviceName } from "@/lib/demo-events";
import { LANGUAGES, LANGUAGE_NAMES, setLanguage, type Lang } from "@/lib/i18n";
import { Link, useRouterState, useNavigate } from "@tanstack/react-router";
import { useAdminTheme } from "@/lib/admin-theme";
import { useNotifications } from "@/lib/admin-notifications";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { CommandPalette } from "@/components/admin/CommandPalette";

/** route → key in the PRODUCT translations (admin namespace) */
const CRUMBS: Record<string, string> = {
  "/app": "shell.overview",
  "/app/map": "shell.map",
  "/app/devices": "shell.devices",
  "/app/drivers": "shell.drivers",
  "/app/maintenance": "shell.maintenance",
  "/app/trips": "shell.trips",
  "/app/routing": "shell.routing",
  "/app/history": "shell.history",
  "/app/geofences": "shell.geofences",
  "/app/rules": "shell.rules",
  "/app/events": "shell.events",
  "/app/reports": "shell.reports",
  "/app/commands": "shell.commands",
  "/app/branding": "shell.branding",
  "/app/billing": "shell.billing",
  "/app/api-keys": "shell.apiKeys",
  "/app/webhooks": "shell.webhooks",
  "/app/audit": "shell.audit",
  "/app/settings": "shell.settings",
  "/app/notifications": "bell.title",
};

/** demo-only strings (not part of the product) in the four demo languages */
const DEMO_BADGE: Record<Lang, { label: string; hint: string }> = {
  lt: { label: "Demo režimas", hint: "Tai demonstracinė aplinka su pavyzdiniais duomenimis" },
  en: { label: "Demo mode", hint: "This is a demo environment with sample data" },
  pl: { label: "Tryb demo", hint: "To środowisko demo z przykładowymi danymi" },
  de: { label: "Demo-Modus", hint: "Dies ist eine Demo-Umgebung mit Beispieldaten" },
};

export function AdminTopbar({ onOpenSidebar }: { onOpenSidebar: () => void }) {
  const { theme, toggle } = useAdminTheme();
  const { t, i18n } = useTranslation("admin");
  const lang = ((i18n.resolvedLanguage ?? "lt").slice(0, 2) as Lang);
  const activeLang: Lang = LANGUAGES.includes(lang) ? lang : "lt";
  const [langOpen, setLangOpen] = React.useState(false);
  const langRef = React.useRef<HTMLDivElement | null>(null);
  React.useEffect(() => {
    if (!langOpen) return;
    const onDown = (e: MouseEvent) => {
      if (langRef.current && !langRef.current.contains(e.target as Node)) setLangOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [langOpen]);
  const rawPathname = useRouterState({ select: (s) => s.location.pathname });
  // "/app/" and "/app" are the same page — normalise so the crumb lookup never falls through
  const pathname = rawPathname !== "/app" && rawPathname.endsWith("/") ? rawPathname.slice(0, -1) : rawPathname;
  const title = t(CRUMBS[pathname] ?? "shell.admin");
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
    /* Mirrors apps/web AppShell's header EXACTLY — same height, gap, padding and surface. The demo
       exists to show the real product, so any drift here is the demo lying about it. */
    <header
      className="admin-hairline-b flex h-14 shrink-0 items-center gap-2 px-4 backdrop-blur"
      /* apps/web writes this as `bg-surface/80`, and that class does NOT exist here: the two apps
         have different Tailwind palettes, so it produced no background at all and the demo header
         was transparent. The admin tokens are what the two share. */
      style={{ background: "color-mix(in oklab, var(--admin-surface) 80%, transparent)" }}
    >
      <button
        onClick={onOpenSidebar}
        className="cursor-pointer p-1 md:hidden"
        style={{ color: "var(--admin-ink)" }}
        aria-label={t("shell.menu")}
      >
        <Menu className="h-4 w-4" />
      </button>

      <div className="min-w-0 truncate text-sm" style={{ color: "var(--admin-ink-soft)" }}>
        <Link to="/app" className="transition-colors hover:text-[var(--admin-ink)]">{t("shell.admin")}</Link>
        {pathname !== "/app" && (
          <>
            {" "}
            <span className="opacity-50">›</span>{" "}
            <span style={{ color: "var(--admin-ink)" }}>{title}</span>
          </>
        )}
      </div>

      <span
        className="inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wider"
        style={{
          borderColor: "color-mix(in oklab, var(--admin-warning) 45%, transparent)",
          background: "color-mix(in oklab, var(--admin-warning) 12%, transparent)",
          color: "var(--admin-warning)",
        }}
        title={DEMO_BADGE[activeLang].hint}
      >
        <span className="h-1.5 w-1.5 rounded-full" style={{ background: "var(--admin-warning)", animation: "pulseDot 2.2s ease-in-out infinite" }} />
        {DEMO_BADGE[activeLang].label}
      </span>

      <div className="flex-1" />

      <button
        type="button"
        onClick={() => setPaletteOpen(true)}
        className="hidden cursor-pointer items-center gap-2 rounded-md border px-3 py-1.5 text-sm md:flex md:w-64"
        style={{ borderColor: "var(--admin-hairline)", background: "var(--admin-surface-sunken)", color: "var(--admin-ink-soft)" }}
        aria-label={t("shell.search")}
      >
        <Search className="h-3.5 w-3.5" aria-hidden />
        <span className="flex-1 truncate text-left">{t("shell.search")}</span>
        <kbd
          className="mono inline-flex h-5 min-w-[20px] items-center justify-center rounded border px-1 text-[10px] font-medium leading-none tracking-tight"
          style={{ borderColor: "var(--admin-hairline)", background: "var(--admin-surface)", color: "var(--admin-ink-soft)" }}
        >
          ⌘K
        </kbd>
      </button>

      <button
        type="button"
        onClick={() => setPaletteOpen(true)}
        className="grid h-8 w-8 cursor-pointer place-items-center rounded-md md:hidden"
        style={{ color: "var(--admin-ink)" }}
        aria-label={t("shell.search")}
      >
        <Search className="h-4 w-4" />
      </button>

      <NotificationsBell />


      <div ref={langRef} className="relative hidden md:block">
        <button
          onClick={() => setLangOpen((v) => !v)}
          className="grid h-9 w-9 cursor-pointer place-items-center rounded-md admin-ghost"
          aria-label={t("settings.locale")}
          aria-expanded={langOpen}
          title={t("settings.locale")}
        >
          <Languages className="h-4 w-4" />
        </button>
        {langOpen && (
          <div
            className="absolute right-0 z-50 mt-2 w-40 overflow-hidden rounded-md border p-1"
            style={{ background: "var(--admin-surface)", borderColor: "var(--admin-hairline)", boxShadow: "var(--admin-shadow-lg)" }}
            role="listbox"
          >
            {LANGUAGES.map((l) => (
              <button
                key={l}
                role="option"
                aria-selected={l === activeLang}
                onClick={() => {
                  setLanguage(l);
                  setLangOpen(false);
                }}
                className="flex w-full cursor-pointer items-center gap-2 rounded px-2.5 py-1.5 text-left text-sm"
                style={{
                  color: l === activeLang ? "var(--admin-brand)" : "var(--admin-ink)",
                  background: l === activeLang ? "var(--admin-brand-soft)" : "transparent",
                  fontWeight: l === activeLang ? 600 : 400,
                }}
              >
                <span className="mono w-6 text-[10px] uppercase tracking-widest">{l}</span>
                <span className="flex-1">{LANGUAGE_NAMES[l]}</span>
                {l === activeLang && <Check className="h-3.5 w-3.5" />}
              </button>
            ))}
          </div>
        )}
      </div>

      <button
        type="button"
        onClick={toggle}
        className="grid h-9 w-9 cursor-pointer place-items-center rounded-md admin-ghost"
        aria-label={t("shell.theme")}
        title={t("shell.theme")}
      >
        {theme === "light" ? <Moon className="h-4 w-4" /> : <Sun className="h-4 w-4" />}
      </button>

      <Link
        to="/"
        className="inline-flex h-8 cursor-pointer items-center gap-2 rounded-md px-3 text-xs admin-ghost"
      >
        <LogOut className="h-4 w-4" aria-hidden />
        {t("shell.logout")}
      </Link>

      <CommandPalette open={paletteOpen} onOpenChange={setPaletteOpen} />
    </header>
  );
}

function NotificationsBell() {
  const { items, unread, markAllRead, markRead } = useNotifications();
  const { t, i18n } = useTranslation("admin");
  const navigate = useNavigate();
  const [open, setOpen] = React.useState(false);
  const recent = items.slice(0, 6);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          className="relative grid h-8 w-8 cursor-pointer place-items-center rounded-md admin-ghost"
          style={{ color: "var(--admin-ink)" }}
          aria-label={t("bell.title")}
        >
          <Bell className="h-4 w-4" aria-hidden />
          {unread > 0 && (
            <span
              className="absolute -right-0.5 -top-0.5 grid h-4 min-w-4 place-items-center rounded-full px-1 text-[10px] font-semibold leading-none"
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
          <div className="text-sm font-semibold" style={{ color: "var(--admin-ink)" }}>{t("bell.title")}</div>
          <button
            onClick={markAllRead}
            className="inline-flex cursor-pointer items-center gap-1 text-[11px]"
            style={{ color: "var(--admin-brand)" }}
          >
            <CheckCheck className="h-3 w-3" />{t("bell.markAll")}
          </button>
        </div>
        <ul className="max-h-80 overflow-y-auto">
          {recent.length === 0 && (
            <li className="p-6 text-center text-sm" style={{ color: "var(--admin-ink-soft)" }}>{t("bell.empty")}</li>
          )}
          {recent.map((n) => {
            const tone = n.kind === "panic" || n.kind === "power_cut" ? "var(--admin-danger)" : n.kind === "overspeed" ? "var(--admin-warning)" : "var(--admin-brand)";
            return (
              <li key={n.id}>
                <button
                  /* mirrors the real admin: reading it is not the point — reaching the event is */
                  onClick={() => {
                    markRead(n.id);
                    setOpen(false);
                    void navigate({ to: "/app/events" });
                  }}
                  className="flex w-full cursor-pointer items-start gap-2.5 px-3 py-2.5 text-left admin-hairline-b"
                  style={{ background: n.read ? "transparent" : "var(--admin-brand-soft)" }}
                >
                  <span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: tone }} />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm" style={{ color: "var(--admin-ink)", fontWeight: n.read ? 400 : 600 }}>
                      {demoDetail(t, n)}
                    </div>
                    <div className="text-[11px]" style={{ color: "var(--admin-ink-soft)" }}>
                      {/* the vehicle FIRST: an alert without one names nothing */}
                      {deviceName(n.deviceId)} · {t(`events.k.${n.kind}`)} · {new Date(n.at).toLocaleString(i18n.language)}
                    </div>
                  </div>
                </button>
              </li>
            );
          })}
        </ul>
        <div className="admin-hairline-t p-2">
          <Link
            to="/app/events"
            onClick={() => setOpen(false)}
            className="block rounded-md px-3 py-2 text-center text-sm font-medium"
            style={{ background: "var(--admin-brand-soft)", color: "var(--admin-brand)" }}
          >
            {t("bell.viewAll")}
          </Link>
        </div>
      </PopoverContent>
    </Popover>
  );
}
