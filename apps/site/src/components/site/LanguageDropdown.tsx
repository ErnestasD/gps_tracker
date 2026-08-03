import { useEffect, useRef, useState } from "react";
import { Check, ChevronDown, Globe } from "lucide-react";
import { useTranslation } from "react-i18next";

import { cn } from "@/lib/utils";
import { LANGUAGES, LANGUAGE_NAMES, setLanguage, useLanguageBootstrap, type Lang } from "@/lib/i18n";

export function LanguageDropdown({
  className,
  align = "end",
  variant = "compact",
}: {
  className?: string;
  align?: "start" | "end";
  variant?: "compact" | "full";
}) {
  useLanguageBootstrap();
  const { i18n, t } = useTranslation();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  const current = ((i18n.resolvedLanguage || "en").slice(0, 2) as Lang);
  const active = LANGUAGES.includes(current) ? current : "en";

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
    <div ref={ref} className={cn("relative", className)}>
      <button
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={t("footer.language")}
        onClick={() => setOpen((v) => !v)}
        className={cn(
          "inline-flex items-center gap-1.5 h-8 rounded border transition-colors cursor-pointer",
          "border-[var(--hairline)] bg-[rgba(10,20,40,0.6)] text-muted-foreground",
          "hover:text-ink hover:border-[rgba(76,77,207,0.55)]",
          variant === "full" ? "px-3" : "px-2.5",
          open && "text-ink border-[rgba(76,77,207,0.55)]"
        )}
      >
        <Globe className="h-3.5 w-3.5 shrink-0" strokeWidth={1.75} />
        <span className="mono text-[11px] uppercase tracking-wide">
          {variant === "full" ? LANGUAGE_NAMES[active] : active}
        </span>
        <ChevronDown
          className={cn("h-3.5 w-3.5 shrink-0 transition-transform", open && "rotate-180")}
          strokeWidth={1.75}
        />
      </button>

      {open && (
        <div
          role="listbox"
          className={cn(
            "absolute z-50 mt-2 min-w-[168px] overflow-hidden rounded-md border border-[var(--hairline)] p-1",
            "bg-[rgba(6,10,22,0.98)] backdrop-blur-md shadow-[0_18px_40px_-12px_rgba(0,0,0,0.8)]",
            align === "end" ? "right-0" : "left-0"
          )}
        >
          {LANGUAGES.map((l) => {
            const selected = l === active;
            return (
              <button
                key={l}
                type="button"
                role="option"
                aria-selected={selected}
                onClick={() => {
                  setLanguage(l);
                  setOpen(false);
                }}
                className={cn(
                  "w-full flex items-center gap-2.5 px-2.5 py-2 rounded text-left text-sm transition-colors cursor-pointer",
                  selected ? "text-ink bg-[rgba(76,77,207,0.16)]" : "text-muted-foreground hover:text-ink hover:bg-[rgba(76,77,207,0.08)]"
                )}
              >
                <span className="mono text-[10px] uppercase tracking-[0.18em] w-6 shrink-0 text-[#4c4dcf]">
                  {l}
                </span>
                <span className="flex-1">{LANGUAGE_NAMES[l]}</span>
                {selected && <Check className="h-3.5 w-3.5 text-[#4c4dcf]" strokeWidth={2.5} />}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
