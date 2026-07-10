# E08-3 Plan — Fuel level graph (where AVL present)

> V1-MUST (§4): „fuel level **graph** (where AVL present)". Griežta riba (§4 out-of-scope): fuel-THEFT detection = V2 — čia tik atvaizdavimas. Autonominė sesija.

## Context / problema

Fuel AVL id'ai (FMB120 Data Sending Parameters ID, https://wiki.teltonika-gps.com/view/FMB120_Teltonika_Data_Sending_Parameters_ID):
- **89** Fuel level (%) — CAN/LVCAN
- **84** Fuel level (l, multiplier ×0.1) — CAN/LVCAN
- **48** Fuel Level (%) — OBD

Rasta reali kliūtis: `normalize.ts` attrs raktus ima iš žodyno **name**, o 84 ir 89 abu vadinasi „Fuel level" → kolizijos atveju vėlesnis tampa `io_<id>`, bet kai siunčiamas TIK VIENAS iš jų, abiejų reikšmės atsiduria po tuo pačiu raktu „Fuel level" — skaitymo pusėje neįmanoma atskirti % nuo litrų. Todėl fix prie šaltinio.

LLS (201/203/210/212/214, „kvants or ltr") ir Escort — kalibruotini davikliai, prasmingi tik fuel-theft (V2) kontekste → NE šio story dalis (dokumentuota).

## Sprendimai

1. **worker normalize.ts**: fuel id'ai {48, 84, 89} VISADA rašomi kaip `io_48`/`io_84`/`io_89` (praleidžiam žodyno pavadinimą) — deterministiniai raktai, žalios reikšmės (multiplikatoriai taikomi skaitymo pusėje, kaip ir visiems kitiems attrs). Wiki cituojamas. Seni įrašai su dviprasmišku „Fuel level" raktu ignoruojami (dokumentuota; nauji duomenys teka teisingai).
2. **packages/db/src/fuel.ts** `readFuelSeries(pool, deviceId, {from,to,limit})` — raw SQL (rule 1) kaip positions.ts: `SELECT fix_time, attrs->>'io_89'/'io_48'/'io_84' WHERE device_id AND (attrs ?| array[...])`, ORDER BY fix_time ASC, limit clamp 10k, from/to sanitizuoti (validDate pattern). Reikšmės koercinamos JS pusėje (`Number()` + `isFinite` filtras — attrs jsonb gali turėti šiukšles, ::numeric cast'as 500'intų). `pct = io_89 ?? io_48` (abu %, be multiplikatoriaus), `liters = io_84 × 0.1` (wiki multiplier). CALLER scope-gate'ina device (kaip readPositions).
3. **shared**: `FuelSampleView { fixTime, pct: number|null, liters: number|null }`.
4. **api**: manifest RouteDef `GET /v1/devices/:id/fuel` (scopeClass account, entity device, shape item) — `db.devices.get` gate PIRMA → 404, tada readFuelSeries (pool 503 guard kaip positions). Isolation suite auto-covers (manifest).
5. **web**: `lib/fuel.ts` (client + pure `fuelSeries` mapping); Playback puslapyje FuelChart (hand-rolled SVG, SpeedChart pattern — jokių naujų dep, rule 10; Recharts §5 paminėtas, bet SpeedChart precedentas = SVG, ADR nereikia) rodomas TIK kai yra duomenų („where AVL present" — AVL-gated UI). i18n ×4.
6. **simulator**: driveRecords prideda io 89 (lėtai krentantis fuel % nuo seed) — e2e ir demo duomenys realistiški; normalize/pipeline testai attrs raktų iš driveRecords neasertina (patikrinta).

## Failai

**Nauji:** packages/db/src/fuel.ts (+index export); apps/web/src/{lib/fuel.ts, components/FuelChart.tsx}; packages/db/__tests__/fuel.spec.ts; apps/web/__tests__/fuel.spec.ts; docs/epics/E08-3-fuel-graph-plan.md.
**Keičiami:** apps/worker/src/normalize.ts (+normalize.spec fuel forced-key testai); packages/shared/src/entities.ts (FuelSampleView); apps/api/src/routes/crud.ts (fuel RouteDef); tools/simulator/src/drive.ts (io 89); apps/web/src/routes/app/playback.tsx (FuelChart AVL-gated); i18n ×4; README.

## Testai

- **normalize.spec** (+2): io 89/84 → attrs.io_89/io_84 (ne „Fuel level"); kolizijos nebėra kai abu kartu.
- **db fuel.spec** (real pg): seed positions su io_89/io_84/io_48/šiukšlėmis → pct/liters teisingi (multiplier ×0.1), garbage praleidžiama (ne-500), from/to bounds, tuščias device → [], limit clamp.
- **web fuel.spec**: pure series mapping (pct preferuoja io_89, null handling).
- **e2e**: playback puslapyje fuel chart atsiranda kai simuliatoriaus duomenys turi io 89 (esamas playback e2e praplečiamas assert'u).
- **isolation**: /v1/devices/:id/fuel — manifest auto (positive + cross-tenant 404).

## Verifikacija (DoD)

Gates žali visiems paliestiems pkg; isolation žalia; §4 scope tik graph (jokio theft-detection); rule 8 visi AVL id cituoti; rule 1 fuel skaitymas raw SQL; rule 10 be naujų dep; AVL-gated UI (nėra duomenų → nėra chart'o).

## Rizikos

- **Seni įrašai** su „Fuel level" raktu nepateks į grafiką — priimtina (staging/dev duomenys; prod dar nėra). Dokumentuota.
- **LLS/Escort** sąmoningai atidėta V2 (kalibravimas) — jei pilotui prireiks, atskiras story.
- **Downsampling** nedaromas (10k cap kaip positions; SVG chart'ui pakanka).
