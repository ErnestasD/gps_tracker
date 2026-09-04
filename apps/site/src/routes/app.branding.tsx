import { createFileRoute } from "@tanstack/react-router";
import * as React from "react";
import { useTranslation } from "react-i18next";
import { Check, Copy, Info } from "lucide-react";
import { contentFor } from "@/lib/demo-content";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { AdminButton, AdminInput, AdminLabel, Badge, PageHeader } from "@/components/admin/AdminKit";

export const Route = createFileRoute("/app/branding")({
  component: BrandingPage,
});

/** DEMO mirror of the real product's Branding page (apps/web app/branding.tsx), speaking the
 * product's own translations (admin namespace, branding.*): white-label form (product name,
 * support e-mail, colors with editable hex, logo URL, live preview chip) and custom domains —
 * platform subdomain or own domain with DNS TXT verification. Static data, no backend. */

type DemoDomain = { id: string; domain: string; verified: boolean; txtToken: string | null };

const PLATFORM_DOMAIN = "orbetra.com";
/**
 * The CNAME target the product hands out — `EDGE_HOSTNAME` on the server, `dash.orbetra.com` today.
 *
 * The demo said `edge.orbetra.com`, a host that does not exist: a prospect copying it out of the
 * demo would point their domain at nothing. A demo may simplify; it may not hand over a value that
 * is wrong.
 */
const DNS_TARGET = "dash.orbetra.com";

/** The address behind DNS_TARGET — what a domain ROOT must be pointed at, since it cannot CNAME. */
const DNS_ADDRESS = "185.80.129.33";

