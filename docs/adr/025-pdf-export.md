# ADR-025: Client-side PDF report export (jsPDF)

**Status:** Accepted · **Date:** 2026-07-16 · **Deciders:** founder (approved PDF export), autonomous session

## Context

The reports page (E06-1/E06-2a) renders trips/mileage/stops/overspeed/geofence/engine-hours tables and
already offers **CSV** export (client-side, no dep). TSPs asked for **PDF** — a print/share-friendly
report. We need PDF generation without a new server service or heavy runtime cost.

## Decision

**Generate the PDF in the browser with `jspdf` + `jspdf-autotable`** (both `apps/web` dev/runtime deps —
this ADR satisfies hard-rule 10). The report rows are already in the client (the run-report response),
so a client-side render mirrors the existing CSV path: one pure `toPdfTable(columns, rows)` builds the
`{head, body}` matrix, and a thin `downloadPdf` wrapper draws it with autotable and triggers a download.

- **Why client-side (not a server PDF service):** the data is already fetched for the on-screen table;
  server-side PDF (puppeteer/pdfkit) would add a heavy runtime + an async job/download flow for zero
  extra value at report sizes. CSV is already client-side — PDF matches.
- **Why jsPDF + autotable:** the de-facto lightweight browser PDF-table combo; autotable handles
  pagination, headers, and column widths. No network, no external fonts (built-in Helvetica).
- **Scope:** the same columns as the table/CSV (`COLUMNS[type]`), a title + generated-at header. No
  charts/branding in v1 (a follow-up can add the tenant logo).

## Alternatives considered

- **Browser print → "Save as PDF"** — zero dep, but requires the user to pick "Save as PDF" in the OS
  print dialog and yields inconsistent output; a real Export PDF button is cleaner.
- **Server-side (puppeteer)** — heavy (headless Chromium), an async job + signed-URL download flow;
  overkill for tabular reports.
- **pdfmake** — capable but a larger bundle; autotable is a better fit for pure tables.

## Consequences

New `apps/web` deps `jspdf` + `jspdf-autotable` (bundled into the SPA, tree-shaken; only loaded on the
reports route). Export stays client-side (no server load, no PII leaving the browser beyond what's
already on screen). The pure `toPdfTable` is unit-tested; the jsPDF draw call is a thin wrapper.
