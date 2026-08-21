import { createFileRoute, Link } from "@tanstack/react-router";
import { motion } from "framer-motion";
import { ArrowRight, Car, Cpu, Plug, Search } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

import { cn } from "@/lib/utils";

/**
 * CAN compatibility checker (founder ask): pick a Teltonika device and a vehicle, see the
 * exact CAN parameters that combination can read — the sales question "will it show fuel on
 * MY truck?" answered on the page instead of in a support thread.
 *
 * The datasets are the OFFICIAL Teltonika supported-vehicles lists, converted 1:1 to static
 * JSON by tools/can-compat/extract.py (source XLSX files and update dates in each file's
 * meta). Nothing here is invented: a parameter shows only if Teltonika's list marks it.
 */
export const Route = createFileRoute("/compatibility")({
  head: () => ({
    meta: [
      { title: "CAN compatibility — Orbetra" },
      {
        name: "description",
        content:
          "Check which CAN bus data your vehicle can provide with Teltonika FMX150 trackers or LV-CAN200 / ALL-CAN300 adapters — fuel, mileage, RPM, doors and more, per make, model and year.",
      },
    ],
  }),
  component: CompatibilityPage,
});

/** 1 = CAN line 1 (①), 2 = line 2 (②), 3 = experimental (starred marks). */
type Mark = 1 | 2 | 3;

interface CanParam {
  n: string;
  g: "standard" | "extended";
}

interface CanVehicle {
  c: string; // category
  b: string; // brand
  m: string; // model
  y: string; // years
  f?: string; // fuel
  r?: string; // region
  l?: string; // CAN lines to connect
  p: Record<string, Mark>;
}

interface CanDataset {
  device: string;
  models: string[];
  adapter?: boolean;
  updated: string;
  source: string;
  params: CanParam[];
  vehicles: CanVehicle[];
}

const DEVICES = [
  { id: "fmx150", label: "FMX150", models: "FMB150 · FMC150 · FMM150", integrated: true },
  { id: "lvcan200", label: "LV-CAN200", models: "FMB1YX · FMC1YX · FMM1YX · FMB140", integrated: false },
  { id: "allcan300", label: "ALL-CAN300", models: "FMB1YX · FMC1YX · FMM1YX · FMB140", integrated: false },
] as const;

type DeviceId = (typeof DEVICES)[number]["id"];

const cache = new Map<DeviceId, CanDataset>();

