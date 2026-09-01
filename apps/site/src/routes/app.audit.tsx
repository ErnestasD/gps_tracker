import { createFileRoute } from "@tanstack/react-router";
import * as React from "react";
import { AdminButton, Badge, PageHeader } from "@/components/admin/AdminKit";
import { Combobox } from "@/components/admin/Combobox";

export const Route = createFileRoute("/app/audit")({
  component: AuditPage,
});

/** DEMO mirror of the real product's Audit log page (apps/web app/audit.tsx):
 * tenant mutation trail — filter by entity/action, expand a row to see the
 * before/after snapshot, "Rodyti daugiau" pagination. Static data, no backend. */

type AuditAction = "create" | "update" | "delete";

type DemoAuditRow = {
  id: string;
  at: string;
  action: AuditAction;
  entity: string;
  entityId: string;
  userId: string | null;
  before: unknown;
  after: unknown;
};

const ACTION_LABELS: Record<AuditAction, string> = {
  create: "Sukurta",
  update: "Atnaujinta",
  delete: "Ištrinta",
};

const ENTITY_LABELS: Record<string, string> = {
  device: "Įrenginys",
  rule: "Taisyklė",
  geofence: "Geozona",
  user: "Naudotojas",
  branding: "Prekės ženklas",
  domain: "Domenas",
  driver: "Vairuotojas",
  accountPrefs: "Kalba ir vienetai",
  apiKey: "API raktas",
  scheduledReport: "Suplanuota ataskaita",
};

const ROWS: DemoAuditRow[] = [
  {
    id: "a-01", at: "2026-08-31 09:41", action: "update", entity: "device",
    entityId: "01J9V4Q2M8KZT3B7NDF5W6H2C4", userId: "9f2c4e71",
    before: { label: "VLN-012", name: "Vilnius 12" },
    after: { label: "VLN-012", name: "Vilnius 12 (rezervas)" },
  },
  {
    id: "a-02", at: "2026-08-31 08:17", action: "create", entity: "geofence",
    entityId: "01J9V3TCM1P8RQXW5KD2N7F9E6", userId: "9f2c4e71",
    before: null,
    after: { name: "Kauno sandėlis", type: "polygon", alertOnExit: true },
  },
  {
    id: "a-03", at: "2026-08-30 17:52", action: "update", entity: "rule",
    entityId: "01J9TZR8V4W2XKQ6MB3CD5H7N9", userId: "3b8d15ac",
    before: { name: "Greičio viršijimas", threshold: 90, channels: ["email"] },
    after: { name: "Greičio viršijimas", threshold: 95, channels: ["email", "webpush"] },
  },
  {
    id: "a-04", at: "2026-08-30 14:05", action: "delete", entity: "apiKey",
    entityId: "01J9TN2WQ7X4KZ8RB1MD6F3C5E", userId: "9f2c4e71",
    before: { name: "Senoji integracija", scopes: ["read:positions"] },
    after: null,
  },
  {
    id: "a-05", at: "2026-08-29 11:23", action: "create", entity: "user",
    entityId: "01J9RKX5T2M9WQ4NB7CD8F1E3H", userId: "9f2c4e71",
    before: null,
    after: { email: "dispeceris@demolog.lt", role: "viewer" },
  },
  {
    id: "a-06", at: "2026-08-29 10:48", action: "update", entity: "branding",
    entityId: "01J9RKJ3N6W8XT2QM4BD5C7F9E", userId: "9f2c4e71",
    before: { productName: "Demo Logistics", primary: "#22d3ee" },
    after: { productName: "Demo Logistics Track", primary: "#7c7df5" },
  },
  {
    id: "a-07", at: "2026-08-28 16:34", action: "create", entity: "domain",
    entityId: "01J9P8W2K5X7QT9RM3ND4C6F8E", userId: "3b8d15ac",
    before: null,
    after: { domain: "fleet.demolog.lt", verified: false },
  },
  {
    id: "a-08", at: "2026-08-28 09:12", action: "update", entity: "driver",
    entityId: "01J9NX4T8M2W6KQ5RB9CD1F7E3", userId: "3b8d15ac",
    before: { name: "Tomas Petrauskas", phone: "+370 612 45678" },
    after: { name: "Tomas Petrauskas", phone: "+370 655 90112" },
  },
  {
    id: "a-09", at: "2026-08-27 15:58", action: "update", entity: "accountPrefs",
    entityId: "01J9MHQ7V3X5WT8KM2ND6C4F9E", userId: "9f2c4e71",
    before: { locale: "en", unitSpeed: "kmh" },
    after: { locale: "lt", unitSpeed: "kmh" },
  },
  {
    id: "a-10", at: "2026-08-27 08:40", action: "delete", entity: "rule",
    entityId: "01J9M2K8T4W7XQ1RM5BD3C9F6E", userId: "9f2c4e71",
    before: { name: "Testinė taisyklė", threshold: 60 },
    after: null,
  },
  {
    id: "a-11", at: "2026-08-26 13:26", action: "create", entity: "scheduledReport",
    entityId: "01J9JW6Q2M8XKT4NB7RD5C1F3E", userId: "3b8d15ac",
    before: null,
    after: { type: "mileage", cadence: "weekly", recipients: ["vadyba@demolog.lt"] },
  },
  {
    id: "a-12", at: "2026-08-26 09:03", action: "create", entity: "device",
    entityId: "01J9JN8T5W2XQK7MB4RD9C6F1E", userId: "9f2c4e71",
    before: null,
    after: { imei: "8613270858*****", model: "FMC130", label: "KNS-034" },
  },
  {
    id: "a-13", at: "2026-08-25 17:44", action: "update", entity: "geofence",
    entityId: "01J9H7X2K9M4WT6QB1ND8C5F3E", userId: "3b8d15ac",
    before: { name: "Klaipėdos uostas", alertOnExit: false },
    after: { name: "Klaipėdos uostas", alertOnExit: true },
  },
  {
    id: "a-14", at: "2026-08-25 11:19", action: "update", entity: "user",
    entityId: "01J9GTQ4V8X2WK5RM7BD3C6F9E", userId: "9f2c4e71",
    before: { email: "dispeceris@demolog.lt", role: "viewer" },
    after: { email: "dispeceris@demolog.lt", role: "account_manager" },
  },
  {
    id: "a-15", at: "2026-08-24 14:37", action: "delete", entity: "device",
    entityId: "01J9F5W8T1M6XQ3KB9RD2C4F7E", userId: "3b8d15ac",
    before: { imei: "8613270861*****", model: "FMB920", label: "VLN-007" },
    after: null,
  },
];

