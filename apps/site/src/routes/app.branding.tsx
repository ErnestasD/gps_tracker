import { createFileRoute } from "@tanstack/react-router";
import * as React from "react";
import { AdminButton, AdminInput, AdminLabel, Badge, PageHeader } from "@/components/admin/AdminKit";

export const Route = createFileRoute("/app/branding")({
  component: BrandingPage,
});

/** DEMO mirror of the real product's Branding page (apps/web app/branding.tsx):
 * white-label form (product name, support e-mail, colors with editable hex, logo URL,
 * live preview chip) and custom domains — platform subdomain or own domain with
 * DNS TXT verification. Static data, no backend. */

type DemoDomain = { id: string; domain: string; verified: boolean; txtToken: string | null };

const PLATFORM_DOMAIN = "orbetra.com";
const DNS_TARGET = "edge.orbetra.com";

function BrandingPage() {
  const [productName, setProductName] = React.useState("Demo Logistics Track");
  const [supportEmail, setSupportEmail] = React.useState("pagalba@demolog.lt");
  const [primary, setPrimary] = React.useState("#7c7df5");
  const [accent, setAccent] = React.useState("#7c5cfc");
  const [logoUrl, setLogoUrl] = React.useState("");
  const [saved, setSaved] = React.useState(false);
  const [domains, setDomains] = React.useState<DemoDomain[]>([
    { id: "d-1", domain: "demolog.orbetra.com", verified: true, txtToken: null },
    { id: "d-2", domain: "fleet.demolog.lt", verified: false, txtToken: "9f2c4e71a8d05b36" },
  ]);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    setSaved(true);
  };

  return (
    <div className="space-y-4 p-4 md:p-8">
      <PageHeader
        className="mb-0"
        title="Prekės ženklas"
        description="White-label išvaizda — jūsų produkto pavadinimas, spalvos ir nuosavi domenai."
      />

      <div className="admin-card p-5">
        <h3 className="mb-4 text-sm font-semibold" style={{ color: "var(--admin-ink)" }}>
          Išvaizda
        </h3>
        <form onSubmit={submit}>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <div>
              <AdminLabel htmlFor="branding-productName">Produkto pavadinimas</AdminLabel>
              <AdminInput id="branding-productName" value={productName} onChange={(e) => setProductName(e.target.value)} />
            </div>
            <div>
              <AdminLabel htmlFor="branding-supportEmail">Pagalbos el. paštas</AdminLabel>
              <AdminInput id="branding-supportEmail" type="email" value={supportEmail} onChange={(e) => setSupportEmail(e.target.value)} />
            </div>
            <div>
              <AdminLabel htmlFor="branding-primary">Pagrindinė spalva</AdminLabel>
              <div className="flex items-center gap-2">
                <input
                  id="branding-primary"
                  type="color"
                  value={primary}
                  onChange={(e) => setPrimary(e.target.value)}
                  className="h-9 w-14 cursor-pointer rounded-md border"
                  style={{ borderColor: "var(--admin-hairline)", background: "var(--admin-surface)" }}
                />
                <HexInput value={primary} onCommit={setPrimary} label="Pagrindinė spalva" />
              </div>
            </div>
            <div>
              <AdminLabel htmlFor="branding-accent">Akcento spalva</AdminLabel>
              <div className="flex items-center gap-2">
                <input
                  id="branding-accent"
                  type="color"
                  value={accent}
                  onChange={(e) => setAccent(e.target.value)}
                  className="h-9 w-14 cursor-pointer rounded-md border"
                  style={{ borderColor: "var(--admin-hairline)", background: "var(--admin-surface)" }}
                />
                <HexInput value={accent} onCommit={setAccent} label="Akcento spalva" />
              </div>
            </div>
            <div className="md:col-span-2">
              <AdminLabel htmlFor="branding-logoUrl">Logotipo URL</AdminLabel>
              <AdminInput id="branding-logoUrl" value={logoUrl} onChange={(e) => setLogoUrl(e.target.value)} placeholder="https://…" />
            </div>
          </div>
          <div className="mt-4 flex flex-wrap items-center gap-3">
            <AdminButton type="submit">Išsaugoti</AdminButton>
            {saved && (
              <span role="status" className="text-sm" style={{ color: "var(--admin-success)" }}>
                Išsaugota
              </span>
            )}
            <span
              className="ml-auto inline-flex items-center gap-2 rounded-md px-3 py-1.5 text-xs"
              style={{ background: "var(--admin-surface-sunken)", color: "var(--admin-ink-soft)" }}
            >
              Peržiūra
              <span className="h-4 w-4 rounded-full" style={{ background: primary }} />
              <span className="h-4 w-4 rounded-full" style={{ background: accent }} />
            </span>
          </div>
        </form>
      </div>

      <div className="admin-card p-5">
        <h3 className="mb-4 text-sm font-semibold" style={{ color: "var(--admin-ink)" }}>
          Nuosavi domenai
        </h3>
        <div className="space-y-3">
          <AddDomain onAdded={(d) => setDomains((all) => [...all, d])} />
          <ul className="flex flex-col gap-2">
            {domains.map((d) => (
              <li
                key={d.id}
                className="flex flex-wrap items-center justify-between gap-2 rounded-md border p-2 text-sm"
                style={{ borderColor: "var(--admin-hairline)" }}
              >
                <span className="mono text-xs" style={{ color: "var(--admin-ink)" }}>{d.domain}</span>
                <div className="flex items-center gap-2">
                  {d.verified ? (
                    <Badge tone="success">Patvirtinta</Badge>
                  ) : (
                    <>
                      <Badge tone="warning">Laukiama</Badge>
                      <AdminButton
                        variant="secondary"
                        size="sm"
                        onClick={() => setDomains((all) => all.map((x) => (x.id === d.id ? { ...x, verified: true, txtToken: null } : x)))}
                      >
                        Patvirtinti
                      </AdminButton>
                    </>
                  )}
                  <AdminButton
                    variant="ghost"
                    size="sm"
                    style={{ background: "transparent", color: "var(--admin-danger)" }}
                    onClick={() => setDomains((all) => all.filter((x) => x.id !== d.id))}
                  >
                    Šalinti
                  </AdminButton>
                </div>
                {!d.verified && d.txtToken !== null && (
                  <div
                    className="w-full rounded-md border p-2 text-xs"
                    style={{ borderColor: "var(--admin-hairline)", background: "var(--admin-surface-sunken)" }}
                  >
                    <p style={{ color: "var(--admin-ink-soft)" }}>
                      Pridėkite šį TXT įrašą prie {d.domain}, tada spauskite Patvirtinti:
                    </p>
                    <code className="mono mt-1 block break-all" style={{ color: "var(--admin-ink)" }}>
                      orbetra-verify={d.txtToken}
                    </code>
                  </div>
                )}
              </li>
            ))}
          </ul>
          <p className="text-xs" style={{ color: "var(--admin-ink-soft)" }}>
            HTTPS sertifikatai išduodami automatiškai per pirmą saugų užklausimą po domeno patvirtinimo.
          </p>
        </div>
      </div>
    </div>
  );
}

