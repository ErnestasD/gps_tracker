import { createFileRoute, Link } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { PilotForm } from "@/components/site/PilotForm";
import { Mail } from "lucide-react";

export const Route = createFileRoute("/pilot")({
  head: () => ({
    meta: [
      { title: "Request a pilot — Orbetra" },
      { name: "description", content: "Run a free 60-day Orbetra pilot on up to 500 devices, in parallel with your current platform. Tell us what you run and we reply within one business day." },
    ],
  }),
  component: PilotPage,
});

const NEXT = ["s1", "s2", "s3"] as const;

function PilotPage() {
  const { t } = useTranslation();
  return (
    <div className="mx-auto max-w-7xl px-6 pt-20 md:pt-28 pb-20">
      <div className="grid gap-16 lg:grid-cols-[1.1fr_1fr]">
        <div>
          <span className="section-label">
            <span className="h-[1px] w-6 bg-[var(--brand-blue)]" />
            {t("pilot.label")}
          </span>
          <h1 className="display text-5xl md:text-6xl font-bold leading-[1.02] mt-6 text-ink">
            {t("pilot.h1")}<br />
            <span className="text-gradient">{t("pilot.h2")}</span>
          </h1>
          <p className="mt-6 text-lg text-muted-foreground max-w-lg">
            {t("pilot.sub")}
          </p>
          <p className="mt-4 text-sm text-muted-foreground">
            {t("pilot.selfServeAsk")}{" "}
            <Link to="/signup" className="text-[color:var(--brand-cyan)] hover:underline">
              {t("pilot.selfServeLink")}
            </Link>
          </p>

          <div className="mt-12">
            <div className="mono text-[11px] tracking-[0.2em] uppercase text-muted-foreground mb-6">
              {t("pilot.nextLabel")}
            </div>
            <ol className="space-y-6">
              {NEXT.map((k, i) => (
                <li key={k} className="flex gap-4">
                  <span className="mono text-2xl font-medium text-gradient shrink-0">0{i + 1}</span>
                  <div>
                    <div className="font-display font-semibold text-ink">{t(`pilot.${k}t`)}</div>
                    <div className="text-sm text-muted-foreground">{t(`pilot.${k}b`)}</div>
                  </div>
                </li>
              ))}
            </ol>
          </div>

          <div className="mt-12 flex items-center gap-3 text-sm">
            <Mail className="h-4 w-4 text-[var(--brand-blue)]" />
            <a href="mailto:hello@orbetra.com" className="hover:text-ink text-muted-foreground">hello@orbetra.com</a>
          </div>
        </div>

        <PilotForm />
      </div>
    </div>
  );
}
