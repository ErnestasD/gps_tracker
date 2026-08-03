import { createFileRoute } from "@tanstack/react-router";
import * as React from "react";
import { CheckCheck, AlertTriangle, Siren } from "lucide-react";
import { useNotifications, type Notification } from "@/lib/admin-notifications";
import { PageHeader, AdminButton, Badge, StatCard } from "@/components/admin/AdminKit";
import { DataTable, type Column } from "@/components/admin/DataTable";
import { fmtDateTime } from "@/lib/admin-format";

export const Route = createFileRoute("/app/notifications")({
  component: NotificationsPage,
});

const TYPE_LABELS: Record<Notification["type"], string> = {
  speeding: "Greitis",
  geofence: "Geozona",
  sos: "SOS",
  offline: "Offline",
  "harsh-brake": "Stabdymas",
  "harsh-accel": "Greitėjimas",
  ignition: "Užvedimas",
};

function NotificationsPage() {
  const { items, unread, markRead, markAllRead } = useNotifications();

  const critical = items.filter((i) => i.severity === "critical").length;
  const warning = items.filter((i) => i.severity === "warning").length;

  const columns: Column<Notification>[] = [
    {
      key: "read",
      header: "",
      cell: (r) => (
        <span
          className="inline-block h-2 w-2 rounded-full"
          style={{ background: r.read ? "transparent" : "var(--admin-brand)" }}
          aria-label={r.read ? "Perskaitytas" : "Neperskaitytas"}
        />
      ),
    },
    {
      key: "severity",
      header: "Lygis",
      sortable: true,
      sortValue: (r) => r.severity,
      filterValue: (r) => r.severity,
      filterOptions: [
        { label: "Kritinis", value: "critical" },
        { label: "Įspėjimas", value: "warning" },
        { label: "Info", value: "info" },
      ],
      cell: (r) => (
        <Badge tone={r.severity === "critical" ? "danger" : r.severity === "warning" ? "warning" : "neutral"}>
          {r.severity === "critical" ? "Kritinis" : r.severity === "warning" ? "Įspėjimas" : "Info"}
        </Badge>
      ),
    },
    {
      key: "type",
      header: "Tipas",
      sortable: true,
      sortValue: (r) => r.type,
      filterValue: (r) => r.type,
      filterOptions: Object.entries(TYPE_LABELS).map(([value, label]) => ({ label, value })),
      cell: (r) => TYPE_LABELS[r.type],
    },
    { key: "detail", header: "Aprašymas", cell: (r) => <span style={{ fontWeight: r.read ? 400 : 600 }}>{r.detail}</span> },
    { key: "device", header: "Įrenginys", sortable: true, sortValue: (r) => r.device, cell: (r) => r.device, hideOnMobile: true },
    { key: "ts", header: "Laikas", sortable: true, sortValue: (r) => r.ts, cell: (r) => fmtDateTime(r.ts), hideOnMobile: true },
    {
      key: "actions",
      header: "",
      align: "right",
      cell: (r) =>
        r.read ? null : (
          <button
            onClick={() => markRead(r.id)}
            className="text-xs"
            style={{ color: "var(--admin-brand)" }}
          >
            Pažymėti
          </button>
        ),
    },
  ];

  return (
    <div className="mx-auto max-w-7xl px-4 py-6 md:px-8 md:py-8">
      <PageHeader title="Pranešimai" description="Visi sistemos įvykiai ir įspėjimai vienoje vietoje.">
        <AdminButton variant="secondary" onClick={markAllRead} disabled={unread === 0}>
          <CheckCheck className="h-4 w-4" />Pažymėti visus perskaitytais
        </AdminButton>
      </PageHeader>

      <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-4">
        <StatCard label="Iš viso" value={items.length} hint="pranešimų" />
        <StatCard
          label="Neperskaityti"
          value={<span style={{ color: unread > 0 ? "var(--admin-brand)" : undefined }}>{unread}</span>}
          hint="reikalauja dėmesio"
        />
        <StatCard label="Įspėjimai" value={<><AlertTriangle className="mr-2 inline h-5 w-5" style={{ color: "var(--admin-warning)" }} />{warning}</>} hint="warning" />
        <StatCard label="Kritiniai" value={<><Siren className="mr-2 inline h-5 w-5" style={{ color: "var(--admin-danger)" }} />{critical}</>} hint="critical" />
      </div>

      <DataTable data={items} columns={columns} searchKeys={["detail", "device"]} pageSize={15} />
    </div>
  );
}