function BrandingPage() {
  const { t, i18n } = useTranslation("admin");
  const c = contentFor(i18n.language);
  const [productName, setProductName] = React.useState(`${c.company} Track`);
  const [supportEmail, setSupportEmail] = React.useState(c.supportEmail);
  const [primary, setPrimary] = React.useState("#7c7df5");
  const [accent, setAccent] = React.useState("#7c5cfc");
  const [logoUrl, setLogoUrl] = React.useState("");
  const [faviconUrl, setFaviconUrl] = React.useState("");
  const [saved, setSaved] = React.useState(false);
  const [domains, setDomains] = React.useState<DemoDomain[]>([
    { id: "d-1", domain: `${c.domain.split(".")[0]}.orbetra.com`, verified: true, txtToken: null },
    { id: "d-2", domain: `fleet.${c.domain}`, verified: false, txtToken: "9f2c4e71a8d05b36" },
  ]);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    setSaved(true);
  };

  return (
    <div className="space-y-4 p-4 md:p-8">
      <PageHeader
        className="mb-0"
        title={t("branding.title")}
        description={t("branding.desc")}
      />

      <div className="admin-card p-5">
        <h3 className="mb-4 text-sm font-semibold" style={{ color: "var(--admin-ink)" }}>
          {t("branding.appearance")}
        </h3>
        <form onSubmit={submit}>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <div>
              <AdminLabel htmlFor="branding-productName">{t("branding.productName")}</AdminLabel>
              <AdminInput id="branding-productName" value={productName} onChange={(e) => setProductName(e.target.value)} />
            </div>
            <div>
              <AdminLabel htmlFor="branding-supportEmail">{t("branding.supportEmail")}</AdminLabel>
              <AdminInput id="branding-supportEmail" type="email" value={supportEmail} onChange={(e) => setSupportEmail(e.target.value)} />
            </div>
            <div>
              <AdminLabel htmlFor="branding-primary">{t("branding.primary")}</AdminLabel>
              <div className="flex items-center gap-2">
                <input
                  id="branding-primary"
                  type="color"
                  value={primary}
                  onChange={(e) => setPrimary(e.target.value)}
                  className="h-9 w-14 cursor-pointer rounded-md border"
                  style={{ borderColor: "var(--admin-hairline)", background: "var(--admin-surface)" }}
                />
                <HexInput value={primary} onCommit={setPrimary} label={t("branding.primary")} />
              </div>
            </div>
            <div>
              <AdminLabel htmlFor="branding-accent">{t("branding.accent")}</AdminLabel>
              <div className="flex items-center gap-2">
                <input
                  id="branding-accent"
                  type="color"
                  value={accent}
                  onChange={(e) => setAccent(e.target.value)}
                  className="h-9 w-14 cursor-pointer rounded-md border"
                  style={{ borderColor: "var(--admin-hairline)", background: "var(--admin-surface)" }}
                />
                <HexInput value={accent} onCommit={setAccent} label={t("branding.accent")} />
              </div>
            </div>
            {/* The demo shows BOTH image fields because the product has both. It does not offer the
                upload button: this page writes to nothing, and a file picker that silently discards
                the file is a worse promise than no file picker at all. */}
            <div className="md:col-span-2">
              <AdminLabel htmlFor="branding-logoUrl">{t("branding.logoUrl")}</AdminLabel>
              <AdminInput id="branding-logoUrl" value={logoUrl} onChange={(e) => setLogoUrl(e.target.value)} placeholder="https://…" />
              <p className="mt-1 text-xs" style={{ color: "var(--admin-ink-faint)" }}>{t("branding.logoHint")}</p>
            </div>
            <div className="md:col-span-2">
              <AdminLabel htmlFor="branding-faviconUrl">{t("branding.faviconUrl")}</AdminLabel>
              <AdminInput id="branding-faviconUrl" value={faviconUrl} onChange={(e) => setFaviconUrl(e.target.value)} placeholder="https://…" />
              <p className="mt-1 text-xs" style={{ color: "var(--admin-ink-faint)" }}>{t("branding.faviconHint")}</p>
            </div>
          </div>
          <div className="mt-4 flex flex-wrap items-center gap-3">
            <AdminButton type="submit">{t("branding.save")}</AdminButton>
            {saved && (
              <span role="status" className="text-sm" style={{ color: "var(--admin-success)" }}>
                {t("branding.savedMsg")}
              </span>
            )}
            <span
              className="ml-auto inline-flex items-center gap-2 rounded-md px-3 py-1.5 text-xs"
              style={{ background: "var(--admin-surface-sunken)", color: "var(--admin-ink-soft)" }}
            >
              {t("branding.preview")}
              <span className="h-4 w-4 rounded-full" style={{ background: primary }} />
              <span className="h-4 w-4 rounded-full" style={{ background: accent }} />
            </span>
          </div>
        </form>
      </div>

      <div className="admin-card p-5">
        <h3 className="mb-4 text-sm font-semibold" style={{ color: "var(--admin-ink)" }}>
          {t("branding.domains")}
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
                    <Badge tone="success">{t("branding.verified")}</Badge>
                  ) : (
                    <>
                      <Badge tone="warning">{t("branding.pending")}</Badge>
                      <AdminButton
                        variant="secondary"
                        size="sm"
                        onClick={() => setDomains((all) => all.map((x) => (x.id === d.id ? { ...x, verified: true, txtToken: null } : x)))}
                      >
                        {t("branding.verify")}
                      </AdminButton>
                    </>
                  )}
                  <AdminButton
                    variant="ghost"
                    size="sm"
                    style={{ background: "transparent", color: "var(--admin-danger)" }}
                    onClick={() => setDomains((all) => all.filter((x) => x.id !== d.id))}
                  >
                    {t("branding.remove")}
                  </AdminButton>
                </div>
                {!d.verified && d.txtToken !== null && <DnsRecords domain={d.domain} txtToken={d.txtToken} />}
              </li>
            ))}
          </ul>
          <p className="text-xs" style={{ color: "var(--admin-ink-soft)" }}>
            {t("branding.certNote")}
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
  const { t } = useTranslation("admin");
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
            {m === "sub" ? t("branding.modeSub", { domain: PLATFORM_DOMAIN }) : t("branding.modeOwn")}
          </label>
        ))}
      </div>
      {mode === "sub" ? (
        <>
          <form onSubmit={add} className="flex items-center gap-2">
            <AdminInput aria-label={t("branding.slugLabel")} value={slug} onChange={(e) => setSlug(e.target.value)} placeholder="acme" className="max-w-[10rem]" />
            <span className="mono text-sm" style={{ color: "var(--admin-ink-soft)" }}>.{PLATFORM_DOMAIN}</span>
            <AdminButton type="submit" disabled={slug.trim() === ""}>{t("branding.addDomain")}</AdminButton>
          </form>
          <p className="text-xs" style={{ color: "var(--admin-ink-soft)" }}>
            {t("branding.subNote")}
          </p>
        </>
      ) : (
        <>
          <form onSubmit={add} className="flex gap-2">
            <AdminInput aria-label={t("branding.domainLabel")} value={domain} onChange={(e) => setDomain(e.target.value)} placeholder="fleet.example.com" className="max-w-xs" />
            <AdminButton type="submit" disabled={domain.trim() === ""}>{t("branding.addDomain")}</AdminButton>
          </form>
          {/* Nothing about DNS before a domain exists: naming the CNAME target above an empty form
              is an instruction with no subject, and it taught a one-record setup when there are
              two. The table appears WITH the domain — see DnsRecords. */}
        </>
      )}
    </div>
  );
}

/**
 * The DNS records a pending domain needs, as a table — Type, Name, Value, each copyable.
 *
 * The dashboard's own panel, mirrored: what was here printed the single string
 * `orbetra-verify=<token>` under "add this TXT record", which reads as a record NAMED
 * `orbetra-verify` with that value. It is not — it is a TXT on `_orbetra-verify.<domain>` whose
 * value is the token alone. A demo that teaches the wrong shape is worse than one that says
 * nothing, because a prospect will try it.
 */
