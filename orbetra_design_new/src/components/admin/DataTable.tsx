import * as React from "react";
import { ArrowDown, ArrowUp, ChevronsUpDown, Search, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { Combobox } from "@/components/admin/Combobox";

export type Column<T> = {
  key: string;
  header: string;
  cell: (row: T) => React.ReactNode;
  sortable?: boolean;
  sortValue?: (row: T) => string | number;
  filterOptions?: { label: string; value: string }[];
  filterValue?: (row: T) => string;
  className?: string;
  align?: "left" | "right" | "center";
  hideOnMobile?: boolean;
};

export function DataTable<T extends { id: string }>({
  data,
  columns,
  searchable = true,
  searchKeys,
  pageSize = 10,
  emptyLabel = "Įrašų nėra",
  rowAction,
  toolbarLeft,
  toolbarRight,
}: {
  data: T[];
  columns: Column<T>[];
  searchable?: boolean;
  searchKeys?: (keyof T)[];
  pageSize?: number;
  emptyLabel?: string;
  rowAction?: (row: T) => React.ReactNode;
  toolbarLeft?: React.ReactNode;
  toolbarRight?: React.ReactNode;
}) {
  const [q, setQ] = React.useState("");
  const [sort, setSort] = React.useState<{ key: string; dir: "asc" | "desc" } | null>(null);
  const [filters, setFilters] = React.useState<Record<string, string>>({});
  const [page, setPage] = React.useState(0);

  const filtered = React.useMemo(() => {
    let out = data;
    if (q && searchable) {
      const l = q.toLowerCase();
      out = out.filter((row) => {
        if (searchKeys && searchKeys.length) {
          return searchKeys.some((k) => String(row[k] ?? "").toLowerCase().includes(l));
        }
        return Object.values(row as Record<string, unknown>).some((v) =>
          String(v ?? "").toLowerCase().includes(l),
        );
      });
    }
    for (const [key, val] of Object.entries(filters)) {
      if (!val) continue;
      const col = columns.find((c) => c.key === key);
      if (!col?.filterValue) continue;
      out = out.filter((r) => col.filterValue!(r) === val);
    }
    if (sort) {
      const col = columns.find((c) => c.key === sort.key);
      if (col?.sortValue) {
        out = [...out].sort((a, b) => {
          const va = col.sortValue!(a);
          const vb = col.sortValue!(b);
          if (va < vb) return sort.dir === "asc" ? -1 : 1;
          if (va > vb) return sort.dir === "asc" ? 1 : -1;
          return 0;
        });
      }
    }
    return out;
  }, [data, q, searchable, searchKeys, filters, sort, columns]);

  const pageCount = Math.max(1, Math.ceil(filtered.length / pageSize));
  React.useEffect(() => {
    if (page >= pageCount) setPage(0);
  }, [page, pageCount]);
  const paged = filtered.slice(page * pageSize, page * pageSize + pageSize);

  const filterableCols = columns.filter((c) => c.filterOptions?.length);
  const anyFilterActive = Object.values(filters).some(Boolean) || !!q;

  return (
    <div className="admin-card overflow-hidden">
      {/* Toolbar */}
      <div className="admin-hairline-b flex flex-wrap items-center gap-2 p-3">
        {searchable && (
          <div
            className="flex h-9 flex-1 min-w-[200px] items-center gap-2 rounded-md border px-3 text-sm"
            style={{ borderColor: "var(--admin-hairline)", background: "var(--admin-surface-sunken)" }}
          >
            <Search className="h-3.5 w-3.5 opacity-60" />
            <input
              value={q}
              onChange={(e) => {
                setQ(e.target.value);
                setPage(0);
              }}
              placeholder="Ieškoti…"
              className="w-full bg-transparent outline-none placeholder:opacity-60"
              style={{ color: "var(--admin-ink)" }}
            />
            {q && (
              <button onClick={() => setQ("")} aria-label="Išvalyti">
                <X className="h-3.5 w-3.5 opacity-60" />
              </button>
            )}
          </div>
        )}
        {toolbarLeft}
        <div className="flex-1" />
        {filterableCols.map((col) => (
          <div key={col.key} className="w-44">
            <Combobox
              value={filters[col.key] ?? ""}
              onChange={(v) => {
                setFilters((f) => ({ ...f, [col.key]: v }));
                setPage(0);
              }}
              options={[
                { value: "", label: `${col.header}: visi` },
                ...col.filterOptions!,
              ]}
              placeholder={`${col.header}: visi`}
            />
          </div>
        ))}
        {anyFilterActive && (
          <button
            onClick={() => {
              setFilters({});
              setQ("");
            }}
            className="h-9 rounded-md border px-3 text-sm"
            style={{ borderColor: "var(--admin-hairline)", background: "var(--admin-surface)", color: "var(--admin-ink-soft)" }}
          >
            Išvalyti
          </button>
        )}
        {toolbarRight}
      </div>

      {/* Desktop table */}
      <div className="hidden md:block overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr style={{ background: "var(--admin-surface-sunken)" }}>
              {columns.map((c) => (
                <th
                  key={c.key}
                  className={cn(
                    "select-none px-4 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wider",
                    c.align === "right" && "text-right",
                    c.align === "center" && "text-center",
                  )}
                  style={{ color: "var(--admin-ink-soft)" }}
                >
                  {c.sortable ? (
                    <button
                      onClick={() =>
                        setSort((s) =>
                          s?.key === c.key
                            ? { key: c.key, dir: s.dir === "asc" ? "desc" : "asc" }
                            : { key: c.key, dir: "asc" },
                        )
                      }
                      className="inline-flex items-center gap-1 hover:text-[var(--admin-ink)]"
                    >
                      {c.header}
                      {sort?.key === c.key ? (
                        sort.dir === "asc" ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" />
                      ) : (
                        <ChevronsUpDown className="h-3 w-3 opacity-40" />
                      )}
                    </button>
                  ) : (
                    c.header
                  )}
                </th>
              ))}
              {rowAction && <th style={{ background: "var(--admin-surface-sunken)" }} />}
            </tr>
          </thead>
          <tbody>
            {paged.length === 0 && (
              <tr>
                <td colSpan={columns.length + (rowAction ? 1 : 0)} className="px-4 py-12 text-center" style={{ color: "var(--admin-ink-soft)" }}>
                  {emptyLabel}
                </td>
              </tr>
            )}
            {paged.map((row) => (
              <tr key={row.id} className="admin-hairline-b transition-colors hover:bg-[var(--admin-surface-sunken)]">
                {columns.map((c) => (
                  <td
                    key={c.key}
                    className={cn(
                      "px-4 py-2.5",
                      c.align === "right" && "text-right",
                      c.align === "center" && "text-center",
                      c.className,
                    )}
                    style={{ color: "var(--admin-ink)" }}
                  >
                    {c.cell(row)}
                  </td>
                ))}
                {rowAction && <td className="px-2 py-2 text-right">{rowAction(row)}</td>}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Mobile cards */}
      <div className="md:hidden">
        {paged.length === 0 && (
          <div className="px-4 py-12 text-center text-sm" style={{ color: "var(--admin-ink-soft)" }}>{emptyLabel}</div>
        )}
        {paged.map((row) => (
          <div key={row.id} className="admin-hairline-b p-4 last:border-b-0">
            {columns.filter((c) => !c.hideOnMobile).map((c) => (
              <div key={c.key} className="flex items-start justify-between gap-3 py-1 text-sm">
                <span className="text-xs uppercase tracking-wider" style={{ color: "var(--admin-ink-soft)" }}>
                  {c.header}
                </span>
                <span className="text-right" style={{ color: "var(--admin-ink)" }}>{c.cell(row)}</span>
              </div>
            ))}
            {rowAction && <div className="mt-2 flex justify-end">{rowAction(row)}</div>}
          </div>
        ))}
      </div>

      {/* Footer / pagination */}
      <div className="admin-hairline-t flex items-center justify-between gap-2 px-4 py-2.5 text-xs" style={{ color: "var(--admin-ink-soft)" }}>
        <div>
          {filtered.length} įrašų · psl. {page + 1} / {pageCount}
        </div>
        <div className="flex items-center gap-1">
          <button
            onClick={() => setPage((p) => Math.max(0, p - 1))}
            disabled={page === 0}
            className="rounded border px-2 py-1 disabled:opacity-40"
            style={{ borderColor: "var(--admin-hairline)", color: "var(--admin-ink)" }}
          >
            ← Ankstesnis
          </button>
          <button
            onClick={() => setPage((p) => Math.min(pageCount - 1, p + 1))}
            disabled={page >= pageCount - 1}
            className="rounded border px-2 py-1 disabled:opacity-40"
            style={{ borderColor: "var(--admin-hairline)", color: "var(--admin-ink)" }}
          >
            Kitas →
          </button>
        </div>
      </div>
    </div>
  );
}
