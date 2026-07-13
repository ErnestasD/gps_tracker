import { useEffect, useRef } from "react";
import { motion, useScroll, useSpring } from "framer-motion";

export function ScrollTrajectory() {
  const { scrollYProgress } = useScroll();
  const progress = useSpring(scrollYProgress, { stiffness: 120, damping: 30, mass: 0.3 });
  const dotRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    return progress.on("change", (v) => {
      if (dotRef.current) dotRef.current.style.top = `${v * 100}%`;
    });
  }, [progress]);

  return (
    <div className="fixed left-0 top-16 bottom-0 z-40 w-[3px] pointer-events-none hidden md:block">
      <div className="absolute inset-0 bg-[var(--hairline)] opacity-40" />
      <motion.div
        className="absolute top-0 left-0 right-0 bg-gradient-to-b from-[#2563EB] to-[#7C5CFC] origin-top"
        style={{ scaleY: progress, height: "100%" }}
      />
      <div
        ref={dotRef}
        className="absolute -left-[3px] w-[9px] h-[9px] rounded-full bg-[#B45309] shadow-[0_0_0_3px_rgba(180,83,9,0.2)] -translate-y-1/2"
        style={{ top: 0 }}
      />
    </div>
  );
}
