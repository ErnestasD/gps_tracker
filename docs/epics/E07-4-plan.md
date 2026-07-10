# E07-4 Plan — Usage metering (usage_daily) + platform admin panel

> W7 S4. PROJECT_PLAN §8 W7 / §6.9 (billing input) / V1-MUST "usage metering (device-days)". Autonominė sesija.

## Context

`usage_daily` modelis JAU yra (PK deviceId+day, tenantId/accountId, active, @@index tenantId+day) — bet niekas nerašo ir neskaito. §6.9: month-close billing skaičiuoja tenant sąskaitą iš `usage_daily × plan pricing`. „usage metering (`usage_daily` from live registry)" + „platform admin panel (tenants, usage, health)".

## Sprendimai

- **Semantika:** device-day = įrenginys BENT KARTĄ atsiskaitė tą **UTC** parą (billing periodai TZ-stabilūs; account-TZ = display §7.7). Diena imama iš PASKUTINIO FIX'O UTC dienos (ne sweep dienos) — fix prieš pat vidurnaktį įskaitomas į teisingą parą.
- **Worker sweep** (`jobs/usageQueue.ts` + `usageWorker.ts`): repeatable BullMQ kas 1h. **Šaltinis = POSITIONS (autoritatyvu), NE registry lastFix** — peržiūros HIGH: lastFix snapshot deterministiškai pameta dienas (reisas per UTC vidurnaktį perrašo seną dienos fix'ą prieš kitą sweep; worker outage per vidurnaktį numeta visos flotilės dieną). Vienas `INSERT…SELECT`: DISTINCT (device_id, UTC diena) iš positions per lookback (48h) JOIN devices (tenant/account scope) `ON CONFLICT ("deviceId",day) DO NOTHING`. Skaitomos ir invalid-fix eilutės (§3.4 presence — todėl NE fix_valid-filtruotas daily_device_stats cagg). Be bind-param limitų (INSERT…SELECT, jokio 16k lubų), be Redis. **Idempotentiška** + 48h lookback BACKFILL'ina outage; ilgesniam — `runUsageSweep(pool, now, lookbackMs)` param month-close rekonsiliacijai (pvz. 35d). Atribucija: diena bill'inasi tenant/account, valdančiam device eilutę sweep metu; cross-tenant re-claim = NAUJA device eilutė → abu tenant'ai gauna savo device-day tą datą (abu naudojo). Metrikos `usage_device_days_total` + `usage_sweep_failed_total` (stalled metering = tylus under-billing → alert).
- **db read repo** (`repos/usage.ts`): `platformSummary(from?,to?)` — per-tenant deviceDays + DISTINCT activeDevices, **UNSCOPED BY DESIGN** (platform panel spans tenants; route gate = vienintelis kelias); `tenantSummary(scope, from?, to?)` — savo tenant per-day (take 366). Datos sanitizuotos (house pattern — garbage niekada 500).
- **api** (manifest → isolation auto): `GET /v1/platform/usage` scopeClass **platform** (tik platform_admin, suite probes 403); `GET /v1/usage` scopeClass tenant, READ_POLICY.usage=TENANT_ADMINS (billing duomenys).
- **web**: `/app/platform` (nav Admin→Platform su nauju `platformOnly` NavItem flag'u) — tenants lentelė + šio UTC mėnesio device-days + active devices + month total; in-page gate mirror'ina quarantine (serveris 403 vis tiek). lib/usage.ts (platformUsage/tenantUsage/monthStartUtc). i18n×4.

## Failai

**Nauji:** apps/worker/src/jobs/{usageQueue,usageWorker}.ts; packages/db/src/repos/usage.ts; apps/web/src/{lib/usage.ts, routes/app/platform.tsx}; apps/worker/__tests__/{usage-sweep.spec.ts, usage-sweep-db.spec.ts}; packages/db/__tests__/usage.spec.ts; docs/epics/E07-4-plan.md.
**Keičiami:** apps/worker/src/{main.ts (queue+worker+schedule+SIGTERM), prom.ts}; packages/db/src/{db.ts,index.ts}; apps/api/src/routes/crud.ts (2 manifest routes + READ_POLICY.usage); apps/api/__tests__/helpers/auth.ts (fakeDb); apps/web/src/{router.tsx, components/AppShell.tsx (platformOnly flag)}; i18n×4; README.

## Testai (10)

- **usage-sweep.spec (3, fake pool):** statement shape (INSERT…SELECT + ON CONFLICT + UTC ::date), window [now−48h, now+1h), custom lookback.
- **usage-sweep-db.spec (6, real pg + prisma migrate + sql/migrate hypertable):** MIDNIGHT-CROSSING reisas bill'ina ABI dienas (HIGH atvejis); re-sweep NO-OP; invalid fix skaičiuojasi (§3.4); be devices eilutės → JOIN drop (no guessed scope); retired device bill'ina savo reported dieną; už lookback → skip, platesnis lookback backfill'ina.
- **usage.spec (3, fake prisma):** platformSummary agregacija + rikiavimas; garbage datos dropped; tenantSummary scoped + day mapping.
- **isolation (dedikuoti, ne vien auto — peržiūros MED "vacuous coverage"):** fixtures seed'ina po 2 usage_daily eilutes T1+T2; /v1/usage suma == TIKSLIAI savo tenant seed (leak padvigubintų); account_manager+viewer → 403; /v1/platform/usage tsp_admin → 403, platform_admin mato ABU tenant'us (po 2).

## Verifikacija (DoD)

Gates + 10 testų žali (žalia lokaliai). §10 #7: platformSummary unscoped tik už platform gate; tenantSummary scope-first. Idempotencija = billing teisingumas (real-DB testas). Metrika pridėta (pipeline taisyklė).

## Rizikos

- **Double-count** → PK + ON CONFLICT + real-DB testas.
- **Prarastos dienos** (peržiūros HIGH) → positions-sourced (išspręsta); >48h outage → manual wider-lookback sweep (dokumentuota).
- **„Aktyvus bet neatsiskaitė"** (registruotas įrenginys be fix) — NESKAIČIUOJAMAS (device-day=reported; „provisioned-day" billing būtų kitokia politika — §6.9 v1 pakanka reported).
- **Health tab** (panel „health") — v1 rodo tenants+usage; live health = Grafana (W7 S1, infra). Note.
