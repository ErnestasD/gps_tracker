import { createFileRoute } from "@tanstack/react-router";
import { fmtDate, fmtDateTime } from "@/lib/admin-format";
import { CreditCard, Download } from "lucide-react";
import { generateInvoices } from "@/lib/admin-mock";
import { DataTable, type Column } from "@/components/admin/DataTable";
import { PageHeader, AdminButton, Badge, StatCard } from "@/components/admin/AdminKit";
import { toast } from "sonner";

export const Route = createFileRoute("/app/billing")({
  component: BillingPage,
});

const DATA = generateInvoices();

function BillingPage() {
  type Inv = (typeof DATA)[number];
  const columns: Column<Inv>[] = [
    { key: "number", header: "Nr.", cell: (r) => <span className="mono text-xs">{r.number}</span> },
    { key: "period", header: "Periodas", cell: (r) => r.period },
    { key: "amount", header: "Suma", align: "right", sortable: true, sortValue: (r) => r.amount, cell: (r) => `€${r.amount}` },
    { key: "issued", header: "Išrašyta", cell: (r) => fmtDate(r.issued), hideOnMobile: true },
    { key: "due", header: "Terminas", cell: (r) => fmtDate(r.due), hideOnMobile: true },
    {
      key: "status", header: "Būsena", sortable: true, sortValue: (r) => r.status,
      filterValue: (r) => r.status,
      filterOptions: [{ label: "Apmokėta", value: "paid" }, { label: "Atvira", value: "open" }, { label: "Vėluoja", value: "overdue" }],
      cell: (r) => <Badge tone={r.status === "paid" ? "success" : r.status === "overdue" ? "danger" : "warning"}>{r.status === "paid" ? "apmokėta" : r.status === "overdue" ? "vėluoja" : "atvira"}</Badge>,
    },
  ];

  return (
    <div className="mx-auto max-w-7xl px-4 py-6 md:px-8 md:py-8">
      <PageHeader title="Atsiskaitymai" description="Planas, mokėjimo būdas ir sąskaitos.">
        <AdminButton variant="secondary">Pakeisti planą</AdminButton>
      </PageHeader>

      <div className="mb-4 grid grid-cols-1 gap-3 md:grid-cols-3">
        <StatCard label="Dabartinis planas" value="Small fleet" hint="24 įrenginiai · €168/mėn" />
        <StatCard label="Kitas mokėjimas" value="€168" hint="2026-08-01" />
        <StatCard label="Mokėjimo būdas" value={<><CreditCard className="mr-2 inline h-5 w-5" style={{ color: "var(--admin-brand)" }} />•••• 4242</>} hint="Visa · galioja 08/28" />
      </div>

      <DataTable
        data={DATA}
        columns={columns}
        searchKeys={["number", "period"]}
        pageSize={10}
        rowAction={(r) => (
          <button className="inline-flex items-center gap-1 text-xs" style={{ color: "var(--admin-brand)" }} onClick={() => toast.success(`Parsisiunčiama ${r.number}`)}>
            <Download className="h-3 w-3" /> PDF
          </button>
        )}
      />
    </div>
  );
}
