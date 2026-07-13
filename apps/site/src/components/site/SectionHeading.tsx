import { motion } from "framer-motion";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export function SectionHeading({
  label,
  children,
  className,
  align = "left",
}: {
  label: string;
  children: ReactNode;
  className?: string;
  align?: "left" | "center";
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, amount: 0.5 }}
      transition={{ duration: 0.5, ease: "easeOut" }}
      className={cn(align === "center" && "text-center mx-auto", className)}
    >
      <span className={cn("section-label", align === "center" && "justify-center")}>
        <span className="h-[1px] w-6 bg-[var(--brand-blue)]" />
        {label}
      </span>
      <h2 className="display text-4xl md:text-5xl font-bold leading-[1.05] mt-5 text-ink">
        {children}
      </h2>
    </motion.div>
  );
}