/** Editable mono hex field, two-way synced with its color picker: external changes replace the
 * draft; typed values commit only once they are a full valid #rrggbb. */
function HexInput({ value, onCommit, label }: { value: string; onCommit: (v: string) => void; label: string }) {
  const [draft, setDraft] = React.useState(value);
  React.useEffect(() => setDraft(value), [value]);
  const valid = /^#[0-9a-fA-F]{6}$/.test(draft);
  return (
    <AdminInput
      value={draft}
      onChange={(e) => {
        const v = e.target.value;
        setDraft(v);
        if (/^#[0-9a-fA-F]{6}$/.test(v)) onCommit(v);
      }}
      maxLength={7}
      aria-label={label}
      aria-invalid={!valid}
      className="mono w-28 text-xs"
      style={valid ? undefined : { borderColor: "var(--admin-danger)", background: "var(--admin-surface)", color: "var(--admin-ink)" }}
    />
  );
}

/** Add a domain — either an instant platform subdomain or the tenant's own domain (TXT verify). */
function AddDomain({ onAdded }: { onAdded: (d: DemoDomain) => void }) {
  const [mode, setMode] = React.useState<"own" | "sub">("sub");
  const [domain, setDomain] = React.useState("");
  const [slug, setSlug] = React.useState("");

  const add = (e: React.FormEvent) => {
    e.preventDefault();
    const sub = mode === "sub";
    const wanted = sub ? `${slug.trim().toLowerCase()}.${PLATFORM_DOMAIN}` : domain.trim().toLowerCase();
    if (wanted === "" || wanted === `.${PLATFORM_DOMAIN}`) return;
    onAdded({
      id: `d-${Date.now()}`,
      domain: wanted,
      verified: sub,
      txtToken: sub ? null : Math.random().toString(16).slice(2, 18).padEnd(16, "0"),
    });
    setDomain("");
    setSlug("");
  };

  return (
    <div className="space-y-2">
      <div className="flex gap-4 text-sm">
        {(["sub", "own"] as const).map((m) => (
          <label key={m} className="flex cursor-pointer items-center gap-1.5" style={{ color: "var(--admin-ink-soft)" }}>
            <input type="radio" name="domain-mode" checked={mode === m} onChange={() => setMode(m)} />
            {m === "sub" ? `Subdomenas ${PLATFORM_DOMAIN} (iš karto)` : "Nuosavas domenas"}
          </label>
        ))}
      </div>
      {mode === "sub" ? (
        <>
          <form onSubmit={add} className="flex items-center gap-2">
            <AdminInput aria-label="Subdomeno vardas" value={slug} onChange={(e) => setSlug(e.target.value)} placeholder="acme" className="max-w-[10rem]" />
            <span className="mono text-sm" style={{ color: "var(--admin-ink-soft)" }}>.{PLATFORM_DOMAIN}</span>
            <AdminButton type="submit" disabled={slug.trim() === ""}>Pridėti</AdminButton>
          </form>
          <p className="text-xs" style={{ color: "var(--admin-ink-soft)" }}>
            Veikia po kelių sekundžių — DNS keisti nereikia. Čia jungsis jūsų klientai.
          </p>
        </>
      ) : (
        <>
          <form onSubmit={add} className="flex gap-2">
            <AdminInput aria-label="Domenas" value={domain} onChange={(e) => setDomain(e.target.value)} placeholder="fleet.example.com" className="max-w-xs" />
            <AdminButton type="submit" disabled={domain.trim() === ""}>Pridėti</AdminButton>
          </form>
          <p className="text-xs" style={{ color: "var(--admin-ink-soft)" }}>
            Tada nukreipkite šį domeną į mus CNAME įrašu į:{" "}
            <code className="mono" style={{ color: "var(--admin-ink)" }}>{DNS_TARGET}</code>
          </p>
        </>
      )}
    </div>
  );
}
