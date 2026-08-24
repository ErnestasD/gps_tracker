import { Check, ChevronDown, Search } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

import { cn } from "@/lib/utils";

/**
 * Select2-style picker (founder: native <select> arrows overflow the input and look
 * "web based"). A styled trigger with its own chevron + a floating panel with type-ahead
 * search and a scrollable option list — the whole control is ours, so it renders the same
 * in every browser. Follows the LanguageDropdown surface conventions.
 */
export function SelectField({
  value,
  onChange,
  options,
  placeholder,
  searchable,
  className,
  "aria-label": ariaLabel,
}: {
  value: string;
  onChange: (value: string) => void;
  options: string[];
  /** the "—" row: shown as trigger text when nothing is picked, and as a clear row on top */
  placeholder: string;
  /** show the search box (select2 behaviour for long lists); auto-on from 8 options */
  searchable?: boolean;
  className?: string;
  "aria-label"?: string;
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [cursor, setCursor] = useState(-1);
  const ref = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const withSearch = searchable ?? options.length >= 8;

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (q === "") return options;
    return options.filter((o) => o.toLowerCase().includes(q));
  }, [options, query]);

  // panel lifecycle: fresh search + cursor on the current value each time it opens
  useEffect(() => {
    if (!open) return;
    setQuery("");
    setCursor(value === "" ? -1 : options.indexOf(value));
    const id = requestAnimationFrame(() => searchRef.current?.focus());
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => {
      cancelAnimationFrame(id);
      document.removeEventListener("mousedown", onDown);
    };
    // (deps intentionally only [open] — the reset belongs to the open edge, not value/options churn)
  }, [open]);

  // the cursor row follows keyboard navigation into view
  useEffect(() => {
    if (!open || cursor < 0) return;
    listRef.current
      ?.querySelector<HTMLElement>(`[data-index="${cursor}"]`)
      ?.scrollIntoView({ block: "nearest" });
  }, [open, cursor]);

  const pick = (v: string) => {
    onChange(v);
    setOpen(false);
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") {
      setOpen(false);
      return;
    }
    if (!open && (e.key === "Enter" || e.key === " " || e.key === "ArrowDown")) {
      e.preventDefault();
      setOpen(true);
      return;
    }
    if (!open) return;
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      const dir = e.key === "ArrowDown" ? 1 : -1;
      setCursor((c) => {
        const base = c < 0 ? (dir === 1 ? -1 : shown.length) : c;
        return Math.max(0, Math.min(shown.length - 1, base + dir));
      });
    } else if (e.key === "Enter") {
      e.preventDefault();
      const hit = shown[cursor];
      if (hit !== undefined) pick(hit);
    }
  };

  return (
    <div ref={ref} className={cn("relative", className)} onKeyDown={onKeyDown}>
      <button
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={ariaLabel}
        onClick={() => setOpen((v) => !v)}
        className={cn(
          "flex w-full h-10 items-center gap-2 rounded border px-3 text-sm transition-colors cursor-pointer",
          "border-[var(--hairline)] bg-[rgba(10,20,40,0.6)] text-left outline-none",
          "focus-visible:border-[var(--brand-blue)]",
          open ? "border-[rgba(76,77,207,0.55)] text-ink" : "hover:border-[rgba(76,77,207,0.55)]",
          value === "" ? "text-muted-foreground" : "text-ink",
        )}
      >
        <span className="min-w-0 flex-1 truncate">{value === "" ? placeholder : value}</span>
        <ChevronDown
          className={cn("h-4 w-4 shrink-0 text-muted-foreground transition-transform", open && "rotate-180")}
          strokeWidth={1.75}
          aria-hidden
        />
      </button>

      {open && (
        <div
          className={cn(
            "absolute z-50 mt-2 w-full overflow-hidden rounded-md border border-[var(--hairline)]",
            "bg-[rgba(6,10,22,0.98)] backdrop-blur-md shadow-[0_18px_40px_-12px_rgba(0,0,0,0.8)]",
          )}
        >
          {withSearch && (
            <div className="relative border-b border-[var(--hairline)]">
              <Search
                className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground"
                aria-hidden
              />
              <input
                ref={searchRef}
                type="text"
                value={query}
                onChange={(e) => {
                  setQuery(e.target.value);
                  setCursor(0);
                }}
                placeholder={t("compat.filter")}
                className="w-full h-9 bg-transparent pl-9 pr-3 text-sm text-ink outline-none placeholder:text-muted-foreground"
              />
            </div>
          )}
          <div ref={listRef} role="listbox" aria-label={ariaLabel} className="max-h-64 overflow-y-auto p-1">
            {query.trim() === "" && (
              <OptionRow selected={value === ""} highlighted={false} onPick={() => pick("")}>
                <span className="text-muted-foreground">{placeholder}</span>
              </OptionRow>
            )}
            {shown.length === 0 ? (
              <p className="px-2.5 py-2 text-sm text-muted-foreground">{t("compat.none")}</p>
            ) : (
              shown.map((o, i) => (
                <OptionRow
                  key={o}
                  index={i}
                  selected={o === value}
                  highlighted={i === cursor}
                  onPick={() => pick(o)}
                  onHover={() => setCursor(i)}
                >
                  {o}
                </OptionRow>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function OptionRow({
  children,
  index,
  selected,
  highlighted,
  onPick,
  onHover,
}: {
  children: React.ReactNode;
  index?: number;
  selected: boolean;
  highlighted: boolean;
  onPick: () => void;
  onHover?: () => void;
}) {
  return (
    <button
      type="button"
      role="option"
      aria-selected={selected}
      data-index={index}
      onClick={onPick}
      onMouseMove={onHover}
      className={cn(
        "flex w-full items-center gap-2.5 px-2.5 py-2 rounded text-left text-sm transition-colors cursor-pointer",
        selected
          ? "text-ink bg-[rgba(76,77,207,0.16)]"
          : highlighted
            ? "text-ink bg-[rgba(76,77,207,0.08)]"
            : "text-muted-foreground hover:text-ink hover:bg-[rgba(76,77,207,0.08)]",
      )}
    >
      <span className="min-w-0 flex-1 truncate">{children}</span>
      {selected && <Check className="h-3.5 w-3.5 shrink-0 text-[#4c4dcf]" strokeWidth={2.5} aria-hidden />}
    </button>
  );
}
