import { Link, useRouterState } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Menu, X } from "lucide-react";
import { useTranslation } from "react-i18next";

import { cn } from "@/lib/utils";
import { OrbetraLogo } from "./OrbetraLogo";
import { DOCS_URL } from "@/lib/api";
import { LanguageDropdown } from "./LanguageDropdown";

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
        <Link to="/" className="flex items-center gap-2 font-display font-bold text-lg text-ink">
          <OrbetraLogo className="h-10 w-10" />
          <span>Orbetra</span>
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
          <a href={DOCS_URL} className="text-sm text-muted-foreground hover:text-ink">{t("nav.docs")}</a>
        </nav>

        <div className="flex items-center gap-3">
          <LanguageDropdown className="hidden sm:block" />
          <Link
            to="/login"
            className="hidden lg:inline-flex text-sm text-muted-foreground hover:text-ink"
          >
            {t("cta.signin")}
          </Link>
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
          <a href={DOCS_URL} className="text-base text-ink/90 hover:text-ink">{t("nav.docs")}</a>
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
