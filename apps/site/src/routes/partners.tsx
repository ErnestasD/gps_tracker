import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { ArrowRight, Check } from "lucide-react";
import { useTranslation } from "react-i18next";
import { ApiError, apiPost } from "@/lib/api";
import { SectionHeading } from "@/components/site/SectionHeading";

export const Route = createFileRoute("/partners")({
  head: () => ({
    meta: [
      { title: "Partner & affiliate program — Orbetra" },
      { name: "description", content: "Invite-only Orbetra partner program: recurring commission for a limited window on every fleet you refer. Apply, get a ?ref= link, track commissions in the partner dashboard." },
      { property: "og:title", content: "Partner & affiliate program — Orbetra" },
      { property: "og:description", content: "Recurring commission on every fleet you refer. Invite-only." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: PartnersPage,
});

const HOW = [
  { n: "01", k: "s1" },
  { n: "02", k: "s2" },
  { n: "03", k: "s3" },
  { n: "04", k: "s4" },
];


/** Text-input form values only — a File can never appear in these forms. */
function formVal(fd: FormData, k: string): string {
  const v = fd.get(k);
  return typeof v === "string" ? v : "";
}

function PartnersPage() {
  const { t } = useTranslation();
  const [state, setState] = useState<"idle" | "loading" | "done">("idle");
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setState("loading");
    const fd = new FormData(e.currentTarget);
    // Reuses the real /v1/public/pilot-request endpoint (pilotRequestSchema strips
    // unknown keys!), so the partner marker + website travel INSIDE `message` and
    // `company` is never empty (schema requires min 1 char).
    const website = formVal(fd, "website").trim();
    const note = formVal(fd, "message").trim();
    try {
      await apiPost("/v1/public/pilot-request", {
        name: formVal(fd, "name").trim(),
        email: formVal(fd, "email").trim(),
        company: formVal(fd, "company").trim() || "(independent)",
        message: ["[PARTNER APPLICATION]", website ? `Website: ${website}` : "", note]
          .filter(Boolean)
          .join("\n")
          .slice(0, 2000),
        hp_field: formVal(fd, "hp_field"), // honeypot — must stay empty
      });
      setState("done");
    } catch (err) {
      if (err instanceof ApiError && err.status === 429) {
        setError(t("partners.errRate"));
      } else {
        setError(err instanceof Error ? err.message : t("partners.errGeneric"));
      }
      setState("idle");
    }
  }

  return (
    <div className="mx-auto max-w-7xl px-6 pt-24 md:pt-32 pb-24">
      <div className="max-w-3xl">
        <span className="section-label">
          <span className="h-[1px] w-6 bg-[var(--brand-blue)]" />
          {t("partners.label")}
        </span>
        <h1 className="display text-4xl md:text-6xl font-bold mt-5 text-ink leading-[1.03]">
          {t("partners.h1")}<br />
          <span className="text-gradient">{t("partners.h2")}</span>
        </h1>
        <p className="mt-6 text-lg text-muted-foreground">
          {t("partners.sub")}
        </p>
        <div className="mt-8 flex flex-wrap gap-3">
          <a href="#apply" className="pill-primary hover:pill-primary-hover">
            {t("partners.cta")} <ArrowRight className="h-4 w-4" />
          </a>
          <Link to="/partner/login" className="pill-ghost hover:border-[color:var(--brand-cyan)]">
            {t("partners.signin")}
          </Link>
        </div>
      </div>

      <section className="mt-24">
        <SectionHeading label={t("partners.howLabel")} className="mb-12 max-w-3xl">
          {t("partners.howH1")}<br /><span className="text-gradient">{t("partners.howH2")}</span>
        </SectionHeading>
        <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-4">
          {HOW.map((s) => (
            <div key={s.n} className="surface-card p-6 flex flex-col">
              <span className="mono text-2xl font-medium text-gradient">{s.n}</span>
              <div className="font-display font-semibold text-ink mt-3">{t(`partners.${s.k}t`)}</div>
              <p className="text-sm text-muted-foreground mt-2">{t(`partners.${s.k}b`)}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="mt-20 grid gap-10 lg:grid-cols-[1fr_minmax(0,460px)] items-start" id="apply">
        <div>
          <SectionHeading label={t("partners.getLabel")} className="mb-8 max-w-2xl">
            {t("partners.getTitle")}
          </SectionHeading>
          <ul className="grid gap-3 text-sm">
            {(["partners.g1", "partners.g2", "partners.g3", "partners.g4", "partners.g5"] as const).map((f) => (
              <li key={f} className="flex gap-3 items-start">
                <span className="grid place-items-center h-5 w-5 rounded-full bg-[rgba(76,77,207,0.1)] border border-[rgba(76,77,207,0.3)] shrink-0 mt-0.5">
                  <Check className="h-3 w-3 text-[#4c4dcf]" strokeWidth={2.5} />
                </span>
                <span className="text-ink/85">{t(f)}</span>
              </li>
            ))}
          </ul>
          <p className="mt-6 text-sm text-muted-foreground">
            {t("partners.wlAsk")}{" "}
            <Link to="/tsp" className="text-[color:var(--brand-cyan)] hover:underline">{t("partners.wlLink")}</Link>
          </p>
        </div>

        <div className="surface-card p-7">
          {state === "done" ? (
            <div>
              <div className="mono text-[10px] tracking-[0.22em] uppercase text-[var(--brand-green,#10B981)]">{t("partners.doneLabel")}</div>
              <h2 className="display text-2xl font-bold text-ink mt-3">{t("partners.doneTitle")}</h2>
              <p className="mt-3 text-sm text-muted-foreground">
                {t("partners.doneBody")}
              </p>
            </div>
          ) : (
            <form onSubmit={(e) => void onSubmit(e)} className="relative grid gap-4">
              <div className="mono text-[10px] tracking-[0.22em] uppercase text-muted-foreground">{t("partners.formLabel")}</div>
              <F name="name" label={t("partners.name")} required />
              <F name="email" label={t("partners.email")} type="email" required />
              <F name="company" label={t("partners.company")} />
              <F name="website" label={t("partners.website")} />
              {/* honeypot: off-screen + aria-hidden; the api answers a fake 201 when filled */}
              <div aria-hidden="true" className="absolute left-[-9999px] top-auto h-px w-px overflow-hidden">
                <label>
                  Leave this field empty
                  <input type="text" name="hp_field" tabIndex={-1} autoComplete="off" />
                </label>
              </div>
              <label className="grid gap-1.5">
                <span className="mono text-[10px] tracking-[0.2em] uppercase text-muted-foreground">{t("partners.message")}</span>
                <textarea
                  name="message"
                  rows={4}
                  className="rounded px-3 py-2 bg-[rgba(10,20,40,0.6)] border border-[var(--hairline)] text-ink text-sm outline-none focus:border-[color:var(--brand-blue)]"
                />
              </label>
              {error && <p className="text-sm text-[#DC2626]">{error}</p>}
              <button
                type="submit"
                disabled={state === "loading"}
                className="h-11 rounded bg-[var(--brand-blue)] text-white mono text-xs tracking-[0.18em] uppercase hover:opacity-90 disabled:opacity-60 cursor-pointer"
              >
                {state === "loading" ? t("partners.submitting") : t("partners.submit")}
              </button>
            </form>
          )}
        </div>
      </section>
    </div>
  );
}

function F({ label, name, ...rest }: { label: string; name: string } & React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <label className="grid gap-1.5">
      <span className="mono text-[10px] tracking-[0.2em] uppercase text-muted-foreground">{label}</span>
      <input
        name={name}
        {...rest}
        className="h-11 rounded px-3 bg-[rgba(10,20,40,0.6)] border border-[var(--hairline)] text-ink text-sm outline-none focus:border-[color:var(--brand-blue)]"
      />
    </label>
  );
}
