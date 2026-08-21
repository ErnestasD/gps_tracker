import { Link, useRouterState } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { ChevronDown, Menu, X } from "lucide-react";
import { useTranslation } from "react-i18next";

import { cn } from "@/lib/utils";
import { OrbetraWordmark } from "./OrbetraLogo";
import { DOCS_URL } from "@/lib/api";
import { LanguageDropdown } from "./LanguageDropdown";
import { usePartnerToken } from "@/lib/partner-auth";

const NAV = [
  { to: "/", key: "nav.platform" },
  { to: "/pricing", key: "nav.pricing" },
  { to: "/tsp", key: "nav.resellers" },
  { to: "/partners", key: "nav.partners" },
  { to: "/pilot", key: "nav.contact" },
] as const;

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

        <nav className="hidden md:flex items-center gap-8">
          {NAV.map((item) => {
            const active = location.pathname === item.to;
            return (
              <Link
                key={item.to}
                to={item.to}
                className={cn(
                  "text-sm transition-colors relative",
                  active ? "text-ink font-medium" : "text-muted-foreground hover:text-ink"
                )}
              >
                {t(item.key)}
                {active && (
                  <span className="absolute -bottom-2 left-0 right-0 h-[2px] bg-[#B45309] rounded-full" />
                )}
              </Link>
            );
          })}
          <DocsDropdown active={location.pathname === "/compatibility"} />
        </nav>

        <div className="flex items-center gap-3">
          <LanguageDropdown className="hidden sm:block" />
          {/* A SIGNED-IN PARTNER gets the way back, not an invitation to sign in again. Leaving
              "Sign in" there meant that visiting any other page — pricing, docs, the front page —
              stranded them: the only route to their own dashboard was to authenticate a second
              time. The token lives in this browser, so the header knows. */}
          {(() => {
            // same active treatment as the NAV items: while ON the dashboard the entry is lit
            // and underlined — the router no-ops a same-route click, and an unmarked entry that
            // "does nothing" read as broken (founder report)
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

      {/* Mobile drawer */}
      <div
        className={cn(
          "md:hidden overflow-hidden transition-[max-height] duration-300 border-t border-[var(--hairline)]",
          open ? "max-h-[520px]" : "max-h-0 border-t-0"
        )}
      >
        <nav className="px-6 py-5 grid gap-4 bg-[rgba(4,7,15,0.96)]">
          {NAV.map((item) => (
            <Link key={item.to} to={item.to} className="text-base text-ink/90 hover:text-ink">
              {t(item.key)}
            </Link>
          ))}
          <a href={DOCS_URL} className="text-base text-ink/90 hover:text-ink">{t("nav.apiDocs")}</a>
          <Link to="/compatibility" className="text-base text-ink/90 hover:text-ink">{t("nav.compat")}</Link>
          <Link to="/demo" className="text-base text-ink/90 hover:text-ink">{t("nav.demo")}</Link>
          <div className="pt-2 grid gap-3">
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

/**
 * "Dokumentacija" is a MENU now, not a link: it fans out to the API reference (external, on the
 * dashboard host) and the CAN compatibility checker (founder ask). Same dismiss contract as the
 * language dropdown — outside click and Escape close it, and a route change closes it too.
 */
function DocsDropdown({ active }: { active: boolean }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const { location } = useRouterState();

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
          "inline-flex items-center gap-1 text-sm transition-colors relative cursor-pointer",
          active || open ? "text-ink font-medium" : "text-muted-foreground hover:text-ink"
        )}
      >
        {t("nav.docs")}
        <ChevronDown className={cn("h-3.5 w-3.5 transition-transform", open && "rotate-180")} aria-hidden />
        {active && (
          <span className="absolute -bottom-2 left-0 right-0 h-[2px] bg-[#B45309] rounded-full" />
        )}
      </button>
      {open && (
        <div
          role="menu"
          className="absolute left-0 top-full mt-3 w-56 rounded border border-[var(--hairline)] bg-[rgba(4,7,15,0.97)] backdrop-blur-md py-1.5 shadow-[0_20px_40px_-20px_rgba(0,0,0,0.8)]"
        >
          <a
            role="menuitem"
            href={DOCS_URL}
            className="block px-4 py-2 text-sm text-ink/90 hover:text-ink hover:bg-white/[0.04]"
          >
            {t("nav.apiDocs")}
          </a>
          <Link
            role="menuitem"
            to="/compatibility"
            className="block px-4 py-2 text-sm text-ink/90 hover:text-ink hover:bg-white/[0.04]"
          >
            {t("nav.compat")}
          </Link>
        </div>
      )}
    </div>
  );
}
