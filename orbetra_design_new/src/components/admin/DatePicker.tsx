import * as React from "react";
import { format } from "date-fns";
import { CalendarIcon } from "lucide-react";
import { DayPicker } from "react-day-picker";
import "react-day-picker/dist/style.css";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";

export function DatePicker({
  value,
  onChange,
  placeholder = "Pasirinkti datą",
  className,
  disabled,
}: {
  value: Date | undefined;
  onChange: (d: Date | undefined) => void;
  placeholder?: string;
  className?: string;
  disabled?: boolean;
}) {
  const [open, setOpen] = React.useState(false);
  return (
    <Popover open={open} onOpenChange={disabled ? undefined : setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          disabled={disabled}
          className={cn(
            "flex h-9 w-full items-center gap-2 rounded-md border px-3 text-sm outline-none transition-colors disabled:cursor-not-allowed disabled:opacity-50",
            className,
          )}
          style={{
            borderColor: "var(--admin-hairline)",
            background: "var(--admin-surface)",
            color: value ? "var(--admin-ink)" : "var(--admin-ink-soft)",
          }}
        >
          <CalendarIcon className="h-3.5 w-3.5 opacity-70" />
          <span className="flex-1 text-left">
            {value ? format(value, "yyyy-MM-dd") : placeholder}
          </span>
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        className="p-2 pointer-events-auto !opacity-100 !animate-none"
        style={{ background: "var(--admin-surface)", borderColor: "var(--admin-hairline)" }}
      >
        <style>{`
          .rdp { --rdp-accent-color: var(--admin-brand); --rdp-background-color: var(--admin-brand-soft); margin: 0; font-size: 13px; }
          .rdp-day_selected, .rdp-day_selected:focus, .rdp-day_selected:hover { background: var(--admin-brand) !important; color: #fff !important; }
          .rdp-day:hover:not([disabled]):not(.rdp-day_selected) { background: var(--admin-brand-soft); color: var(--admin-brand); }
          .rdp-day_today { color: var(--admin-brand); font-weight: 600; }
          .rdp-caption_label, .rdp-head_cell, .rdp-day { color: var(--admin-ink); }
          .rdp-head_cell { color: var(--admin-ink-soft); font-weight: 500; }
          .rdp-nav_button { color: var(--admin-ink); }
          .rdp-nav_button:hover { background: var(--admin-brand-soft); }
        `}</style>
        <DayPicker
          mode="single"
          selected={value}
          onSelect={(d) => {
            onChange(d);
            if (d) setOpen(false);
          }}
          weekStartsOn={1}
          showOutsideDays
        />
      </PopoverContent>
    </Popover>
  );
}
