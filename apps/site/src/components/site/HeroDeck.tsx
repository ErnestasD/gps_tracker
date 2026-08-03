import { motion, AnimatePresence } from "framer-motion";
import { useEffect, useState } from "react";
import { Link } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { ArrowRight, Check } from "lucide-react";
import heroMap from "@/assets/hero/map.png";
import heroIndex from "@/assets/hero/index.png";
import heroEvents from "@/assets/hero/events.png";
import heroGeofences from "@/assets/hero/geofences.png";
import heroReports from "@/assets/hero/reports.png";


const HERO_MAP_NODES = [
  { lng: 21.012, lat: 52.229, label: "Warsaw",   color: "#4c4dcf" },
  { lng: 13.405, lat: 52.520, label: "Berlin",   color: "#4c4dcf" },
  { lng: 25.279, lat: 54.687, label: "Vilnius",  color: "#B45309", highlighted: true },
  { lng: 24.106, lat: 56.949, label: "Riga",     color: "#5B21B6" },
  { lng: 19.945, lat: 50.064, label: "Kraków",   color: "#4c4dcf" },
  { lng: 11.582, lat: 48.135, label: "Munich",   color: "#4c4dcf" },
  { lng: 16.373, lat: 48.208, label: "Vienna",   color: "#5B21B6" },
  { lng: 18.646, lat: 54.352, label: "Gdańsk",   color: "#4c4dcf" },
];

const HERO_MAP_ROUTES = [
  { id: "r1", coordinates: [[13.405,52.520],[16.9,52.4],[21.012,52.229]] as [number,number][], color: "#4c4dcf", width: 1.6 },
  { id: "r2", coordinates: [[25.279,54.687],[23.5,53.5],[21.012,52.229]] as [number,number][], color: "#B45309", width: 1.8 },
  { id: "r3", coordinates: [[21.012,52.229],[20.4,51.1],[19.945,50.064]] as [number,number][], color: "#5B21B6", width: 1.4, dashed: true },
  { id: "r4", coordinates: [[11.582,48.135],[14.0,48.2],[16.373,48.208]] as [number,number][], color: "#4c4dcf", width: 1.4, dashed: true },
];

