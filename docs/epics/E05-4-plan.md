# E05-4 Plan — Rule engine (overspeed/ignition/din/power_cut/low_battery/panic + cooldowns + offline sweeper)

> W5 S4. PROJECT_PLAN §6.5. Autonominė sesija (founder delegavo). Split į 2 PR.

## Context

E05-2 jau turi geofence transition engine + `events` lentelę + writer + Redis warm-start (`geofence:state`). E05-3 turi `/v1/rules` CRUD + web UI (kind config). Trūksta: variklio, kuris vertina POZICIJŲ/IO taisykles ir rašo `events` eilutes su `ruleId`+`kind`, su per-rule cooldown (300s default; **panic + power_cut bypass**), warm-startuojama IO-state (restart nere-fire), + `device_offline` sweeper (repeatable BullMQ 60s).

**AC (W5 S4):** engine: overspeed/ignition/din/power_cut/low_battery/panic + cooldowns + offline sweeper. (Kanalai email/Telegram + per-account config = E05-5 S5; events timeline UI = E05-6 S6.)

## Kritiniai invariantai

- **§3.4 / rule #6:** overspeed vertinamas TIK `fixValid` įrašams (invalid-fix = last-valid coords + zeros). **BET** IO event'ai (ignition/din/power_cut/low_battery/panic) leidžiami IR ant invalid-fix. ⇒ rule engine gauna PILNUS `records` (NE per I5 `motionRecords` filtrą); overspeed self-guard'ina `r.fixValid` viduje.
- **Idempotencija (I1/I3):** `onBatch` awaitinamas PRIEŠ XACK, crash → batch replay. Cooldown `SET NX EX cooldownS` atominis → event emisija idempotentiška per replay. Edge-triggered IO taisyklės warm-start'uoja last-value iš Redis (`rule:iostate:{deviceId}`), kad restart ne-refire.
- **Scope:** v1 UI scope tuščias ⇒ account-wide. Jei `config.scope.deviceIds` yra → filtruoti. Minimalu.
- **Tenant scope:** event'ai niekada nerašomi su spėtu tenant — resolve iš registry (`device:tenant`/`device:account`), neregistruotas device → skip (mirror geofence persister).

## AVL mapping (visi cituoti — packages/codec/dictionaries/fmb1xx.json, source_url wiki FMB120)

| Rule | Signalas | AVL ID | Kaip surfaced | Edge/Level |
|------|----------|--------|---------------|-----------|
| overspeed | `speed` (km/h) vs `config.speedKmh` (def 90) | — (GNSS speed) | column `speed` | level, fixValid-only, cooldown |
| ignition | Ignition on↔off | **239** | column `ignition` | edge |
| din_change | Digital Input 1 keitimas | **1** | `attrs["Digital Input 1"]` | edge |
| power_cut | Unplug 0→1 (battery unplugged) | **252** | `attrs["Unplug"]` | edge, **bypass cooldown** |
| low_battery | Battery Voltage ×0.001 < `config.thresholdV` (def 11) | **67** | `attrs["Battery Voltage"]` (raw mV, mult 0.001 NE-taikomas normalize) | level, cooldown |
| panic | Alarm 0→1 ("1 – Alarm event occured") | **236** | `attrs["Alarm"]` | edge, **bypass cooldown** (priority-2) |

- Voltage: normalize saugo RAW integer (mV); engine taiko ×0.001 (fmb1xx mult). Assume fmb1xx family (normalize default) — dokumentuota.
- panic = AVL 236 "Alarm" (bendras alarm/SOS event). din_change = DIN1 (id 1). Abu edge → reikia prev-value state.

## Sprendimai / failai

