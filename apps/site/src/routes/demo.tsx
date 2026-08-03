import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowRight } from "lucide-react";
import { DEMO_URL } from "@/lib/api";

export const Route = createFileRoute("/demo")({
  head: () => ({
    meta: [
      { title: "Live demo — Orbetra GPS tracking" },
      { name: "description", content: "Open a read-only Orbetra demo workspace. Live map, trips, geofences, alerts and reports — no signup needed." },
      { property: "og:title", content: "Live demo — Orbetra" },
      { property: "og:description", content: "Read-only Orbetra demo workspace. No signup needed." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: DemoPage,
});

function DemoPage() {
  const external = /^https?:/.test(DEMO_URL);
  return (
    <div className="mx-auto max-w-3xl px-6 pt-24 md:pt-32 pb-28 text-center">
      <span className="section-label justify-center">
        <span className="h-[1px] w-6 bg-[var(--brand-blue)]" />
        — LIVE DEMO
      </span>
      <h1 className="display text-4xl md:text-5xl font-bold mt-5 text-ink leading-[1.05]">
        Click around the real app.<br />
        <span className="text-gradient">No signup, read-only.</span>
      </h1>
      <p className="mt-6 text-muted-foreground">
        A shared demo workspace with example vehicles. You can browse the live map, trips
        and playback, geofences, rules, reports and device health. Nothing you do there is
        saved.
      </p>
      <div className="mt-9 flex flex-wrap justify-center gap-3">
        {external ? (
          <a href={DEMO_URL} target="_blank" rel="noreferrer" className="pill-primary hover:pill-primary-hover">
            Open live demo <ArrowRight className="h-4 w-4" />
          </a>
        ) : (
          <Link to="/app" className="pill-primary hover:pill-primary-hover">
            Open live demo <ArrowRight className="h-4 w-4" />
          </Link>
        )}
        <Link to="/signup" className="pill-ghost hover:border-[color:var(--brand-cyan)]">
          Start free trial
        </Link>
      </div>
      <p className="mt-6 mono text-[10.5px] tracking-[0.2em] uppercase text-[#7A8CAA]">
        Read-only · example data · resets periodically
      </p>
    </div>
  );
}