export function HeroDeck() {
  const { t } = useTranslation();
  return (
    <section className="relative overflow-hidden">

      <div className="mx-auto max-w-7xl px-6 pt-28 md:pt-32 pb-20 md:pb-28">
        <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.05fr)] gap-12 lg:gap-16 items-center">
          {/* LEFT — copy */}
          <div>
            <motion.div
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.4 }}
              className="inline-flex items-center gap-2.5 rounded-full px-4 py-1.5 border border-[var(--hairline)] bg-[rgba(10,20,40,0.5)]"
            >
              <span className="h-2 w-2 rounded-full bg-[#059669] animate-pulse-dot" />
              <span className="text-[13px] font-medium tracking-[0.04em] uppercase text-[#D4E3F6]">
                {t("hero.eyebrow")}
              </span>
            </motion.div>

            <motion.h1
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.55, ease: "easeOut", delay: 0.05 }}
              className="display font-bold text-ink leading-[0.98] tracking-tight mt-6"
              style={{ fontSize: "clamp(2.75rem, 5.6vw, 4.75rem)" }}
            >
              {t("hero.title1")}
              <br />
              <span className="text-gradient">{t("hero.title2")}</span>
            </motion.h1>

            <motion.p
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.5, delay: 0.15 }}
              className="mt-6 text-lg text-muted-foreground max-w-xl leading-relaxed"
            >
              {t("hero.sub")}
            </motion.p>

            <motion.ul
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.5, delay: 0.22 }}
              className="mt-7 grid gap-2.5"
            >
              {(["hero.b1", "hero.b2", "hero.b3"] as const).map((k) => (
                <li key={k} className="flex items-center gap-3 text-sm text-ink/90">
                  <span className="grid place-items-center h-5 w-5 rounded-full bg-[rgba(76,77,207,0.1)] border border-[rgba(76,77,207,0.3)] shrink-0">
                    <Check className="h-3 w-3 text-[#4c4dcf]" strokeWidth={2.5} />
                  </span>
                  {t(k)}
                </li>
              ))}
            </motion.ul>

            <motion.div
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.5, delay: 0.3 }}
              className="mt-9 flex flex-wrap items-center gap-3"
            >
              <Link to="/signup" className="pill-primary hover:pill-primary-hover">
                {t("cta.trial")} <ArrowRight className="h-4 w-4" />
              </Link>
              <Link to="/pricing" className="pill-ghost hover:border-[color:var(--brand-cyan)]">
                {t("cta.pricing")}
              </Link>
              <Link
                to="/tsp"
                className="inline-flex items-center gap-1.5 text-sm text-[color:var(--brand-purple,#7C5CFC)] hover:text-ink transition-colors"
              >
                {t("cta.whitelabel")} <ArrowRight className="h-3.5 w-3.5" />
              </Link>
            </motion.div>

            <div className="mt-8 flex items-center gap-6 mono text-[10.5px] tracking-[0.2em] uppercase text-[#7A8CAA]">
              <span>{t("hero.trial")}</span>
              <span className="h-1 w-1 rounded-full bg-[#7A8CAA]/50" />
              <span>{t("hero.nocard")}</span>
              <span className="h-1 w-1 rounded-full bg-[#7A8CAA]/50" />
              <span>{t("hero.cancel")}</span>
            </div>

            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ duration: 0.5, delay: 0.4 }}
              className="mt-5 flex flex-wrap items-center gap-2.5 text-[12.5px]"
            >
              <span
                className="mono text-[9.5px] tracking-[0.22em] uppercase px-1.5 py-0.5 rounded"
                style={{
                  color: "var(--brand-cyan)",
                  background: "rgba(76,77,207,0.1)",
                  border: "1px solid rgba(76,77,207,0.3)",
                }}
              >
                TSP
              </span>
              <span className="text-muted-foreground">
                {t("hero.tspAsk")}
              </span>
              <Link
                to="/tsp"
                className="text-[color:var(--brand-cyan)] hover:underline inline-flex items-center gap-1 font-medium"
              >
                {t("hero.tspCta")} <ArrowRight className="h-3 w-3" />
              </Link>
            </motion.div>
          </div>

          {/* RIGHT — rotating admin console deck, tilted sideways */}
          <HeroConsoleDeck />
        </div>
      </div>
    </section>
  );
}

type DeckSlide = {
  key: string;
  /** i18n key for the visible slide label (alt text, dots aria-label, caption strip). */
  labelKey: string;
  path: string;
  src: string;
};

const DECK_SLIDES: DeckSlide[] = [
  { key: "map",       labelKey: "hero.deck.map",       path: "/app/map",       src: heroMap },
  { key: "overview",  labelKey: "hero.deck.overview",  path: "/app",           src: heroIndex },
  { key: "events",    labelKey: "hero.deck.events",    path: "/app/events",    src: heroEvents },
  { key: "geofences", labelKey: "hero.deck.geofences", path: "/app/geofences", src: heroGeofences },
  { key: "reports",   labelKey: "hero.deck.reports",   path: "/app/reports",   src: heroReports },
];

