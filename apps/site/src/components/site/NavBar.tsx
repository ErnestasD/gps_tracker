import { Link, useRouterState } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
  ChevronDown, Menu, X, ArrowRight, Map as MapIcon, Store, PlayCircle, Code2, Cpu, Handshake, Mail,
  type LucideIcon,
} from "lucide-react";
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
  icon: LucideIcon;
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
      { labelKey: "nav.platform", descKey: "nav.d.platform", icon: MapIcon, to: "/" },
      { labelKey: "nav.resellers", descKey: "nav.d.resellers", icon: Store, to: "/tsp" },
    ],
  },
  {
    labelKey: "nav.g.resources",
    paths: ["/compatibility"],
    items: [
      { labelKey: "nav.apiDocs", descKey: "nav.d.apiDocs", icon: Code2, href: DOCS_URL },
      { labelKey: "nav.compat", descKey: "nav.d.compat", icon: Cpu, href: "/compatibility" },
    ],
  },
  {
    labelKey: "nav.g.company",
    paths: ["/partners", "/pilot"],
    items: [
      { labelKey: "nav.partners", descKey: "nav.d.partners", icon: Handshake, to: "/partners" },
      { labelKey: "nav.contact", descKey: "nav.d.contact", icon: Mail, to: "/pilot" },
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
          <a
            href="/app/map"
            className="inline-flex items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-ink"
          >
            <PlayCircle className="h-3.5 w-3.5" strokeWidth={1.75} aria-hidden />
            {t("nav.demo")}
          </a>
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
          <a href="/app/map" className="inline-flex items-center gap-2 py-1 text-base text-ink/90 hover:text-ink">
            <PlayCircle className="h-4 w-4" strokeWidth={1.75} aria-hidden />
            {t("nav.demo")}
          </a>
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

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className={cn(
          "inline-flex items-center gap-1 text-sm transition-colors relative cursor-pointer py-2",
          active || open ? "text-ink font-medium" : "text-muted-foreground hover:text-ink"
        )}
      >
        {t(group.labelKey)}
        <ChevronDown className={cn("h-3.5 w-3.5 transition-transform duration-200", open && "rotate-180")} aria-hidden />
        {active && (
          <span className="absolute bottom-0 left-0 right-0 h-[2px] bg-[#B45309] rounded-full" />
        )}
      </button>
      <AnimatePresence>
        {open && (
          <motion.div
            role="menu"
            initial={{ opacity: 0, y: 10, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 6, scale: 0.98 }}
            transition={{ duration: 0.18, ease: [0.22, 1, 0.36, 1] }}
            className="absolute left-0 top-full w-[19rem] pt-2"
          >
            <div
              className="relative overflow-hidden rounded-xl border p-1.5 backdrop-blur-xl"
              style={{
                borderColor: "rgba(76,77,207,0.28)",
                background: "linear-gradient(180deg, rgba(14,22,46,0.97) 0%, rgba(5,8,18,0.98) 100%)",
                boxShadow:
                  "0 1px 0 rgba(76,77,207,0.18) inset, 0 24px 60px -20px rgba(0,0,0,0.85), 0 0 40px -16px rgba(76,77,207,0.45)",
              }}
            >
              {/* brand gradient hairline across the top — the panel's signature */}
              <span
                aria-hidden
                className="pointer-events-none absolute inset-x-4 top-0 h-[1.5px] rounded-full"
                style={{ background: "linear-gradient(90deg, transparent, #4c4dcf 30%, #7C5CFC 70%, transparent)" }}
              />
              {group.items.map((it, i) => {
                const Icon = it.icon;
                const inner = (
                  <>
                    <span
                      className="grid h-9 w-9 shrink-0 place-items-center rounded-lg border transition-colors duration-150 group-hover/item:border-[rgba(76,77,207,0.55)]"
                      style={{ background: "rgba(76,77,207,0.10)", borderColor: "rgba(76,77,207,0.25)" }}
                    >
                      <Icon className="h-4 w-4 text-[#8f90f7]" strokeWidth={1.75} />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block text-sm font-medium text-ink leading-tight">{t(it.labelKey)}</span>
                      <span className="block text-xs text-muted-foreground leading-snug mt-0.5">{t(it.descKey)}</span>
                    </span>
                    <ArrowRight
                      className="h-3.5 w-3.5 shrink-0 -translate-x-1 text-[#4c4dcf] opacity-0 transition-all duration-150 group-hover/item:translate-x-0 group-hover/item:opacity-100"
                      aria-hidden
                    />
                  </>
                );
                const cls =
                  "group/item flex items-center gap-3 rounded-lg px-2.5 py-2.5 transition-colors duration-150 hover:bg-[rgba(76,77,207,0.10)]";
                return (
                  <motion.div
                    key={it.labelKey}
                    initial={{ opacity: 0, x: -6 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ delay: 0.04 * i + 0.05, duration: 0.16 }}
                  >
                    {it.to !== undefined ? (
                      <Link role="menuitem" to={it.to} className={cls}>
                        {inner}
                      </Link>
                    ) : (
                      <a role="menuitem" href={it.href} className={cls}>
                        {inner}
                      </a>
                    )}
                  </motion.div>
                );
              })}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
