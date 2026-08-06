import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { ArrowRight, Check } from "lucide-react";
import { Trans, useTranslation } from "react-i18next";
import { ApiError, apiPost, DASH_URL } from "@/lib/api";
import { readRefCode } from "@/lib/consent";

// signupSchema (packages/shared) accepts ref only as a 3–64 url-safe slug; a shorter/
// junk code must not 400 the whole signup, so it is dropped client-side too.
const REF_RE = /^[a-zA-Z0-9-]{3,64}$/; // mirrors affiliateCodeSchema (no `_` — LIKE wildcard)

/** Text-input form values only — a File can never appear in these forms. */
function formVal(fd: FormData, k: string): string {
  const v = fd.get(k);
  return typeof v === "string" ? v : "";
}


export const Route = createFileRoute("/signup")({
  head: () => ({
    meta: [
      { title: "Create your Orbetra account — 30-day free trial" },
      { name: "description", content: "Start a free 30-day Orbetra trial. Live GPS tracking for small fleets. No credit card required." },
      { property: "og:title", content: "Create your Orbetra account" },
      { property: "og:description", content: "Start a free 30-day Orbetra trial. No credit card required." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: SignupPage,
});

function SignupPage() {
  const { t } = useTranslation();
  const [ref, setRef] = useState<string | null>(null);
  const [state, setState] = useState<"idle" | "loading" | "done">("idle");
  // the address we wrote to, echoed on the done screen. The old copy said "Workspace created" — a
  // confident claim that is FALSE for the half of cases where the address already had an account,
  // and the founder hit exactly that: a success screen promising a new workspace, then an email
  // saying nothing was created. Naming the address and the next step is true in both branches, and
  // says nothing about which one happened (audit MED #67).
  const [sentTo, setSentTo] = useState("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => setRef(readRefCode()), []);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setState("loading");
    const fd = new FormData(e.currentTarget);
    const address = formVal(fd, "email").trim();
    try {
      await apiPost(`/v1/public/signup`, {
        name: formVal(fd, "name").trim(),
        email: address,
        password: formVal(fd, "password"),
        company: formVal(fd, "company").trim() || undefined,
        ref: ref && REF_RE.test(ref) ? ref : undefined,
        // the account's REPORTING zone (server buckets report days by it — hard rule 7), not a
        // display preference. Hard-coded UTC before, so a Lithuanian fleet's "yesterday" ran on the
        // wrong day boundary from day one, with no screen anywhere to correct it. Changeable later
        // in Settings → Account.
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || undefined,
        hp_field: formVal(fd, "hp_field"), // honeypot — must stay empty
      });
      setSentTo(address);
      setState("done");
    } catch (err) {
      // NO 409 branch: the API deliberately answers an already-registered address with the SAME 201
      // as a real signup (audit MED #67 — a distinct status was an unauthenticated
      // account-existence oracle). The owner is told by email; the success copy covers both cases.
      if (err instanceof ApiError && err.status === 429) {
        setError(t("signup.errRate"));
      } else {
        setError(err instanceof Error ? err.message : t("signup.errGeneric"));
      }
      setState("idle");
    }
  }

  return (
    <div className="mx-auto max-w-6xl px-6 pt-24 md:pt-32 pb-24 grid gap-14 lg:grid-cols-[1fr_minmax(0,460px)] items-start">
      <div>
        <span className="section-label">
          <span className="h-[1px] w-6 bg-[var(--brand-blue)]" />
          {t("signup.label")}
        </span>
        <h1 className="display text-4xl md:text-5xl font-bold mt-5 text-ink leading-[1.05]">
          {t("signup.h1")}<br />
          <span className="text-gradient">{t("signup.h2")}</span>
        </h1>
        <ul className="mt-8 grid gap-3 text-sm text-ink/90">
          {(["signup.b1", "signup.b2", "signup.b3", "signup.b4"] as const).map((f) => (
            <li key={f} className="flex items-center gap-3">
              <span className="grid place-items-center h-5 w-5 rounded-full bg-[rgba(76,77,207,0.1)] border border-[rgba(76,77,207,0.3)] shrink-0">
                <Check className="h-3 w-3 text-[#4c4dcf]" strokeWidth={2.5} />
              </span>
              {t(f)}
            </li>
          ))}
        </ul>
        <p className="mt-8 text-sm text-muted-foreground">
          {t("signup.tspAsk")}{" "}
          <Link to="/tsp" className="text-[color:var(--brand-cyan)] hover:underline">
            {t("signup.tspLink")}
          </Link>
        </p>
      </div>

      <div className="surface-card p-7">
        {state === "done" ? (
          <div>
            <div className="mono text-[10px] tracking-[0.22em] uppercase text-[var(--brand-green,#10B981)]">
              {t("signup.doneLabel")}
            </div>
            <h2 className="display text-2xl font-bold text-ink mt-3">{t("signup.doneTitle")}</h2>
            <p className="mt-3 text-sm text-muted-foreground">
              {t("signup.doneBody", { email: sentTo })}
            </p>
            <a href={DASH_URL} className="mt-6 pill-primary hover:pill-primary-hover">
              {t("signup.doneCta")} <ArrowRight className="h-4 w-4" />
            </a>
          </div>
        ) : (
          <form onSubmit={(e) => void onSubmit(e)} className="relative grid gap-4">
            <Field name="name" label={t("signup.name")} autoComplete="name" required />
            <Field name="email" label={t("signup.email")} type="email" autoComplete="email" required />
            <Field name="password" label={t("signup.password")} type="password" autoComplete="new-password" required minLength={8} />
            <Field name="company" label={t("signup.company")} autoComplete="organization" />
            {/* honeypot: off-screen + aria-hidden; the api answers a fake 201 when filled.
                Name avoids 'website'/'url' so a real user's browser autofill skips it. */}
            <div aria-hidden="true" className="absolute left-[-9999px] top-auto h-px w-px overflow-hidden">
              <label>
                Leave this field empty
                <input type="text" name="hp_field" tabIndex={-1} autoComplete="off" />
              </label>
            </div>
            {ref && (
              <p className="mono text-[10px] tracking-widest uppercase text-[color:var(--brand-cyan)]">
                {t("signup.referral", { code: ref })}
              </p>
            )}
            {error && (
              <p className="text-sm text-[#DC2626]">{error}</p>
            )}
            <button
              type="submit"
              disabled={state === "loading"}
              className="mt-1 h-11 rounded bg-[var(--brand-blue)] text-white mono text-xs tracking-[0.18em] uppercase hover:opacity-90 disabled:opacity-60 cursor-pointer"
            >
              {state === "loading" ? t("signup.submitting") : t("signup.submit")}
            </button>
            <p className="text-xs text-muted-foreground">
              {/* the links sit mid-sentence — Trans keeps each language's word order intact */}
              <Trans
                i18nKey="signup.terms"
                components={{
                  terms: <Link to="/terms" className="text-[color:var(--brand-cyan)] hover:underline" />,
                  privacy: <Link to="/privacy" className="text-[color:var(--brand-cyan)] hover:underline" />,
                }}
              />
            </p>
            <p className="text-xs text-muted-foreground border-t border-[var(--hairline)] pt-4">
              {t("signup.haveAccount")}{" "}
              <Link to="/login" className="text-[color:var(--brand-cyan)] hover:underline">
                {t("signup.signin")}
              </Link>
            </p>
          </form>
        )}
      </div>
    </div>
  );
}

function Field({ label, name, ...rest }: { label: string; name: string } & React.InputHTMLAttributes<HTMLInputElement>) {
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
