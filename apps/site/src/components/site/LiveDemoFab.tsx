import { Link, useRouterState } from "@tanstack/react-router";
import { ArrowRight } from "lucide-react";
import { useTranslation } from "react-i18next";

export function LiveDemoFab() {
  const { location } = useRouterState();
  const { t } = useTranslation();
  if (location.pathname.startsWith("/app")) return null;

  return (
    <div className="fixed bottom-5 right-5 z-40 flex flex-col items-end gap-2 pointer-events-none">
      <Link
        to="/app"
        className="pointer-events-auto group relative inline-flex h-10 items-center gap-2 px-4 rounded mono text-[11px] tracking-[0.22em] uppercase font-semibold text-ink transition-all"
        style={{
          background:
            "linear-gradient(180deg, rgba(76,77,207,0.28) 0%, rgba(76,77,207,0.12) 100%)",
          border: "1px solid rgba(76,77,207,0.6)",
          boxShadow:
            "0 0 0 1px rgba(76,77,207,0.15) inset, 0 12px 32px -12px rgba(76,77,207,0.75)",
          backdropFilter: "blur(8px)",
        }}
        title={t("fab.demoTitle")}
      >
        <span
          aria-hidden
          className="h-1.5 w-1.5 rounded-full bg-[#B45309] animate-pulse-dot"
          style={{ boxShadow: "0 0 8px rgba(180,83,9,0.9)" }}
        />
        <span>{t("nav.demo")}</span>
        <ArrowRight className="h-3.5 w-3.5 text-[color:var(--brand-cyan)] transition-transform group-hover:translate-x-0.5" />
      </Link>
    </div>
  );
}
