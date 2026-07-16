import { motion, useInView } from "framer-motion";
import { useRef } from "react";
import type { ReactNode } from "react";

/** Draw an SVG path on scroll: its child <path> animates stroke-dashoffset when in view. */
export function RouteDraw({
  className,
  viewBox,
  children,
  duration = 1.6,
}: {
  className?: string;
  viewBox: string;
  children: ReactNode;
  duration?: number;
}) {
  const ref = useRef<SVGSVGElement | null>(null);
  const inView = useInView(ref, { once: true, amount: 0.3 });
  return (
    <svg ref={ref} viewBox={viewBox} className={className} aria-hidden="true">
      <motion.g
        initial={{ pathLength: 0 }}
        animate={inView ? { pathLength: 1 } : { pathLength: 0 }}
        transition={{ duration, ease: "easeInOut" }}
      >
        {children}
      </motion.g>
    </svg>
  );
}
