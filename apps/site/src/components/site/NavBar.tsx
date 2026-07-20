import { Link, useRouterState } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";

const NAV = [
  { to: "/", label: "Platform" },
  { to: "/tsp", label: "For TSPs" },
  { to: "/pricing", label: "Pricing" },
  { to: "/pilot", label: "Contact" },
];

export function NavBar() {
  const [scrolled, setScrolled] = useState(false);
  const { location } = useRouterState();

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 40);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  return (
    <header
      className={cn(
        "fixed top-0 inset-x-0 z-50 transition-all duration-300",
        scrolled
          ? "bg-[rgba(4,7,15,0.75)] backdrop-blur-md border-b border-[var(--hairline)]"
          : "bg-transparent"
      )}
    >
      <div className="mx-auto max-w-7xl px-6 h-16 flex items-center justify-between">
        <Link to="/" className="flex items-center" aria-label="Orbetra">
          <img src="/orbetra-wordmark.svg" alt="Orbetra" className="h-8 w-auto" />
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
                {item.label}
                {active && (
                  <span className="absolute -bottom-2 left-0 right-0 h-[2px] bg-[#B45309] rounded-full" />
                )}
              </Link>
            );
          })}
          <a href={import.meta.env.VITE_DASH_URL ?? "https://dash.orbetra.com"} className="text-sm text-muted-foreground hover:text-ink">Sign in</a>
        </nav>
        <div className="flex items-center gap-3">
          <Link to="/pilot" className="pill-primary hover:pill-primary-hover">
            Request a pilot
          </Link>
        </div>
      </div>
    </header>
  );
}
