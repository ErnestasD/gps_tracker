import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { ArrowRight, Check } from "lucide-react";
import { ApiError, apiPost, DASH_URL } from "@/lib/api";
import { readRefCode } from "@/lib/consent";

// signupSchema (packages/shared) accepts ref only as a 3–64 url-safe slug; a shorter/
// junk code must not 400 the whole signup, so it is dropped client-side too.
const REF_RE = /^[a-zA-Z0-9_-]{3,64}$/;

/** Text-input form values only — a File can never appear in these forms. */
function formVal(fd: FormData, k: string): string {
  const v = fd.get(k);
  return typeof v === "string" ? v : "";
}


export const Route = createFileRoute("/signup")({
  head: () => ({
    meta: [
      { title: "Create your Orbetra account — 30-day free trial" },
      { name: "description", content: "Start a free 30-day Orbetra trial. Live GPS tracking for small fleets on Teltonika devices. No credit card required." },
      { property: "og:title", content: "Create your Orbetra account" },
      { property: "og:description", content: "Start a free 30-day Orbetra trial. No credit card required." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: SignupPage,
});

function SignupPage() {
  const [ref, setRef] = useState<string | null>(null);
  const [state, setState] = useState<"idle" | "loading" | "done">("idle");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => setRef(readRefCode()), []);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setState("loading");
    const fd = new FormData(e.currentTarget);
    try {
      await apiPost(`/v1/public/signup`, {
        name: formVal(fd, "name").trim(),
        email: formVal(fd, "email").trim(),
        password: formVal(fd, "password"),
        company: formVal(fd, "company").trim() || undefined,
        ref: ref && REF_RE.test(ref) ? ref : undefined,
        hp_field: formVal(fd, "hp_field"), // honeypot — must stay empty
      });
      setState("done");
    } catch (err) {
      if (err instanceof ApiError && err.status === 409) {
        setError("That email is already in use — sign in at the dashboard instead.");
      } else if (err instanceof ApiError && err.status === 429) {
        setError("Too many attempts — please wait a bit and try again.");
      } else {
        setError(err instanceof Error ? err.message : "Something went wrong");
      }
      setState("idle");
    }
  }

  return (
    <div className="mx-auto max-w-6xl px-6 pt-24 md:pt-32 pb-24 grid gap-14 lg:grid-cols-[1fr_minmax(0,460px)] items-start">
      <div>
        <span className="section-label">
          <span className="h-[1px] w-6 bg-[var(--brand-blue)]" />
          — CREATE ACCOUNT
        </span>
        <h1 className="display text-4xl md:text-5xl font-bold mt-5 text-ink leading-[1.05]">
          Start tracking today.<br />
          <span className="text-gradient">30 days, on us.</span>
        </h1>
        <ul className="mt-8 grid gap-3 text-sm text-ink/90">
          {[
            "No credit card — cancel anytime",
            "One SMS points your Teltonika device at Orbetra",
            "EU-hosted · GDPR export & erase built in",
            "Flat per-vehicle pricing when the trial ends",
          ].map((f) => (
            <li key={f} className="flex items-center gap-3">
              <span className="grid place-items-center h-5 w-5 rounded-full bg-[rgba(76,77,207,0.1)] border border-[rgba(76,77,207,0.3)] shrink-0">
                <Check className="h-3 w-3 text-[#4c4dcf]" strokeWidth={2.5} />
              </span>
              {f}
            </li>
          ))}
        </ul>
        <p className="mt-8 text-sm text-muted-foreground">
          Running a tracking business instead?{" "}
          <Link to="/tsp" className="text-[color:var(--brand-cyan)] hover:underline">
            See the white-label track →
          </Link>
        </p>
      </div>

      <div className="surface-card p-7">
        {state === "done" ? (
          <div>
            <div className="mono text-[10px] tracking-[0.22em] uppercase text-[var(--brand-green,#10B981)]">
              — YOU'RE IN
            </div>
            <h2 className="display text-2xl font-bold text-ink mt-3">Workspace created</h2>
            <p className="mt-3 text-sm text-muted-foreground">
              Your trial workspace is ready. Sign in at the fleet dashboard with the email
              and password you just chose, then add your first device.
            </p>
            <a href={DASH_URL} className="mt-6 pill-primary hover:pill-primary-hover">
              Sign in at the dashboard <ArrowRight className="h-4 w-4" />
            </a>
          </div>
        ) : (
          <form onSubmit={(e) => void onSubmit(e)} className="relative grid gap-4">
            <Field name="name" label="Full name" autoComplete="name" required />
            <Field name="email" label="Work email" type="email" autoComplete="email" required />
            <Field name="password" label="Password" type="password" autoComplete="new-password" required minLength={8} />
            <Field name="company" label="Company (optional)" autoComplete="organization" />
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
                Referral applied · {ref}
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
              {state === "loading" ? "Creating…" : "Create account"}
            </button>
            <p className="text-xs text-muted-foreground">
              By creating an account you agree to our{" "}
              <Link to="/terms" className="text-[color:var(--brand-cyan)] hover:underline">Terms</Link> and{" "}
              <Link to="/privacy" className="text-[color:var(--brand-cyan)] hover:underline">Privacy Policy</Link>.
            </p>
            <p className="text-xs text-muted-foreground border-t border-[var(--hairline)] pt-4">
              Already have an account?{" "}
              <Link to="/login" className="text-[color:var(--brand-cyan)] hover:underline">
                Sign in
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
