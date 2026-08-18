# FLEET-1 — Fleet management foundation (founder-approved 2026-08-18)

The maintenance module grows into fleet management. Founder picked phases 1–3 of the
advanced-maintenance proposal to build first; notifications/TCO/tires/downtime follow later.

## Stories

**F1 — Vehicle profile ("kortelė")**
The device row grows vehicle identity: make, model, year, VIN, fuel type, vehicle status
(active / in_service / reserve), purchase date + price, assigned driver. A vehicle card in
the dashboard shows the profile and its history (maintenance, service log, documents) in one
place.
AC: profile fields editable by account writers; VIN/year validated; assigned driver from the
tenant's driver registry; card reachable from the devices table.

**F2 — Maintenance plans & history**
- Service LOG: every completed service is a row (when, odo, engine-h, cost, vendor, notes) —
  "mark serviced" writes one and re-baselines the item; ad-hoc entries allowed. History never
  disappears.
- Engine-hour intervals: `intervalEngineH`/`lastServiceEngineH` next to km/days. Current
  engine hours are DERIVED: baseline + Σ trip durations since the baseline date (no new
  telemetry needed).
- Plans (templates): a named set of interval items stored once (JSONB), applied to many
  devices in one action; each application creates ordinary maintenance items.
- Forecast: predicted due date from the device's average daily km over the last 30 days.
AC: due math shared+unit-tested; serviced dialog captures cost/vendor; plan apply is
idempotent per (device,title) — re-applying does not duplicate.

**F3 — Documents with expiry**
Per-vehicle documents: insurance, roadworthiness (TA), tachograph calibration, permit,
leasing, other — number, valid-from/valid-to, note. Due state computed (ok / due_soon ≤30 d /
overdue) and surfaced on the card and as a fleet-wide "expiring" list.
AC: document CRUD account-scoped; due state pure+tested; fleet list sorted by validTo.

## Out of scope (later phases)
Email/push reminders (notifications phase), file attachments on docs/logs, tires, downtime,
TCO report, work orders.

## Schema (migration 20260818090000_fleet1)
- devices: +make, model, year, vin, fuelType (enum), vehicleStatus (enum, default active),
  purchaseDate, purchasePriceCents, driverId FK→drivers (SET NULL).
- maintenance_items: +intervalEngineH, lastServiceEngineH.
- service_log_entries (new), vehicle_documents (new), maintenance_plans (new, items JSONB).

## API
- device create/update accept the profile fields (strict schemas extended).
- /v1/devices/:id/service-log GET+POST, /v1/service-log/:id DELETE.
- /v1/devices/:id/documents GET+POST, /v1/documents GET (fleet, ?due filter),
  /v1/documents/:id PATCH+DELETE.
- /v1/maintenance-plans CRUD + POST /v1/maintenance-plans/:id/apply {deviceIds}.
- /v1/maintenance/:id/serviced grows optional {engineH, costCents, vendor, notes} and writes
  the log entry.