function DnsRecords({ domain, txtToken }: { domain: string; txtToken: string }) {
  const { t } = useTranslation("admin");
  const [copied, setCopied] = React.useState<string | null>(null);
  /**
   * The demo has no DNS to look at, so the statuses are FIXED: the TXT found, the routing not.
   *
   * That pair is the state worth showing — it is the one a real tenant most often lands in, and
   * the one a single Verify button could not describe. Inventing a "both green" demo would make
   * the column look decorative, which is the opposite of its point.
   */
  // does this address have a word in front of the domain? a bare one cannot take a CNAME
  const prefixed = domain.split(".").length > 2;
  const rows = [
    // names (and hostname VALUES) carry the trailing dot: without it a zone-file panel appends the
    // zone again and the record lands at fleet.example.com.example.com — see apps/web branding.ts
    { type: "TXT", name: `_orbetra-verify.${domain}.`, value: txtToken, hint: t("branding.dnsHintTxt"), ok: true },
    // ONE routing record, chosen by the shape of the address — never both with labels on them
    prefixed
      ? { type: "CNAME", name: `${domain}.`, value: `${DNS_TARGET}.`, hint: t("branding.dnsHintCname"), ok: false }
      : { type: "A", name: `${domain}.`, value: DNS_ADDRESS, hint: t("branding.dnsHintA"), ok: false },
  ];
  const copy = (text: string, key: string) => {
    void navigator.clipboard?.writeText(text).then(() => {
      setCopied(key);
      setTimeout(() => setCopied((c) => (c === key ? null : c)), 1500);
    }).catch(() => undefined);
  };
  const Field = ({ text, k }: { text: string; k: string }) => (
    <span className="flex items-start gap-1">
      <code className="mono break-all" style={{ color: "var(--admin-ink)" }}>{text}</code>
      <button
        type="button"
        onClick={() => copy(text, k)}
        aria-label={`${t("branding.copy")}: ${text}`}
        title={copied === k ? t("branding.copied") : t("branding.copy")}
        className="shrink-0 rounded p-0.5"
        style={{ color: copied === k ? "var(--admin-success)" : "var(--admin-ink-soft)" }}
      >
        {copied === k ? <Check className="h-3.5 w-3.5" aria-hidden /> : <Copy className="h-3.5 w-3.5" aria-hidden />}
      </button>
    </span>
  );
  return (
    <div
      className="w-full rounded-md border p-3 text-xs"
      style={{ borderColor: "var(--admin-hairline)", background: "var(--admin-surface-sunken)" }}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="font-semibold" style={{ color: "var(--admin-ink)" }}>{t("branding.dnsTitle")}</span>
        <Hint label={t("branding.dnsHelpTitle")} body={t("branding.dnsHelp", { domain })} />
      </div>
      <p className="mt-0.5" style={{ color: "var(--admin-ink-soft)" }}>{t("branding.dnsIntro")}</p>
      <div className="mt-2 overflow-x-auto">
        <table className="w-full min-w-[34rem] border-separate border-spacing-y-1">
          <thead>
            <tr className="text-left" style={{ color: "var(--admin-ink-soft)" }}>
              <th className="pr-3 font-medium">{t("branding.dnsType")}</th>
              <th className="pr-3 font-medium">{t("branding.dnsName")}</th>
              <th className="pr-3 font-medium">{t("branding.dnsValue")}</th>
              <th className="font-medium">{t("branding.dnsStatus")}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={`${r.type}-${r.value}`}>
                <td className="pr-3 align-top">
                  <span className="inline-flex items-center gap-1">
                    <span className="mono font-semibold" style={{ color: "var(--admin-ink)" }}>{r.type}</span>
                    <Hint label={t("branding.dnsWhatIs")} body={r.hint} />
                  </span>
                </td>
                <td className="pr-3 align-top"><Field text={r.name} k={`${r.type}-name`} /></td>
                <td className="pr-3 align-top"><Field text={r.value} k={`${r.type}-value`} /></td>
                <td className="align-top">
                  <Badge tone={r.ok ? "success" : "warning"}>{r.ok ? t("branding.dnsFound") : t("branding.dnsMissing")}</Badge>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/** An ⓘ that opens its explanation — the demo's copy of the dashboard's. */
function Hint({ label, body }: { label: string; body: string }) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={label}
          className="grid h-4 w-4 shrink-0 place-items-center rounded-full transition-colors hover:bg-[var(--admin-hairline)]"
          style={{ color: "var(--admin-ink-soft)" }}
        >
          <Info className="h-3.5 w-3.5" aria-hidden />
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-80 text-xs">
        <div className="mb-1 font-semibold" style={{ color: "var(--admin-ink)" }}>{label}</div>
        {body.split("\n\n").map((para) => (
          <p key={para.slice(0, 24)} className="mt-1 first:mt-0" style={{ color: "var(--admin-ink-soft)" }}>{para}</p>
        ))}
      </PopoverContent>
    </Popover>
  );
}