const VISIBLE = 10;

const th = "px-4 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wider";
const thStyle: React.CSSProperties = { color: "var(--admin-ink-soft)" };

function AuditPage() {
  const [entity, setEntity] = React.useState("");
  const [action, setAction] = React.useState("");
  const [open, setOpen] = React.useState<string | null>(null);
  const [showAll, setShowAll] = React.useState(false);

  const filtered = ROWS.filter((r) => (entity === "" || r.entity === entity) && (action === "" || r.action === action));
  const rows = showAll ? filtered : filtered.slice(0, VISIBLE);
  const hasMore = !showAll && filtered.length > VISIBLE;

  return (
    <div className="space-y-4 p-4 md:p-8">
      <PageHeader className="mb-0" title="Audito žurnalas" description="Kas, ką ir kada pakeitė — nuomininko pakeitimų istorija.">
        <div className="w-44">
          <Combobox
            value={entity}
            onChange={setEntity}
            options={[
              { value: "", label: "Visi objektai" },
              ...Object.entries(ENTITY_LABELS).map(([value, label]) => ({ value, label })),
            ]}
          />
        </div>
        <div className="w-44">
          <Combobox
            value={action}
            onChange={setAction}
            options={[
              { value: "", label: "Visi veiksmai" },
              ...(Object.keys(ACTION_LABELS) as AuditAction[]).map((a) => ({ value: a, label: ACTION_LABELS[a] })),
            ]}
          />
        </div>
      </PageHeader>

      <div className="admin-card overflow-hidden">
        <div className="admin-hairline-b px-4 py-3 text-sm font-semibold" style={{ color: "var(--admin-ink)" }}>
          Pakeitimų istorija
        </div>
        {rows.length === 0 ? (
          <p className="px-4 py-8 text-center text-sm" style={{ color: "var(--admin-ink-soft)" }}>
            Nėra įrašų pagal šiuos filtrus.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr style={{ background: "var(--admin-surface-sunken)" }}>
                  <th className={th} style={thStyle}>Kada</th>
                  <th className={th} style={thStyle}>Veiksmas</th>
                  <th className={th} style={thStyle}>Objektas</th>
                  <th className={th} style={thStyle}>ID</th>
                  <th className={th} style={thStyle}>Naudotojas</th>
                  <th className="px-4 py-2.5"><span className="sr-only">Detalės</span></th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <React.Fragment key={r.id}>
                    <tr className="admin-hairline-b transition-colors hover:bg-[var(--admin-surface-sunken)]">
                      <td className="px-4 py-2.5 tabular-nums" style={{ color: "var(--admin-ink-soft)" }}>{r.at}</td>
                      <td className="px-4 py-2.5">
                        <Badge tone={r.action === "delete" ? "warning" : "brand"}>{ACTION_LABELS[r.action]}</Badge>
                      </td>
                      <td className="px-4 py-2.5" style={{ color: "var(--admin-ink)" }}>{ENTITY_LABELS[r.entity] ?? r.entity}</td>
                      <td className="mono px-4 py-2.5 text-xs" style={{ color: "var(--admin-ink-soft)" }}>{r.entityId}</td>
                      <td className="mono px-4 py-2.5 text-xs" style={{ color: "var(--admin-ink-soft)" }}>{r.userId ?? "—"}</td>
                      <td className="px-4 py-2.5 text-right">
                        <AdminButton
                          variant="ghost"
                          size="sm"
                          aria-expanded={open === r.id}
                          onClick={() => setOpen((o) => (o === r.id ? null : r.id))}
                        >
                          {open === r.id ? "Slėpti" : "Detalės"}
                        </AdminButton>
                      </td>
                    </tr>
                    {open === r.id && (
                      <tr>
                        <td colSpan={6} className="admin-hairline-b p-3" style={{ background: "var(--admin-surface-sunken)" }}>
                          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                            <Snapshot label="Prieš" value={r.before} />
                            <Snapshot label="Po" value={r.after} />
                          </div>
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {hasMore && (
          <div className="admin-hairline-t p-3 text-center">
            <AdminButton variant="secondary" size="sm" onClick={() => setShowAll(true)}>
              Rodyti daugiau
            </AdminButton>
          </div>
        )}
      </div>
    </div>
  );
}

function Snapshot({ label, value }: { label: string; value: unknown }) {
  return (
    <div>
      <div className="pb-1 text-xs font-medium" style={{ color: "var(--admin-ink-soft)" }}>{label}</div>
      <pre
        className="mono max-h-64 overflow-auto rounded-md border p-2 text-xs"
        style={{ borderColor: "var(--admin-hairline)", background: "var(--admin-surface)", color: "var(--admin-ink)" }}
      >
        {value === null || value === undefined ? "—" : JSON.stringify(value, null, 2)}
      </pre>
    </div>
  );
}
