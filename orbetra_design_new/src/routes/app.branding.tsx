import { createFileRoute } from "@tanstack/react-router";
import * as React from "react";
import { Upload } from "lucide-react";
import { PageHeader, AdminButton, AdminInput, AdminLabel } from "@/components/admin/AdminKit";
import { toast } from "sonner";

export const Route = createFileRoute("/app/branding")({
  component: BrandingPage,
});

function BrandingPage() {
  const [name, setName] = React.useState("Demo Logistics");
  const [email, setEmail] = React.useState("");
  const [primary, setPrimary] = React.useState("#22D3EE");
  const [accent, setAccent] = React.useState("#7C3AED");
  const [logo, setLogo] = React.useState("");
  const [domains, setDomains] = React.useState<string[]>([]);
  const [newDomain, setNewDomain] = React.useState("");

  return (
    <div className="mx-auto max-w-5xl px-4 py-6 md:px-8 md:py-8">
      <PageHeader title="Prekės ženklas" description="White-label — savas pavadinimas, spalvos ir domenas." />

      <div className="admin-card p-5">
        <h3 className="mb-4 font-semibold" style={{ color: "var(--admin-ink)" }}>Išvaizda</h3>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <div><AdminLabel>Produkto pavadinimas</AdminLabel><AdminInput value={name} onChange={(e) => setName(e.target.value)} /></div>
          <div><AdminLabel>Pagalbos el. paštas</AdminLabel><AdminInput value={email} onChange={(e) => setEmail(e.target.value)} placeholder="pagalba@jusu.lt" /></div>
          <div>
            <AdminLabel>Pagrindinė spalva</AdminLabel>
            <div className="flex items-center gap-2">
              <input type="color" value={primary} onChange={(e) => setPrimary(e.target.value)} className="h-9 w-14 cursor-pointer rounded border" style={{ borderColor: "var(--admin-hairline)" }} />
              <AdminInput value={primary} onChange={(e) => setPrimary(e.target.value)} className="mono" />
            </div>
          </div>
          <div>
            <AdminLabel>Akcento spalva</AdminLabel>
            <div className="flex items-center gap-2">
              <input type="color" value={accent} onChange={(e) => setAccent(e.target.value)} className="h-9 w-14 cursor-pointer rounded border" style={{ borderColor: "var(--admin-hairline)" }} />
              <AdminInput value={accent} onChange={(e) => setAccent(e.target.value)} className="mono" />
            </div>
          </div>
          <div className="md:col-span-2">
            <AdminLabel>Logotipo URL</AdminLabel>
            <div className="flex gap-2">
              <AdminInput value={logo} onChange={(e) => setLogo(e.target.value)} placeholder="https://…" />
              <AdminButton variant="secondary"><Upload className="h-4 w-4" />Įkelti</AdminButton>
            </div>
          </div>
        </div>
        <div className="mt-4 flex justify-between">
          <AdminButton onClick={() => toast.success("Prekės ženklas išsaugotas (demo)")}>Išsaugoti</AdminButton>
          <div className="flex items-center gap-2 rounded-md px-3 py-1.5" style={{ background: "var(--admin-surface-sunken)" }}>
            <span className="text-xs" style={{ color: "var(--admin-ink-soft)" }}>Peržiūra</span>
            <span className="h-4 w-4 rounded-full" style={{ background: primary }} />
            <span className="h-4 w-4 rounded-full" style={{ background: accent }} />
          </div>
        </div>
      </div>

      <div className="mt-4 admin-card p-5">
        <h3 className="mb-4 font-semibold" style={{ color: "var(--admin-ink)" }}>Nuosavi domenai</h3>
        <div className="flex gap-2">
          <AdminInput value={newDomain} onChange={(e) => setNewDomain(e.target.value)} placeholder="fleet.example.com" />
          <AdminButton
            onClick={() => {
              if (newDomain) { setDomains((d) => [...d, newDomain]); setNewDomain(""); toast.success("Domenas įtrauktas"); }
            }}
          >Pridėti</AdminButton>
        </div>
        {domains.length === 0 ? (
          <p className="mt-3 text-sm" style={{ color: "var(--admin-ink-soft)" }}>Nuosavų domenų dar nėra.</p>
        ) : (
          <ul className="mt-3 flex flex-col gap-2">
            {domains.map((d) => (
              <li key={d} className="flex items-center justify-between rounded-md border p-2 text-sm" style={{ borderColor: "var(--admin-hairline)" }}>
                <span className="mono">{d}</span>
                <button onClick={() => setDomains((all) => all.filter((x) => x !== d))} className="text-xs" style={{ color: "var(--admin-danger)" }}>Šalinti</button>
              </li>
            ))}
          </ul>
        )}
        <p className="mt-3 text-xs" style={{ color: "var(--admin-ink-soft)" }}>
          HTTPS sertifikatai išduodami automatiškai per pirmą saugų užklausą po domeno patvirtinimo.
        </p>
      </div>
    </div>
  );
}
