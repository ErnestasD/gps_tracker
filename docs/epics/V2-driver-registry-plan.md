# V2 Plan — driver registry

> PROJECT_PLAN §4 V2 ("driver scoring", iButton driver ID). Autonomous mandate (2026-07-13).
> This PR is the FOUNDATION: the drivers entity itself (scoped CRUD). Trip↔driver assignment
> (manual + automatic via the iButton AVL) is a deliberate FOLLOW-UP PR — kept separate because
> it touches the worker trip engine (rule 3/5 ordering) and a trips.driverId migration.

## Scope (this PR)
A `Driver` is an account-scoped record: name, optional license number, optional **iButton/RFID id**
(the physical key a driver taps — stored now so the follow-up can resolve tap→driver), phone, notes,
and an `active` flag. Standard scoped-CRUD, so the isolation suite auto-covers cross-tenant/‑account.

## AC
1. CRUD `/v1/drivers` — create/list/update/delete, account-scoped; another tenant/account can't
   see or mutate a driver (isolation suite auto-covers via the manifest).
2. iButton id is unique WITHIN a tenant — a duplicate create/update → 409 (never a 500, never a
   cross-tenant leak). Multiple drivers with NO iButton are allowed (nullable).
3. Web Drivers page: list + create + edit + deactivate, under a new Fleet→Drivers nav entry.

## Data (Prisma migration — append-only)
`model Driver`: id(uuid) · tenantId(uuid) · accountId(uuid) · name · licenseNo? · ibutton? · phone?
· notes? · active(bool, default true) · createdAt. `@@index([tenantId, accountId])`,
`@@unique([tenantId, ibutton])` (Postgres treats NULLs as distinct → many null-iButton drivers ok).

## Repo `packages/db/src/repos/drivers.ts` (custom, like devices.ts)
UUID PK (no BigInt coercion). `DriverIbuttonConflictError` translates Prisma P2002 so the API
returns 409 without revealing the clashing tenant's row (mirrors `DuplicateImeiError`). Methods:
list/get/create/update/remove, all scope-first. `findByIbutton(scope, ibutton)` for the follow-up.

## Shared / API / Web
- **shared**: `driverCreateSchema` (name 1..120, licenseNo?/phone?/notes? bounded, ibutton?
  `/^[A-F0-9]{8,32}$/i` — iButton IDs are hex, and the charset keeps it injection-inert), `driverUpdateSchema`
  (partial + active), `DriverView`.
- **api**: manifest routes `GET/POST/PATCH/DELETE /v1/drivers` (scopeClass 'account', entity 'driver');
  READ_POLICY = all roles, WRITE_POLICY = ACCOUNT_WRITERS. create/update catch
  `DriverIbuttonConflictError` → 409. accountId pinned from scope (account user) or validated in scope.
- **web**: `/app/drivers` (Fleet→Drivers) — table + create/edit form (name, license, iButton, phone,
  active) + deactivate; `lib/drivers.ts` client + pure helpers; i18n ×4.

## Tests
- **db** driver.spec: create→list→get→update→remove scoped; iButton conflict within tenant → error;
  the SAME iButton in a DIFFERENT tenant is allowed (no false global clash); two null-iButton ok.
- **isolation**: drivers routes auto-covered (manifest); seed a `driverId` fixture for the item tests.
- **web**: driverForm validation pure helper.

## Steps
1. Plan (this). 2. schema+migration → repo + conflict error → db.ts/index.ts → gates + driver.spec.
3. shared schemas. 4. api routes + policy + 409 → gates. 5. isolation fixture (driverId) → suite green.
6. web page + nav + i18n → gates + e2e smoke. 7. adversarial review (focus: iButton uniqueness
   cross-tenant leak, scope, 409-not-500, ibutton charset injection into future SMS/CAN) → fix → PR →
   CI → merge → memory. Follow-up PR: trips.driverId + worker iButton resolution + manual assign.

## DoD
Gates + isolation + web green; driver.spec proves scoped CRUD + tenant-local iButton uniqueness;
manifest auto-covers cross-tenant; 409 on clash, never 500/leak.
