import { createFileRoute } from "@tanstack/react-router";
import { fmtDate, fmtDateTime } from "@/lib/admin-format";
import * as React from "react";
import { Terminal, Send } from "lucide-react";
import { generateCommands, generateDevices, type Command as CmdRow } from "@/lib/admin-mock";
import { DataTable, type Column } from "@/components/admin/DataTable";
import { PageHeader, AdminButton, Badge, AdminLabel } from "@/components/admin/AdminKit";
import { Combobox } from "@/components/admin/Combobox";
import { toast } from "sonner";

export const Route = createFileRoute("/app/commands")({
  component: CommandsPage,
});

const DATA = generateCommands();
const DEVICES = generateDevices();

function CommandsPage() {
  const [device, setDevice] = React.useState(DEVICES[0].id);
  const [cmd, setCmd] = React.useState("engine-block");

  const columns: Column<CmdRow>[] = [
    { key: "created", header: "Data", sortable: true, sortValue: (r) => r.created, cell: (r) => fmtDateTime(r.created) },
    { key: "device", header: "Įrenginys", cell: (r) => r.device },
    { key: "command", header: "Komanda", cell: (r) => <span className="mono text-xs">{r.command}</span> },
    { key: "operator", header: "Operatorius", cell: (r) => r.operator, hideOnMobile: true },
    {
      key: "status", header: "Būsena", sortable: true, sortValue: (r) => r.status,
      filterValue: (r) => r.status,
      filterOptions: [
        { label: "Eilėje", value: "queued" }, { label: "Išsiųsta", value: "sent" }, { label: "Patvirtinta", value: "ack" }, { label: "Nepavyko", value: "failed" },
      ],
      cell: (r) => <Badge tone={r.status === "ack" ? "success" : r.status === "failed" ? "danger" : r.status === "sent" ? "info" : "warning"}>{r.status}</Badge>,
    },
  ];

  return (
    <div className="mx-auto max-w-7xl px-4 py-6 md:px-8 md:py-8">
      <PageHeader title="Komandos" description="Nuotolinės komandos įrenginiams ir jų būsenų sekimas." />

      <div className="admin-card mb-4 p-5">
        <h3 className="mb-3 flex items-center gap-2 font-semibold" style={{ color: "var(--admin-ink)" }}>
          <Terminal className="h-4 w-4" style={{ color: "var(--admin-brand)" }} /> Siųsti komandą
        </h3>
        <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
          <div><AdminLabel>Įrenginys</AdminLabel><Combobox value={device} onChange={setDevice} options={DEVICES.map((d) => ({ value: d.id, label: d.name, hint: d.plate }))} /></div>
          <div>
            <AdminLabel>Komanda</AdminLabel>
            <Combobox
              value={cmd}
              onChange={setCmd}
              options={[
                { value: "engine-block", label: "Užblokuoti variklį" },
                { value: "engine-unblock", label: "Atblokuoti variklį" },
                { value: "reboot", label: "Perkrauti įrenginį" },
                { value: "request-location", label: "Paklausti dabartinės vietos" },
                { value: "firmware-update", label: "Atnaujinti firmware" },
              ]}
            />
          </div>
          <div className="flex items-end">
            <AdminButton onClick={() => toast.success("Komanda išsiųsta į eilę (demo)")}><Send className="h-4 w-4" />Siųsti</AdminButton>
          </div>
        </div>
      </div>

      <DataTable data={DATA} columns={columns} searchKeys={["device", "command", "operator"]} pageSize={12} />
    </div>
  );
}
