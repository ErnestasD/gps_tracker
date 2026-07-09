# E06-1 Plan — Report engine (trips/mileage/stops/overspeed/geofence/engine-hours + account-TZ)

> W6 S1. PROJECT_PLAN §6.6/§7.7. Autonominė sesija.

## Context

W5 baigta — turim trips (E04) + events (E05-2/4) lenteles su indeksais (tenantId,accountId,time). Reikia agregacijų report'ams. **KRITINĖ (§7.7 / rule #7):** dienos bucketing pagal ACCOUNT timezone, DST-correct (Europe/Warsaw 2026-10-25 fall-back). UTC saugojimas, konversija tik čia.

**AC (W6 S1):** report engine on positions+trips+events (+caggs where possible): trips, mileage, stops, overspeed, geofence, engine-hours; account TZ correctness tests.

## Sprendimai

- **Engine `packages/db/src/reports.ts`** (scope-first raw SQL, rule #2 — packages/db): `runReport(pool, type, scope{tenantId,accountId}, params{from,to,deviceId?,timezone})`. 6 tipai. **Day bucket = `to_char(date_trunc('day', COL AT TIME ZONE $tz),'YYYY-MM-DD')`** — Postgres daro DST-teisingą offset math (ne JS Date). Kiekvienas query bounded WHERE "tenantId"=$1 AND "accountId"=$2 (+time range +optional deviceId). Sanitizacija: validDate (pg-range clamp), deviceId /^\d+$/, safeTz (Intl try/catch → UTC fallback — nežinoma zona kitaip 500).
  - mileage: sum(distanceM)+count per device/day (trips). stops: sum(idleS)+count. engine_hours: sum(EXTRACT EPOCH coalesce(endTime,now())-startTime) GREATEST 0. overspeed: count+max(payload->>speedKmh) events kind=overspeed. geofence: count FILTER enter/exit events kind=geofence. trips: list (id/device/day/times/dist/maxSpeed/idle) LIMIT 5000.
- **API `apps/api/src/routes/reports.ts`** `POST /v1/reports/:type` — dedikuotas route (NE manifest CRUD: :type param + non-entity result netinka isolation harness'ui) registruotas app.ts, EXEMPT meta-test'e, su DEDIKUOTAIS isolation testais. Tenant iš JWT (niekada param); account validuotas scope'e (account user pinned, tenant-admin pass accountId) → account.timezone driveina bucket. Read-only, visiems auth rolėms. deps.pool undefined→503.
- **shared:** reportRequestSchema {from,to,deviceId?,accountId?}.

## Failai

**Nauji:** packages/db/src/reports.ts (+index export); apps/api/src/routes/reports.ts; packages/db/__tests__/reports.spec.ts; apps/api/__tests__/reports.spec.ts; docs/epics/E06-1-plan.md.
**Keičiami:** packages/shared/src/entities.ts (reportRequestSchema); apps/api/src/app.ts (mountReports); tests/isolation/suite.spec.ts (EXEMPT /v1/reports ×2 regex); README.

## Testai (16)

- **db reports.spec (10)** — minimalios trips+events lentelės (be prisma-migrate). **DST straddle** Europe/Warsaw 2026-10-25: trip C(24d 21:00Z→23:00 CEST=24d), A(24d 23:30Z→01:30 CEST=25d), B(25d 22:30Z→23:30 CET=25d) → Warsaw bucket 25d=2 trips vs UTC 24d=2 (įrodo TZ konversiją reali). unknown tz→UTC ne 500. overspeed count+max. geofence enter/exit. engine_hours sum. trips list newest-first. deviceId filter. garbage params ne throw. tenant/account isolation (scope2 mato tik savo device-9).
- **api reports.spec (6)** — 401 no-auth; 404 unknown type; 400 tenant-admin be accountId; 200 mileage Warsaw bucket (25d); isolation cross-tenant accountId→400; garbage dates→200.

## Verifikacija (DoD)

Gates + 16 testų žali. §7.7 DST test PASS. §10 #7 (tenant leak): engine bounded by scope, isolation testai (db+api). rule #7: AT TIME ZONE Postgres, UTC storage, jokio naive JS Date math.

## Rizikos

- **TZ injection**: $tz bound param (safe) + safeTz Intl-validated. **500 ant nežinomos zonos** → safeTz→UTC fallback.
- **Param-index fragility**: engine_hours nebenaudoja tzIndex-1 (open trip→now()).
- **Manifest netinka**: reports EXEMPT + dedikuoti isolation testai (ne generic).
- **Web reports UI + CSV/XLSX** = E06-2 (async BullMQ + signed URL); šis story = engine+API (plan S1).
