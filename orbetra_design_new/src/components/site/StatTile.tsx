import { useEffect, useState } from "react";
import NumberFlow from "@number-flow/react";
import { motion } from "framer-motion";

export function StatTile({ label, value, suffix, prefix, unit }: {
  label: string;
  value: number;
  suffix?: string;
  prefix?: string;
  unit?: string;
}) {
  const [v, setV] = useState(0);
  useEffect(() => {
    const id = setTimeout(() => setV(value), 200);
    return () => clearTimeout(id);
  }, [value]);
  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, amount: 0.5 }}
      transition={{ duration: 0.5 }}
      className="surface-card hover:surface-card-hover p-6"
    >
      <div className="mono text-[10px] tracking-[0.2em] uppercase text-muted-foreground">— {label}</div>
      <div className="mt-4 flex items-baseline gap-1 mono text-4xl md:text-5xl font-medium text-ink tabular-nums">
        {prefix}
        <NumberFlow value={v} />
        {suffix}
      </div>
      {unit && <div className="mono text-xs text-muted-foreground mt-1">{unit}</div>}
    </motion.div>
  );
}
