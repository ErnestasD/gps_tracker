import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { apiPost } from "@/lib/api";

export const Route = createFileRoute("/partner/set-password")({
  head: () => ({
    meta: [
      { title: "Set your partner password — Orbetra" },
      { name: "description", content: "Set the password for your Orbetra partner account using the invite link we sent you." },
      { property: "og:title", content: "Set your partner password — Orbetra" },
      { property: "og:description", content: "Activate your Orbetra partner account." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: SetPassword,
});


/** Text-input form values only — a File can never appear in these forms. */
function formVal(fd: FormData, k: string): string {
  const v = fd.get(k);
  return typeof v === "string" ? v : "";
}

function SetPassword() {
  const { t } = useTranslation();
  const [token, setToken] = useState("");
  const [state, setState] = useState<"idle" | "loading" | "done">("idle");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const t = new URLSearchParams(window.location.search).get("token");
    if (t) setToken(t);
  }, []);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const password = formVal(fd, "password");
    if (password !== formVal(fd, "confirm")) {
      setError(t("partner.setPassword.mismatch"));
      return;
    }
    setError(null);
    setState("loading");
    try {
      await apiPost("/v1/partner/set-password", { token, password });
      setState("done");
    } catch (err) {
      setError(err instanceof Error ? err.message : t("partner.setPassword.error"));
      setState("idle");
    }
  }

  return (
    <div className="mx-auto max-w-md px-6 pt-28 md:pt-36 pb-28">
      <span className="section-label">
        <span className="h-[1px] w-6 bg-[var(--brand-blue)]" />
        {t("partner.portal")}
      </span>
      <h1 className="display text-3xl md:text-4xl font-bold mt-4 text-ink">{t("partner.setPassword.title")}</h1>
      {state === "done" ? (
        <div className="surface-card p-7 mt-8">
          <p className="text-sm text-muted-foreground">{t("partner.setPassword.done")}</p>
          <Link to="/partner/login" className="mt-5 pill-primary hover:pill-primary-hover">{t("partner.setPassword.doneCta")}</Link>
        </div>
      ) : (
        <form onSubmit={(e) => void onSubmit(e)} className="surface-card p-7 mt-8 grid gap-4">
          <label className="grid gap-1.5">
            <span className="mono text-[10px] tracking-[0.2em] uppercase text-muted-foreground">{t("partner.setPassword.token")}</span>
            <input value={token} onChange={(e) => setToken(e.target.value)} required
              className="h-11 rounded px-3 bg-[rgba(10,20,40,0.6)] border border-[var(--hairline)] text-ink text-sm outline-none focus:border-[color:var(--brand-blue)] mono text-[12px]" />
          </label>
          <label className="grid gap-1.5">
            <span className="mono text-[10px] tracking-[0.2em] uppercase text-muted-foreground">{t("partner.setPassword.password")}</span>
            <input name="password" type="password" required minLength={8} autoComplete="new-password"
              className="h-11 rounded px-3 bg-[rgba(10,20,40,0.6)] border border-[var(--hairline)] text-ink text-sm outline-none focus:border-[color:var(--brand-blue)]" />
          </label>
          <label className="grid gap-1.5">
            <span className="mono text-[10px] tracking-[0.2em] uppercase text-muted-foreground">{t("partner.setPassword.confirm")}</span>
            <input name="confirm" type="password" required minLength={8} autoComplete="new-password"
              className="h-11 rounded px-3 bg-[rgba(10,20,40,0.6)] border border-[var(--hairline)] text-ink text-sm outline-none focus:border-[color:var(--brand-blue)]" />
          </label>
          {error && <p className="text-sm text-[#DC2626]">{error}</p>}
          <button type="submit" disabled={state === "loading"}
            className="h-11 rounded bg-[var(--brand-blue)] text-white mono text-xs tracking-[0.18em] uppercase hover:opacity-90 disabled:opacity-60 cursor-pointer">
            {state === "loading" ? t("partner.setPassword.submitting") : t("partner.setPassword.submit")}
          </button>
        </form>
      )}
    </div>
  );
}
