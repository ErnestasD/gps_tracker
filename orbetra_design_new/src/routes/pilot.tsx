import { createFileRoute } from "@tanstack/react-router";
import { PilotForm } from "@/components/site/PilotForm";
import { Mail } from "lucide-react";

export const Route = createFileRoute("/pilot")({
  head: () => ({
    meta: [
      { title: "Start free trial — Orbetra GPS for small fleets" },
      { name: "description", content: "Start a 30-day free trial of Orbetra. Plug in your Teltonika device, open the app on your phone, done. No credit card, cancel anytime." },
    ],
  }),
  component: PilotPage,
});

const NEXT = [
  { n: "01", t: "Tell us about your fleet", b: "Takes about 90 seconds. Only what we actually need to help." },
  { n: "02", t: "We reply within 1 business day", b: "Real human, real answers. No sales sequences, no pressure." },
  { n: "03", t: "You're live the same week", b: "One SMS per device points it at Orbetra. Open the app, done." },
];

function PilotPage() {
  return (
    <div className="mx-auto max-w-7xl px-6 pt-20 md:pt-28 pb-20">
      <div className="grid gap-16 lg:grid-cols-[1.1fr_1fr]">
        <div>
          <span className="section-label">
            <span className="h-[1px] w-6 bg-[var(--brand-blue)]" />
            — START FREE TRIAL
          </span>
          <h1 className="display text-5xl md:text-6xl font-bold leading-[1.02] mt-6 text-ink">
            Try Orbetra<br />
            <span className="text-gradient">on your vans.</span>
          </h1>
          <p className="mt-6 text-lg text-muted-foreground max-w-lg">
            30 days free, up to 5 vehicles, no credit card. Plug in your Teltonika device and open the app on your phone — you're live the same day.
          </p>

          <div className="mt-12">
            <div className="mono text-[11px] tracking-[0.2em] uppercase text-muted-foreground mb-6">— WHAT HAPPENS NEXT</div>
            <ol className="space-y-6">
              {NEXT.map((s) => (
                <li key={s.n} className="flex gap-4">
                  <span className="mono text-2xl font-medium text-gradient shrink-0">{s.n}</span>
                  <div>
                    <div className="font-display font-semibold text-ink">{s.t}</div>
                    <div className="text-sm text-muted-foreground">{s.b}</div>
                  </div>
                </li>
              ))}
            </ol>
          </div>

          <div className="mt-12 flex items-center gap-3 text-sm">
            <Mail className="h-4 w-4 text-[var(--brand-blue)]" />
            <a href="mailto:hello@orbetra.eu" className="hover:text-ink text-muted-foreground">hello@orbetra.eu</a>
          </div>
        </div>

        <PilotForm />
      </div>
    </div>
  );
}
