import { Link, useRouterState } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { ChevronDown, Menu, X } from "lucide-react";
import { useTranslation } from "react-i18next";

import { cn } from "@/lib/utils";
import { OrbetraWordmark } from "./OrbetraLogo";
import { DOCS_URL } from "@/lib/api";
import { LanguageDropdown } from "./LanguageDropdown";
import { usePartnerToken } from "@/lib/partner-auth";

/**
 * Grouped header navigation (founder ask, GPS Gate idiom): everything lives under three
 * dropdowns — Sprendimai / Ištekliai / Įmonė — with a divider and the one conversion-critical
 * standalone link (Kainos) after it. Items carry a one-line description, the modern-SaaS
 * panel style. External/legacy-bundle destinations are PLAIN anchors on purpose: a router
 * Link in a long-lived tab whose bundle predates the route no-ops silently (founder report).
 */
type NavItem = {
  labelKey: string;
  descKey: string;
  /** router path (Link) … */
  to?: "/" | "/tsp" | "/partners" | "/pilot" | "/pricing";
  /** …or a hard href (external docs, cross-bundle-safe pages, the demo) */
  href?: string;
};

type NavGroup = { labelKey: string; items: NavItem[]; paths: string[] };

const GROUPS: NavGroup[] = [
  {
    labelKey: "nav.g.solutions",
    paths: ["/", "/tsp"],
    items: [
      { labelKey: "nav.platform", descKey: "nav.d.platform", to: "/" },
      { labelKey: "nav.resellers", descKey: "nav.d.resellers", to: "/tsp" },
    ],
  },
  {
    labelKey: "nav.g.resources",
    paths: ["/compatibility", "/app"],
    items: [
      { labelKey: "nav.demo", descKey: "nav.d.demo", href: "/app/map" },
      { labelKey: "nav.apiDocs", descKey: "nav.d.apiDocs", href: DOCS_URL },
      { labelKey: "nav.compat", descKey: "nav.d.compat", href: "/compatibility" },
    ],
  },
  {
    labelKey: "nav.g.company",
    paths: ["/partners", "/pilot"],
    items: [
      { labelKey: "nav.partners", descKey: "nav.d.partners", to: "/partners" },
      { labelKey: "nav.contact", descKey: "nav.d.contact", to: "/pilot" },
    ],
  },
];

