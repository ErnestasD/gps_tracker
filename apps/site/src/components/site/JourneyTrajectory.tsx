import { motion } from "framer-motion";
import { useTranslation } from "react-i18next";

const STEPS = [
  { n: "01", k: "s1" },
  { n: "02", k: "s2" },
  { n: "03", k: "s3" },
  { n: "04", k: "s4" },
];

export function JourneyTrajectory() {
  const { t } = useTranslation();
  return (
    <div className="relative">
      <svg className="pointer-events-none absolute inset-0 hidden md:block" viewBox="0 0 1200 380" preserveAspectRatio="none">
        <motion.path
          d="M 80 200 Q 280 60 500 200 T 900 200 T 1120 200"
          fill="none"
          stroke="#2563EB"
          strokeOpacity="0.4"
          strokeWidth="1.25"
          strokeDasharray="4 5"
          initial={{ pathLength: 0 }}
          whileInView={{ pathLength: 1 }}
          viewport={{ once: true, amount: 0.3 }}
          transition={{ duration: 2.2, ease: "easeInOut" }}
        />
        <motion.circle
          r="6"
          fill="#B45309"
          initial={{ offsetDistance: "0%", opacity: 0 }}
          whileInView={{ offsetDistance: "100%", opacity: 1 }}
          viewport={{ once: true, amount: 0.3 }}
          transition={{ duration: 2.4, ease: "easeInOut" }}
          style={{ offsetPath: "path('M 80 200 Q 280 60 500 200 T 900 200 T 1120 200')" }}
        />
      </svg>

      <ol className="grid gap-8 md:grid-cols-4 relative">
        {STEPS.map((s, i) => (
          <motion.li
            key={s.n}
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, amount: 0.4 }}
            transition={{ duration: 0.5, delay: i * 0.1 }}
            className="surface-card p-6 relative"
          >
            <div className="mono text-xs tracking-[0.2em] text-[var(--brand-blue)]">{t("journey.step", { n: s.n })}</div>
            <h3 className="mt-4 display text-xl font-semibold text-ink">{t(`journey.${s.k}t`)}</h3>
            <p className="mt-2 text-sm text-muted-foreground leading-relaxed">{t(`journey.${s.k}b`)}</p>
            <span className="absolute top-4 right-4 h-2 w-2 rounded-full bg-[var(--brand-blue)]" />
          </motion.li>
        ))}
      </ol>
    </div>
  );
}