function CompatibilityPage() {
  const { t } = useTranslation();
  const [deviceId, setDeviceId] = useState<DeviceId>("fmx150");
  const [data, setData] = useState<CanDataset | null>(null);
  const [loadState, setLoadState] = useState<"loading" | "ready" | "error">("loading");
  const [category, setCategory] = useState("");
  const [brand, setBrand] = useState("");
  const [query, setQuery] = useState("");
  const [vehicleKey, setVehicleKey] = useState("");

  useEffect(() => {
    let dead = false;
    const cached = cache.get(deviceId);
    if (cached) {
      setData(cached);
      setLoadState("ready");
      return;
    }
    setLoadState("loading");
    setData(null);
    fetch(`/can/${deviceId}.json`)
      .then((r) => {
        if (!r.ok) throw new Error(String(r.status));
        return r.json() as Promise<CanDataset>;
      })
      .then((d) => {
        cache.set(deviceId, d);
        if (!dead) {
          setData(d);
          setLoadState("ready");
        }
      })
      .catch(() => {
        if (!dead) setLoadState("error");
      });
    return () => {
      dead = true;
    };
  }, [deviceId]);

  // a device switch resets the vehicle path — the lists are different universes
  useEffect(() => {
    setCategory("");
    setBrand("");
    setQuery("");
    setVehicleKey("");
  }, [deviceId]);

  const categories = useMemo(
    () => (data ? [...new Set(data.vehicles.map((v) => v.c))].sort() : []),
    [data],
  );
  const brands = useMemo(() => {
    if (!data) return [];
    const set = new Set<string>();
    for (const v of data.vehicles) if (!category || v.c === category) set.add(v.b);
    return [...set].sort();
  }, [data, category]);
  const models = useMemo(() => {
    if (!data) return [];
    // token match, not a contiguous substring: "Passat B6" must find "Passat mk6 B6 (Typ3C)"
    const tokens = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
    return data.vehicles
      .map((v, i) => ({ v, i }))
      .filter(({ v }) => {
        if (category && v.c !== category) return false;
        if (brand && v.b !== brand) return false;
        if (tokens.length === 0) return true;
        const hay = `${v.b} ${v.m} ${v.y}`.toLowerCase();
        return tokens.every((tok) => hay.includes(tok));
      });
  }, [data, category, brand, query]);

  const selected = useMemo(() => {
    if (!data || vehicleKey === "") return null;
    const i = Number(vehicleKey);
    return Number.isInteger(i) && data.vehicles[i] ? { v: data.vehicles[i], i } : null;
  }, [data, vehicleKey]);

  const device = DEVICES.find((d) => d.id === deviceId)!;

  return (
    <>
      {/* ── hero ─────────────────────────────────────────────────────────── */}
      <section className="mx-auto max-w-7xl px-6 pt-20 md:pt-28 pb-10">
        <span className="section-label">
          <span className="h-[1px] w-6 bg-[var(--brand-blue)]" />
          {t("compat.label")}
        </span>
        <h1 className="display text-4xl md:text-6xl font-bold leading-[1.05] mt-6 max-w-3xl text-ink">
          {t("compat.h1")} <span className="text-gradient">{t("compat.h2")}</span>
        </h1>
        <p className="mt-6 text-lg text-muted-foreground max-w-2xl">{t("compat.sub")}</p>
      </section>

      {/* ── step 1: device ───────────────────────────────────────────────── */}
      <section className="mx-auto max-w-7xl px-6 pb-10">
        <StepHeading n="01" label={t("compat.deviceStep")} />
        <div className="grid gap-4 sm:grid-cols-3 mt-5">
          {DEVICES.map((d) => {
            const active = d.id === deviceId;
            const Icon = d.integrated ? Cpu : Plug;
            return (
              <button
                key={d.id}
                type="button"
                onClick={() => setDeviceId(d.id)}
                aria-pressed={active}
                className={cn(
                  "surface-card text-left p-5 cursor-pointer transition-all",
                  active
                    ? "border-[var(--brand-blue)] shadow-[0_10px_32px_-14px_rgba(76,77,207,0.5)]"
                    : "hover:surface-card-hover",
                )}
              >
                <div className="flex items-center justify-between">
                  <span className="display text-xl font-bold text-ink">{d.label}</span>
                  <Icon
                    className={cn("h-5 w-5", active ? "text-[var(--brand-blue)]" : "text-muted-foreground")}
                    aria-hidden
                  />
                </div>
                <div className="mt-2 font-mono text-[11px] tracking-wide text-muted-foreground">{d.models}</div>
                <div className={cn("mt-3 text-xs", active ? "text-ink/80" : "text-muted-foreground")}>
                  {d.integrated ? t("compat.integrated") : `${t("compat.adapterFor")} FMB1YX`}
                </div>
              </button>
            );
          })}
        </div>
        <p className="mt-4 text-xs text-muted-foreground max-w-2xl">{t("compat.seriesNote")}</p>
      </section>

      {/* ── step 2: vehicle ──────────────────────────────────────────────── */}
      <section className="mx-auto max-w-7xl px-6 pb-10">
        <StepHeading n="02" label={t("compat.vehicleStep")} />
        {loadState === "error" ? (
          <p className="mt-5 text-sm text-red-400">{t("compat.loadError")}</p>
        ) : loadState === "loading" ? (
          <p className="mt-5 text-sm text-muted-foreground animate-pulse">{t("compat.loading")}</p>
        ) : data ? (
          <>
            <div className="mt-5 grid gap-3 sm:grid-cols-3">
              <Field label={t("compat.category")}>
                <select
                  value={category}
                  onChange={(e) => {
                    setCategory(e.target.value);
                    setBrand("");
                    setVehicleKey("");
                  }}
                  className={selectCls}
                >
                  <option value="">—</option>
                  {categories.map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label={t("compat.brand")}>
                <select
                  value={brand}
                  onChange={(e) => {
                    setBrand(e.target.value);
                    setVehicleKey("");
                  }}
                  className={selectCls}
                >
                  <option value="">—</option>
                  {brands.map((b) => (
                    <option key={b} value={b}>
                      {b}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label={t("compat.model")}>
                <div className="relative">
                  <Search
                    className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground"
                    aria-hidden
                  />
                  <input
                    type="search"
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    placeholder={t("compat.search")}
                    className={cn(selectCls, "pl-9")}
                  />
                </div>
              </Field>
            </div>
            <p className="mt-2 font-mono text-[11px] text-muted-foreground">
              {t("compat.countVehicles", { n: data.vehicles.length.toLocaleString() })}
            </p>

            {(brand !== "" || query.trim() !== "") && (
              <div className="mt-4 max-h-72 overflow-y-auto rounded border border-[var(--hairline)] divide-y divide-[var(--hairline)]">
                {models.length === 0 ? (
                  <p className="p-4 text-sm text-muted-foreground">{t("compat.none")}</p>
                ) : (
                  models.slice(0, 400).map(({ v, i }) => {
                    const active = String(i) === vehicleKey;
                    return (
                      <button
                        key={i}
                        type="button"
                        onClick={() => setVehicleKey(String(i))}
                        className={cn(
                          "flex w-full items-center justify-between gap-3 px-4 py-2.5 text-left text-sm cursor-pointer transition-colors",
                          active ? "bg-[rgba(76,77,207,0.15)] text-ink" : "text-ink/80 hover:bg-white/[0.03]",
                        )}
                      >
                        <span className="min-w-0 truncate">
                          <span className="text-muted-foreground">{v.b}</span> {v.m}
                        </span>
                        <span className="shrink-0 font-mono text-[11px] text-muted-foreground">{v.y}</span>
                      </button>
                    );
                  })
                )}
              </div>
            )}
          </>
        ) : null}
      </section>

      {/* ── step 3: result ───────────────────────────────────────────────── */}
      <section className="mx-auto max-w-7xl px-6 pb-20">
        <StepHeading n="03" label={t("compat.resultStep")} />
        {selected === null || data === null ? (
          <div className="mt-5 surface-card p-8 text-center">
            <Car className="mx-auto h-6 w-6 text-muted-foreground" aria-hidden />
            <p className="mt-3 text-sm text-muted-foreground">{t("compat.pickVehicle")}</p>
          </div>
        ) : (
          <ResultPanel data={data} vehicle={selected.v} deviceLabel={device.label} />
        )}
      </section>
    </>
  );
}

const selectCls =
  "w-full h-10 rounded border border-[var(--hairline)] bg-[rgba(10,20,40,0.6)] px-3 text-sm text-ink outline-none transition-colors focus:border-[var(--brand-blue)] cursor-pointer";

function StepHeading({ n, label }: { n: string; label: string }) {
  return (
    <div className="flex items-center gap-3">
      <span className="font-mono text-xs text-[var(--brand-blue)]">{n}</span>
      <h2 className="display text-lg font-semibold text-ink">{label}</h2>
      <span className="h-[1px] flex-1 bg-[var(--hairline)]" />
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1.5 block font-mono text-[11px] uppercase tracking-wide text-muted-foreground">{label}</span>
      {children}
    </label>
  );
}

const MARK_STYLE: Record<Mark, { key: "line1" | "line2" | "exp"; cls: string }> = {
  1: { key: "line1", cls: "bg-[rgba(76,77,207,0.18)] text-[#9FA0FF] border-[rgba(76,77,207,0.4)]" },
  2: { key: "line2", cls: "bg-[rgba(139,92,246,0.15)] text-[#C4B5FD] border-[rgba(139,92,246,0.4)]" },
  3: { key: "exp", cls: "bg-[rgba(245,158,11,0.12)] text-[#FCD34D] border-[rgba(245,158,11,0.4)]" },
};

function ResultPanel({
  data,
  vehicle,
  deviceLabel,
}: {
  data: CanDataset;
  vehicle: CanVehicle;
  deviceLabel: string;
}) {
  const { t } = useTranslation();
  const groups = useMemo(() => {
    const std: { p: CanParam; m: Mark }[] = [];
    const ext: { p: CanParam; m: Mark }[] = [];
    for (const [idx, m] of Object.entries(vehicle.p)) {
      const p = data.params[Number(idx)];
      if (!p) continue;
      (p.g === "extended" ? ext : std).push({ p, m });
    }
    return { std, ext };
  }, [data, vehicle]);
  const total = data.params.length;
  const count = groups.std.length + groups.ext.length;
  const hasExp = groups.std.some((x) => x.m === 3) || groups.ext.some((x) => x.m === 3);

  return (
    <motion.div
      key={`${vehicle.b}-${vehicle.m}-${vehicle.y}`}
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35, ease: "easeOut" }}
      className="mt-5 surface-card p-6 md:p-8"
    >
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h3 className="display text-2xl font-bold text-ink">
            {vehicle.b} {vehicle.m}
          </h3>
          <div className="mt-2 flex flex-wrap gap-x-5 gap-y-1 font-mono text-[11px] text-muted-foreground">
            <span>
              {t("compat.years")}: <span className="text-ink/80">{vehicle.y || "—"}</span>
            </span>
            {vehicle.f ? (
              <span>
                {t("compat.fuel")}: <span className="text-ink/80">{vehicle.f}</span>
              </span>
            ) : null}
            {vehicle.r ? (
              <span>
                {t("compat.region")}: <span className="text-ink/80">{vehicle.r}</span>
              </span>
            ) : null}
            {vehicle.l ? (
              <span>
                {t("compat.canLines")}: <span className="text-ink/80">{vehicle.l}</span>
              </span>
            ) : null}
            <span>
              {t("compat.deviceStep")}: <span className="text-ink/80">{deviceLabel}</span>
            </span>
          </div>
        </div>
        <span className="rounded border border-[var(--hairline)] px-3 py-1.5 font-mono text-xs text-ink/90">
          {t("compat.paramsOf", { n: count, total })}
        </span>
      </div>

      <ParamGroup title={t("compat.standard")} items={groups.std} />
      {groups.ext.length > 0 && (
        <>
          <ParamGroup title={t("compat.extended")} items={groups.ext} />
          <p className="mt-3 text-xs text-muted-foreground">
            {t("compat.extendedNote")}{" "}
            <Link to="/pilot" className="text-[var(--brand-blue)] hover:underline inline-flex items-center gap-1">
              {t("nav.contact")} <ArrowRight className="h-3 w-3" aria-hidden />
            </Link>
          </p>
        </>
      )}

      {/* legend + provenance */}
      <div className="mt-8 border-t border-[var(--hairline)] pt-4">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-[11px] text-muted-foreground">
          <span className="font-mono uppercase tracking-wide">{t("compat.legend")}:</span>
          {( [1, 2, 3] as Mark[] ).map((m) => (
            <span key={m} className="inline-flex items-center gap-1.5">
              <span className={cn("inline-block h-2.5 w-2.5 rounded-sm border", MARK_STYLE[m].cls)} />
              {t(`compat.${MARK_STYLE[m].key}`)}
            </span>
          ))}
        </div>
        {hasExp && <p className="mt-2 text-[11px] text-muted-foreground">{t("compat.expNote")}</p>}
        <p className="mt-2 text-[11px] text-muted-foreground">
          {t("compat.source", { date: data.updated })} {t("compat.disclaimer")}
        </p>
      </div>
    </motion.div>
  );
}

function ParamGroup({ title, items }: { title: string; items: { p: CanParam; m: Mark }[] }) {
  if (items.length === 0) return null;
  return (
    <div className="mt-7">
      <SectionHeadingSmall>{title}</SectionHeadingSmall>
      <ul className="mt-3 grid gap-x-6 gap-y-1.5 sm:grid-cols-2 lg:grid-cols-3">
        {items.map(({ p, m }) => (
          <li key={p.n} className="flex items-center justify-between gap-2 border-b border-white/[0.04] py-1.5">
            <span className="min-w-0 truncate text-sm text-ink/90">{p.n}</span>
            <MarkBadge m={m} />
          </li>
        ))}
      </ul>
    </div>
  );
}

function SectionHeadingSmall({ children }: { children: React.ReactNode }) {
  return (
    <h4 className="font-mono text-[11px] uppercase tracking-[0.18em] text-muted-foreground">{children}</h4>
  );
}

function MarkBadge({ m }: { m: Mark }) {
  const { t } = useTranslation();
  const s = MARK_STYLE[m];
  const label = m === 1 ? "CAN 1" : m === 2 ? "CAN 2" : t("compat.exp");
  return (
    <span className={cn("shrink-0 rounded border px-1.5 py-0.5 font-mono text-[10px]", s.cls)}>{label}</span>
  );
}
