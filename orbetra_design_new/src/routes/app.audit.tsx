import { createFileRoute } from "@tanstack/react-router";
import { fmtDate, fmtDateTime } from "@/lib/admin-format";
import { generateAudit, type AuditEntry } from "@/lib/admin-mock";
import { DataTable, type Column } from "@/components/admin/DataTable";
import { PageHeader, Badge } from "@/components/admin/AdminKit";

export const Route = createFileRoute("/app/audit")({
  component: AuditPage,
});

const DATA = generateAudit();

function AuditPage() {
  const columns: Column<AuditEntry>[] = [
    { key: "ts", header: "Data", sortable: true, sortValue: (r) => r.ts, cell: (r) => fmtDateTime(r.ts) },
    { key: "actor", header: "Naudotojas", cell: (r) => r.actor },
    {
      key: "action", header: "Veiksmas", sortable: true, sortValue: (r) => r.action,
      filterValue: (r) => r.action,
      filterOptions: [...new Set(DATA.map((d) => d.action))].map((a) => ({ label: a, value: a })),
      cell: (r) => <Badge tone="brand">{r.action}</Badge>,
    },
    { key: "target", header: "Objektas", cell: (r) => <span className="mono text-xs">{r.target}</span>, hideOnMobile: true },
    { key: "ip", header: "IP", cell: (r) => <span className="mono text-xs">{r.ip}</span>, hideOnMobile: true },
  ];

  return (
    <div className="mx-auto max-w-7xl px-4 py-6 md:px-8 md:py-8">
      <PageHeader title="Audito žurnalas" description="Kas ir kada atliko veiksmus sistemoje." />
      <DataTable data={DATA} columns={columns} searchKeys={["actor", "action", "target", "ip"]} pageSize={15} />
    </div>
  );
}