export function NavBar() {
  const [scrolled, setScrolled] = useState(false);
  const [open, setOpen] = useState(false);
  const { location } = useRouterState();
  const { t } = useTranslation();
  const partnerToken = usePartnerToken();

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 40);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  useEffect(() => {
    setOpen(false);
  }, [location.pathname]);

  const pricingActive = location.pathname === "/pricing";

  return (
    <header
      className={cn(
        "fixed top-0 inset-x-0 z-50 transition-all duration-300",
        scrolled || open
          ? "bg-[rgba(4,7,15,0.85)] backdrop-blur-md border-b border-[var(--hairline)]"
          : "bg-transparent"
      )}
    >
      <div className="mx-auto max-w-7xl px-6 h-16 flex items-center justify-between">
        {/* the LOCKUP, not mark + text: the circle is the "O" of the word */}
        <Link to="/" className="flex items-center">
          <OrbetraWordmark className="h-8 w-auto" />
        </Link>

        <nav className="hidden md:flex items-center gap-7">
          {GROUPS.map((g) => (
            <NavDropdown key={g.labelKey} group={g} />
          ))}
          <span aria-hidden className="h-5 w-px bg-[var(--hairline)]" />
          <Link
            to="/pricing"
            className={cn(
              "text-sm transition-colors relative",
              pricingActive ? "text-ink font-medium" : "text-muted-foreground hover:text-ink"
            )}
          >
            {t("nav.pricing")}
            {pricingActive && (
              <span className="absolute -bottom-2 left-0 right-0 h-[2px] bg-[#B45309] rounded-full" />
            )}
          </Link>
        </nav>

        <div className="flex items-center gap-3">
          <LanguageDropdown className="hidden sm:block" />
          {/* A SIGNED-IN PARTNER gets the way back, not an invitation to sign in again. */}
          {(() => {
            const active = partnerToken !== null && location.pathname === "/partner/dashboard";
            return (
              <Link
                to={partnerToken !== null ? "/partner/dashboard" : "/login"}
                className={cn(
                  "hidden lg:inline-flex text-sm transition-colors relative",
                  active ? "text-ink font-medium" : "text-muted-foreground hover:text-ink"
                )}
              >
                {partnerToken !== null ? t("cta.partnerDashboard") : t("cta.signin")}
                {active && (
                  <span className="absolute -bottom-2 left-0 right-0 h-[2px] bg-[#B45309] rounded-full" />
                )}
              </Link>
            );
          })()}
          <Link to="/signup" className="hidden sm:inline-flex pill-primary hover:pill-primary-hover">
            {t("cta.trial")}
          </Link>
          <button
            aria-label={t("nav.menu")}
            aria-expanded={open}
            onClick={() => setOpen((v) => !v)}
            className="md:hidden grid place-items-center h-9 w-9 rounded border border-[var(--hairline)] text-ink cursor-pointer"
          >
            {open ? <X className="h-4 w-4" /> : <Menu className="h-4 w-4" />}
          </button>
        </div>
      </div>

      {/* Mobile drawer — same groups, flattened with section headers */}
      <div
        className={cn(
          "md:hidden overflow-hidden transition-[max-height] duration-300 border-t border-[var(--hairline)]",
          open ? "max-h-[640px]" : "max-h-0 border-t-0"
        )}
      >
        <nav className="px-6 py-5 grid gap-1.5 bg-[rgba(4,7,15,0.96)]">
          {GROUPS.map((g) => (
            <div key={g.labelKey} className="py-1.5">
              <div className="mono text-[10px] tracking-[0.24em] uppercase text-[#7A8CAA] mb-1.5">{t(g.labelKey)}</div>
              <div className="grid gap-1">
                {g.items.map((it) =>
                  it.to !== undefined ? (
                    <Link key={it.labelKey} to={it.to} className="py-1 text-base text-ink/90 hover:text-ink">
                      {t(it.labelKey)}
                    </Link>
                  ) : (
                    <a key={it.labelKey} href={it.href} className="py-1 text-base text-ink/90 hover:text-ink">
                      {t(it.labelKey)}
                    </a>
                  ),
                )}
              </div>
            </div>
          ))}
          <Link to="/pricing" className="py-1 text-base text-ink/90 hover:text-ink">{t("nav.pricing")}</Link>
          <div className="pt-3 grid gap-3">
            <Link to="/signup" className="pill-primary hover:pill-primary-hover justify-center">
              {t("cta.trial")}
            </Link>
            <Link to="/login" className="pill-ghost justify-center text-center">
              {t("cta.signin")}
            </Link>
          </div>
          <LanguageDropdown className="pt-2" align="start" variant="full" />
        </nav>
      </div>
    </header>
  );
}

function NavDropdown({ group }: { group: NavGroup }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const { location } = useRouterState();
  const active = group.paths.some((p) => (p === "/" ? location.pathname === "/" : location.pathname.startsWith(p)));

  useEffect(() => {
    setOpen(false);
  }, [location.pathname]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const itemCls =
    "flex flex-col gap-0.5 rounded-md px-3 py-2.5 transition-colors hover:bg-[rgba(76,77,207,0.08)]";

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className={cn(
          "inline-flex items-center gap-1 text-sm transition-colors relative cursor-pointer",
          active || open ? "text-ink font-medium" : "text-muted-foreground hover:text-ink"
        )}
      >
        {t(group.labelKey)}
        <ChevronDown className={cn("h-3.5 w-3.5 transition-transform", open && "rotate-180")} aria-hidden />
        {active && (
          <span className="absolute -bottom-2 left-0 right-0 h-[2px] bg-[#B45309] rounded-full" />
        )}
      </button>
      {open && (
        <div
          role="menu"
          className="absolute left-1/2 top-full mt-3 w-72 -translate-x-1/2 rounded-lg border border-[var(--hairline)] bg-[rgba(6,10,22,0.98)] backdrop-blur-md p-1.5 shadow-[0_24px_48px_-20px_rgba(0,0,0,0.85),0_0_0_1px_rgba(76,77,207,0.06)]"
        >
          {group.items.map((it) => {
            const inner = (
              <>
                <span className="text-sm font-medium text-ink leading-tight">{t(it.labelKey)}</span>
                <span className="text-xs text-muted-foreground leading-snug">{t(it.descKey)}</span>
              </>
            );
            return it.to !== undefined ? (
              <Link key={it.labelKey} role="menuitem" to={it.to} className={itemCls}>
                {inner}
              </Link>
            ) : (
              <a key={it.labelKey} role="menuitem" href={it.href} className={itemCls}>
                {inner}
              </a>
            );
          })}
        </div>
      )}
    </div>
  );
}