### PR #29 — E05-4a: position/IO rule engine
**Nauji `apps/worker/src/rules/`:**
- `io.ts` — semantiniai accessoriai (`ignitionOf`, `din1Of`, `unplugOf`, `alarmOf`, `batteryVoltsOf`) su wiki citatomis; attrs-by-name + multiplier.
- `engine.ts` — `RuleEngine` (pure). `feed(records, rulesFor, ioStateFor)` → `RuleEvent[]`. overspeed (level, fixValid-only), edge kinds (ignition/din/power_cut/panic), low_battery (level). In-memory io-state + prune (mirror geofence), warm-start per `ioStateFor` pirmo sight metu. Out-of-order drop per `lastSeen` (I2).
- `cache.ts` — `RuleCache` (mirror `GeofenceCache`): device → enabled rules iš `rule:tenant:{tenant}` (sync'inta API), filtruota account + `enabled`, short TTL.
- `writer.ts` — `writeRuleEvents(pool, rows)`: raw batch INSERT su `ruleId`+`kind`.
- `persister.ts` — `RulePersister`: resolve scope (registry), cooldown gate (`rule:cd:{ruleId}:{deviceId}` `SET NX EX`), persistina event'us, updatina io-state (`rule:iostate:{deviceId}`). `loadIoState(deviceIds)` warm-start.
- `types.ts` — `RuleDef`, `RuleEvent`.

**API:** `apps/api/src/routes/ruleRegistry.ts` — `syncRule`/`removeRule` → `rule:tenant:{tenantId}` hash. Kviečiama iš `crud.ts` rule create/update/delete (mirror geofence @ crud.ts:372). Backfill: kaip geofences — sync-on-CRUD (egzistuojantys pre-code rules reikalauja vienkartinio resync; note'inta).

**Wiring `main.ts`:** po geofence bloko, atskiras žingsnis su PILNAIS `records` (ne motionFeed): `ruleCache.resolveBatch` → `rulePersister.loadIoState` → `ruleEngine.feed` → `rulePersister.persist`. Metrics `rule_events_total{kind}`.

**Metrics `prom.ts`:** `rule_events_total` counter (label `kind`).

### PR #30 — E05-4b: device_offline sweeper
- `apps/worker/src/jobs/offlineQueue.ts` + `offlineWorker.ts` — repeatable BullMQ (`repeat.every=60_000`, `jobId` fixed). Scan registry devices → `device:{id}:last` `fixTimeMs` vs threshold (`device:config` presenceRules `offlineAfterH` def 26h; `device_offline` rule `config.afterH` override). Emit `device_offline` event, cooldown gate (ilgas cooldown, kad ne-spam per 60s), dedup per `rule:offline:{deviceId}` state (fired-flag, reset kai vėl online). Persistina per rule writer.

## Testai

- **`rules/engine.spec.ts`** (pure, be containers): overspeed fires >threshold fixValid, NE-fires invalid-fix; ignition edge on→off→on; din_change edge; power_cut Unplug 0→1; low_battery voltage<threshold (mV scaling); panic Alarm 0→1; warm-start (ioStateFor) ne-refire; out-of-order drop; account scope; overspeed cooldown dedup (engine-level nedaro cooldown — cooldown persister'yje, tai testuojam persister).
- **`rules/persister.spec.ts`** (pg+redis testcontainers): cooldown `SET NX EX` (antras event per window skip), panic/power_cut bypass cooldown, event row su ruleId+kind, unregistered device skip, io-state persist+warm-start round-trip.
- **`rules/cache.spec.ts`** (redis): resolveBatch account filter + enabled filter + TTL.
- **`ruleRegistry` / crud** — rule create → `rule:tenant` hash; delete → hdel. (api spec.)
- **isolation** — events jau read-only scoped (E05-2 padengė); rules CRUD scope padengta E05-3. Naujų route nėra → suite nekinta.
- **PR #30:** `offlineWorker.spec.ts` (pg+redis): device paskutinis fix > threshold → event; < threshold → ne; fired-flag ne-refire; back-online reset.

## Žingsniai

1. Branch `feat/e05-4-rule-engine`. Planas → docs/epics. ✅
2. rules/{types,io,engine} + unit engine.spec → gates.
3. rules/{cache,writer,persister} + persister/cache spec → gates.
4. API ruleRegistry + crud wiring + api spec → gates + isolation.
5. main.ts wiring + prom metric → gates.
6. Adversarinė peržiūra (fokusas: invalid-fix leak į overspeed; ACK-before-persist idempotencija; cooldown replay; tenant scope; warm-start refire; unbounded io-state; voltage scaling; panic/power_cut bypass; out-of-order) → radiniai → PR #29 → CI → merge.
7. PR #30: offline sweeper + spec → peržiūra → CI → merge.
8. Atmintis: project-status.

## Rizikos

- **Invalid-fix → overspeed leak** (KRITINĖ): engine gauna full records; overspeed privalo `if (!r.fixValid) continue`. Test'as tai gaudo.
- **Voltage scaling**: raw mV × 0.001; family assume fmb1xx. Jei device tat/fmc → mult tas pats (0.001 std). Note.
- **Cooldown replay**: `SET NX EX` atominis; panic/power_cut bypass reiškia replay GALI re-fire panic — priimtina (panic geriau du kartus nei praleisti; edge-state warm-start vis tiek riboja).
- **Rule Redis backfill**: pre-code rules ne Redis'e iki resync (kaip geofences). Note; V2 boot-resync.
- **Scope**: v1 account-wide; deviceIds filtras jei yra.