function HeroConsoleDeck() {
  const { t } = useTranslation();
  const [idx, setIdx] = useState(0);
  const [paused, setPaused] = useState(false);

  useEffect(() => {
    if (paused) return;
    const t = setInterval(() => setIdx((i) => (i + 1) % DECK_SLIDES.length), 4600);
    return () => clearInterval(t);
  }, [paused]);

  const current = DECK_SLIDES[idx];

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.7, delay: 0.2, ease: "easeOut" }}
      className="relative lg:scale-105 lg:origin-left"
      style={{ perspective: "1100px" }}
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
    >
      {/* Soft halo */}
      <div
        aria-hidden
        className="pointer-events-none absolute -inset-10"
        style={{
          background:
            "radial-gradient(closest-side, rgba(76,77,207,0.22), transparent 70%)",
          filter: "blur(14px)",
        }}
      />

      {/* Tilted 3D wrapper */}
      <div
        className="relative"
        style={{
          transform: "rotateY(-14deg) rotateX(4deg) rotateZ(-1deg)",
          transformStyle: "preserve-3d",
        }}
      >
        {/* Back stack for depth */}
        <div
          aria-hidden
          className="absolute inset-0 rounded-xl border border-[rgba(76,77,207,0.15)]"
          style={{
            transform: "translate3d(28px, 22px, -60px)",
            background: "linear-gradient(180deg, rgba(10,20,40,0.55), rgba(4,7,15,0.55))",
            boxShadow: "0 20px 60px -30px rgba(76,77,207,0.25)",
          }}
        />
        <div
          aria-hidden
          className="absolute inset-0 rounded-xl border border-[rgba(91,33,182,0.14)]"
          style={{
            transform: "translate3d(14px, 11px, -30px)",
            background: "linear-gradient(180deg, rgba(10,20,40,0.7), rgba(4,7,15,0.7))",
          }}
        />

        {/* Screen frame */}
        <div
          className="relative rounded-xl overflow-hidden border backdrop-blur-md"
          style={{
            borderColor: "rgba(76,77,207,0.28)",
            background: "linear-gradient(180deg, rgba(10,20,40,0.92) 0%, rgba(4,7,15,0.94) 100%)",
            boxShadow: "0 30px 80px -30px rgba(76,77,207,0.4), 0 0 0 1px rgba(76,77,207,0.05) inset",
          }}
        >
          {/* Browser chrome */}
          <div className="flex items-center justify-between px-3 py-2 border-b border-[rgba(76,77,207,0.15)] bg-[rgba(4,7,15,0.7)]">
            <div className="flex items-center gap-1.5">
              <span className="h-2 w-2 rounded-full bg-[#B45309]/70" />
              <span className="h-2 w-2 rounded-full bg-[#4c4dcf]/70" />
              <span className="h-2 w-2 rounded-full bg-[#059669]/70" />
            </div>
            <span className="mono text-[9px] tracking-[0.22em] uppercase text-[#B8CDEB] truncate max-w-[60%]">
              {`app.orbetra.com · ${t(current.labelKey)}`}
            </span>
            <span className="mono text-[9px] tracking-[0.22em] uppercase text-[#4c4dcf] flex items-center gap-1">
              <span className="h-1.5 w-1.5 rounded-full bg-[#4c4dcf] animate-pulse-dot" />
              LIVE
            </span>
          </div>

          {/* Screenshot */}
          <div className="relative aspect-[1440/900] w-full overflow-hidden bg-[#0b0f1c]">
            <AnimatePresence mode="wait">
              <motion.img
                key={current.key}
                src={current.src}
                alt={t("hero.deck.alt", { label: t(current.labelKey) })}
                loading="eager"
                decoding="async"
                initial={{ opacity: 0, scale: 1.02, filter: "blur(6px)" }}
                animate={{ opacity: 1, scale: 1,   filter: "blur(0px)" }}
                exit={{    opacity: 0, scale: 0.99, filter: "blur(6px)" }}
                transition={{ duration: 0.55, ease: [0.22, 1, 0.36, 1] }}
                className="absolute inset-0 h-full w-full object-cover object-left-top"
                draggable={false}
              />
            </AnimatePresence>
            {/* subtle vignette */}
            <div
              aria-hidden
              className="pointer-events-none absolute inset-0"
              style={{
                background:
                  "linear-gradient(180deg, transparent 70%, rgba(4,7,15,0.35) 100%)",
              }}
            />
          </div>
        </div>
      </div>

      {/* Slide controls — dots + active glowing pill, label to the right */}
      <div className="mt-8 md:mt-10 flex items-center gap-3 justify-center lg:justify-start lg:ml-5">
        <div className="flex items-center gap-2">
          {DECK_SLIDES.map((s, i) => {
            const active = i === idx;
            return (
              <button
                key={s.key}
                onClick={() => setIdx(i)}
                aria-label={t("hero.deck.show", { label: t(s.labelKey) })}
                className="rounded-full transition-all"
                style={{
                  height: 10,
                  width: active ? 34 : 10,
                  background: active ? "#4c4dcf" : "rgba(184,205,235,0.28)",
                  boxShadow: active
                    ? "0 0 10px rgba(76,77,207,0.7), 0 0 20px rgba(76,77,207,0.35)"
                    : "none",
                }}
              />
            );
          })}
        </div>
        <span
          className="mono text-[10px] tracking-[0.28em] uppercase leading-none"
          style={{ color: "rgba(184,205,235,0.7)" }}
        >
          {t(DECK_SLIDES[idx].labelKey)}
        </span>
      </div>



    </motion.div>
  );
}



