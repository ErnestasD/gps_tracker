import { createFileRoute, Link } from "@tanstack/react-router";
import { fmtDate, fmtDateTime } from "@/lib/admin-format";
import {
  AreaChart, Area, BarChart, Bar, PieChart, Pie, Cell, ResponsiveContainer,
  XAxis, YAxis, Tooltip, CartesianGrid,
} from "recharts";
import {
  Car, TrendingUp, Bell, Activity, ArrowRight, Circle,
} from "lucide-react";
import {
  DASH, fleetActivitySeries, eventsBreakdown, utilizationSeries,
  generateDevices, generateEvents,
} from "@/lib/admin-mock";
import { PageHeader, StatCard, Badge, AdminButton } from "@/components/admin/AdminKit";

export const Route = createFileRoute("/app/")({
  component: OverviewPage,
});

const devices = generateDevices().slice(0, 5);
const events = generateEvents().slice(0, 6);

function OverviewPage() {
  return (
    <div className="mx-auto max-w-7xl px-4 py-6 md:px-8 md:py-8">
      <PageHeader
        title="Apžvalga"
        description="Realiu laiku matomas parkas, kelionės, signalai ir apkrova."
      >
        <AdminButton variant="secondary">Eksportuoti PDF</AdminButton>
        <AdminButton>Kurti ataskaitą</AdminButton>
      </PageHeader>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4 md:gap-4">
        <StatCard
          label="Aktyvūs įrenginiai"
          value={<><span>{DASH.activeDevices}</span><span className="text-base font-normal opacity-50"> / {DASH.totalDevices}</span></>}
          delta={{ value: "+2", tone: "up" }}
          hint="paskutinę valandą"
          spark={[10, 12, 9, 14, 16, 15, 17, 16, 18]}
        />
        <StatCard
          label="Šiandien nuvažiuota"
          value={<>{DASH.todayKm.toString()} <span className="text-base font-normal opacity-50">km</span></>}
          delta={{ value: "+18%", tone: "up" }}
          hint="vs. vakar"
          spark={[400, 620, 800, 720, 900, 1100, 1246]}
        />
        <StatCard
          label="Atviri signalai"
          value={DASH.openAlerts}
          delta={{ value: "−3", tone: "down" }}
          hint="per 24h"
          spark={[8, 12, 10, 9, 7, 6, 7]}
        />
        <StatCard
          label="Apkrovos rodiklis"
          value={<>{DASH.utilization}<span className="text-base font-normal opacity-50">%</span></>}
          delta={{ value: "+4%", tone: "up" }}
          hint="pastarosios 7 d."
          spark={[62, 65, 68, 70, 72, 74, 74]}
        />
      </div>

      <div className="mt-6 grid grid-cols-1 gap-4 lg:grid-cols-3">
        <div className="admin-card p-4 lg:col-span-2">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <div>
              <h3 className="font-semibold" style={{ color: "var(--admin-ink)" }}>Parko aktyvumas</h3>
              <p className="text-xs" style={{ color: "var(--admin-ink-soft)" }}>Nuvažiuoti kilometrai pastarosios 30 d.</p>
            </div>
            <div className="flex gap-1">
              {["7d", "30d", "90d"].map((r, i) => (
                <button
                  key={r}
                  className="rounded-md px-2.5 py-1 text-xs"
                  style={{
                    background: i === 1 ? "var(--admin-brand-soft)" : "transparent",
                    color: i === 1 ? "var(--admin-brand)" : "var(--admin-ink-soft)",
                    fontWeight: i === 1 ? 600 : 500,
                  }}
                >
                  {r}
                </button>
              ))}
            </div>
          </div>
          <div style={{ width: "100%", height: 260 }}>
            <ResponsiveContainer>
              <AreaChart data={fleetActivitySeries}>
                <defs>
                  <linearGradient id="fillKm" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="var(--admin-brand)" stopOpacity={0.35} />
                    <stop offset="100%" stopColor="var(--admin-brand)" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid stroke="var(--admin-hairline-soft)" vertical={false} />
                <XAxis dataKey="date" tick={{ fontSize: 10, fill: "var(--admin-ink-soft)" }} tickFormatter={(d) => d.slice(5)} tickLine={false} axisLine={false} />
                <YAxis tick={{ fontSize: 10, fill: "var(--admin-ink-soft)" }} tickLine={false} axisLine={false} width={30} />
                <Tooltip
                  contentStyle={{ background: "var(--admin-surface)", border: "1px solid var(--admin-hairline)", borderRadius: 8, fontSize: 12, color: "var(--admin-ink)" }}
                  labelStyle={{ color: "var(--admin-ink-soft)" }}
                />
                <Area type="monotone" dataKey="km" stroke="var(--admin-brand)" strokeWidth={2} fill="url(#fillKm)" />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="admin-card p-4">
          <div className="mb-3">
            <h3 className="font-semibold" style={{ color: "var(--admin-ink)" }}>Įvykiai (7 d.)</h3>
            <p className="text-xs" style={{ color: "var(--admin-ink-soft)" }}>Pagal tipą</p>
          </div>
          <div style={{ width: "100%", height: 180 }}>
            <ResponsiveContainer>
              <PieChart>
                <Pie data={eventsBreakdown} dataKey="value" innerRadius={45} outerRadius={70} paddingAngle={2}>
                  {eventsBreakdown.map((e) => <Cell key={e.name} fill={e.color} stroke="var(--admin-surface)" strokeWidth={2} />)}
                </Pie>
                <Tooltip contentStyle={{ background: "var(--admin-surface)", border: "1px solid var(--admin-hairline)", borderRadius: 8, fontSize: 12, color: "var(--admin-ink)" }} />
              </PieChart>
            </ResponsiveContainer>
          </div>
          <ul className="mt-2 space-y-1.5">
            {eventsBreakdown.map((e) => (
              <li key={e.name} className="flex items-center justify-between gap-2 text-xs">
                <span className="flex items-center gap-2" style={{ color: "var(--admin-ink)" }}>
                  <span className="h-2 w-2 rounded-full" style={{ background: e.color }} />
                  {e.name}
                </span>
                <span style={{ color: "var(--admin-ink-soft)" }}>{e.value}</span>
              </li>
            ))}
          </ul>
        </div>
      </div>

      <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-3">
        <div className="admin-card p-4 lg:col-span-2">
          <div className="mb-3 flex items-center justify-between">
            <div>
              <h3 className="font-semibold" style={{ color: "var(--admin-ink)" }}>Aktyvumas per parą</h3>
              <p className="text-xs" style={{ color: "var(--admin-ink-soft)" }}>Vidutinis aktyvių įrenginių skaičius per valandą</p>
            </div>
          </div>
          <div style={{ width: "100%", height: 180 }}>
            <ResponsiveContainer>
              <BarChart data={utilizationSeries}>
                <CartesianGrid stroke="var(--admin-hairline-soft)" vertical={false} />
                <XAxis dataKey="hour" tick={{ fontSize: 10, fill: "var(--admin-ink-soft)" }} tickLine={false} axisLine={false} interval={2} />
                <YAxis tick={{ fontSize: 10, fill: "var(--admin-ink-soft)" }} tickLine={false} axisLine={false} width={20} />
                <Tooltip contentStyle={{ background: "var(--admin-surface)", border: "1px solid var(--admin-hairline)", borderRadius: 8, fontSize: 12, color: "var(--admin-ink)" }} />
                <Bar dataKey="active" fill="var(--admin-brand)" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="admin-card overflow-hidden">
          <div className="admin-hairline-b flex items-center justify-between p-4">
            <h3 className="font-semibold" style={{ color: "var(--admin-ink)" }}>Top įrenginiai</h3>
            <Link to="/app/devices" className="text-xs" style={{ color: "var(--admin-brand)" }}>Visi →</Link>
          </div>
          <ul>
            {devices.map((d) => (
              <li key={d.id} className="admin-hairline-b flex items-center justify-between gap-3 px-4 py-2.5 text-sm last:border-b-0">
                <div className="min-w-0">
                  <div className="truncate font-medium" style={{ color: "var(--admin-ink)" }}>{d.name}</div>
                  <div className="truncate text-xs" style={{ color: "var(--admin-ink-soft)" }}>{d.plate} · {d.location}</div>
                </div>
                <Badge tone={d.status === "active" ? "success" : d.status === "offline" ? "danger" : d.status === "maintenance" ? "warning" : "neutral"}>
                  {d.status === "active" ? `${d.speed} km/h` : d.status}
                </Badge>
              </li>
            ))}
          </ul>
        </div>
      </div>

      <div className="mt-4 admin-card overflow-hidden">
        <div className="admin-hairline-b flex items-center justify-between p-4">
          <div>
            <h3 className="font-semibold" style={{ color: "var(--admin-ink)" }}>Paskutiniai įvykiai</h3>
            <p className="text-xs" style={{ color: "var(--admin-ink-soft)" }}>Realaus laiko srautas</p>
          </div>
          <Link to="/app/events" className="inline-flex items-center gap-1 text-xs" style={{ color: "var(--admin-brand)" }}>
            Visi <ArrowRight className="h-3 w-3" />
          </Link>
        </div>
        <ul>
          {events.map((e) => (
            <li key={e.id} className="admin-hairline-b flex items-center gap-3 px-4 py-2.5 text-sm last:border-b-0">
              <span
                className="grid h-8 w-8 shrink-0 place-items-center rounded-full"
                style={{
                  background:
                    e.severity === "critical" ? "var(--admin-danger-soft)" :
                    e.severity === "warning" ? "var(--admin-warning-soft)" : "var(--admin-info-soft)",
                  color:
                    e.severity === "critical" ? "var(--admin-danger)" :
                    e.severity === "warning" ? "var(--admin-warning)" : "var(--admin-info)",
                }}
              >
                {e.severity === "critical" ? <Bell className="h-3.5 w-3.5" /> : e.severity === "warning" ? <TrendingUp className="h-3.5 w-3.5" /> : <Activity className="h-3.5 w-3.5" />}
              </span>
              <div className="min-w-0 flex-1">
                <div className="truncate" style={{ color: "var(--admin-ink)" }}>{e.detail}</div>
                <div className="truncate text-xs" style={{ color: "var(--admin-ink-soft)" }}>
                  {e.device} · {fmtDateTime(e.ts)}
                </div>
              </div>
              <Badge tone={e.severity === "critical" ? "danger" : e.severity === "warning" ? "warning" : "info"}>
                {e.type}
              </Badge>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
