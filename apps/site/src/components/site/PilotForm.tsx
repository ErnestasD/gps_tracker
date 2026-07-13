import { useState } from "react";
import { Check } from "lucide-react";

import { currentRef } from "@/lib/ref";

/** Build the POST body from the form (pure — unit-tested). The `website` field is a
 * HONEYPOT: visually hidden, humans leave it empty, bots fill it — the api answers a
 * fake 200 and stores nothing. */
export function pilotPayload(form: FormData, ref: string | null): Record<string, string> {
  const val = (k: string) => {
    const v = form.get(k);
    return typeof v === "string" ? v.trim() : ""; // files are impossible here — text inputs only
  };
  return {
    name: val("name"),
    company: val("company"),
    email: val("email"),
    phone: val("phone"),
    deviceCount: val("deviceCount"),
    message: val("message"),
    hp_field: val("hp_field"), // honeypot — must stay empty
    ...(ref !== null ? { ref } : {}),
  };
}

export function PilotForm() {
  const [state, setState] = useState<"idle" | "sending" | "sent" | "error">("idle");

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setState("sending");
    try {
      const body = pilotPayload(new FormData(e.currentTarget), currentRef());
      const base = import.meta.env.VITE_API_URL ?? ""; // same-origin by default (Caddy carves /v1)
      const res = await fetch(`${base}/v1/public/pilot-request`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      setState(res.ok ? "sent" : "error");
    } catch {
      setState("error");
    }
  }

  if (state === "sent") {
    return (
      <div className="surface-card p-10 text-center">
        <div className="mx-auto grid h-14 w-14 place-items-center rounded-full bg-[color:var(--brand-green)]/10 border border-[color:var(--brand-green)]/40">
          <Check className="h-6 w-6 text-[color:var(--brand-green)]" />
        </div>
        <h3 className="mt-6 display text-2xl font-bold text-ink">Signal received.</h3>
        <p className="mt-2 text-muted-foreground">We'll reply within one business day. Real human, real answers.</p>
      </div>
    );
  }

  return (
    <form onSubmit={(e) => void onSubmit(e)} className="surface-card relative p-6 md:p-8 space-y-5">
      <div className="mono text-[10px] tracking-[0.2em] uppercase text-muted-foreground">— FORM.PILOT · v1</div>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Full name" name="name" required />
        <Field label="Company" name="company" required />
        <Field label="Work email" name="email" type="email" required />
        <Field label="Phone (optional)" name="phone" />
      </div>
      <Field label="How many devices?" name="deviceCount" placeholder="e.g. 250" required />
      {/* honeypot: off-screen + aria-hidden; name avoids 'website'/'url' so browser
          autofill skips it (a real user's autofill must not fill it and get discarded) */}
      <div aria-hidden="true" className="absolute left-[-9999px] top-auto h-px w-px overflow-hidden">
        <label>
          Leave this field empty
          <input type="text" name="hp_field" tabIndex={-1} autoComplete="off" />
        </label>
      </div>
      <div>
        <label className="mono text-[11px] tracking-[0.15em] uppercase text-muted-foreground">Anything specific?</label>
        <textarea
          name="message"
          rows={4}
          className="mt-2 w-full rounded-lg border border-[var(--hairline)] bg-[rgba(10,20,40,0.6)] px-3 py-2 text-sm focus:border-[var(--brand-blue)] focus:ring-1 focus:ring-[var(--brand-blue)] outline-none"
          placeholder="Which Teltonika models? Migrating from another platform?"
        />
      </div>
      <button
        type="submit"
        disabled={state === "sending"}
        className="pill-primary hover:pill-primary-hover w-full disabled:opacity-60"
      >
        {state === "sending" ? "Sending…" : "Request pilot"}
      </button>
      {state === "error" && (
        <p role="alert" className="text-xs text-center text-[color:var(--brand-amber,#F59E0B)]">
          Something went wrong — please retry, or write to hello@orbetra.eu.
        </p>
      )}
      <p className="text-xs text-muted-foreground text-center">
        No credit card. 60-day shadow-mode pilot. Reply within one business day.
      </p>
    </form>
  );
}

function Field({ label, name, type = "text", placeholder, required }: {
  label: string; name: string; type?: string; placeholder?: string; required?: boolean;
}) {
  return (
    <div>
      <label className="mono text-[11px] tracking-[0.15em] uppercase text-muted-foreground">{label}</label>
      <input
        name={name}
        type={type}
        required={required}
        placeholder={placeholder}
        className="mt-2 w-full rounded-lg border border-[var(--hairline)] bg-[rgba(10,20,40,0.6)] px-3 py-2 text-sm focus:border-[var(--brand-blue)] focus:ring-1 focus:ring-[var(--brand-blue)] outline-none"
      />
    </div>
  );
}
