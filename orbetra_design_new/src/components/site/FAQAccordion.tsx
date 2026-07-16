import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Plus } from "lucide-react";

interface Item { q: string; a: string; }

export function FAQAccordion({ items }: { items: Item[] }) {
  const [open, setOpen] = useState<number | null>(0);
  return (
    <div className="divide-y divide-[var(--hairline)] border-y border-[var(--hairline)]">
      {items.map((item, i) => {
        const isOpen = open === i;
        return (
          <div key={i}>
            <button onClick={() => setOpen(isOpen ? null : i)} className="w-full flex items-center justify-between py-5 text-left gap-4 group">
              <span className="font-display font-semibold text-lg text-ink">{item.q}</span>
              <span className={`grid place-items-center h-8 w-8 rounded-full border border-[var(--hairline)] shrink-0 transition-transform ${isOpen ? "rotate-45 border-[var(--brand-blue)]" : ""}`}>
                <Plus className="h-4 w-4" strokeWidth={1.5} />
              </span>
            </button>
            <AnimatePresence initial={false}>
              {isOpen && (
                <motion.div
                  initial={{ height: 0, opacity: 0 }}
                  animate={{ height: "auto", opacity: 1 }}
                  exit={{ height: 0, opacity: 0 }}
                  transition={{ duration: 0.25 }}
                  className="overflow-hidden"
                >
                  <p className="pb-5 text-muted-foreground max-w-3xl">{item.a}</p>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        );
      })}
    </div>
  );
}
