# E02-7 Plan — Invalid-fix end-to-end (I5)

> Implementacijos pradžioje kopijuojama į `docs/epics/E02-7-plan.md`. Story S dydžio — vienas PR.

## Context

I5 (PROJECT_PLAN §6.1): invalid-fix įrašai (satellites==0 ⇒ fixValid=false) **niekada** nekeičia trip distance / geofence būsenos / overspeed / žemėlapio trail'o; **gali** veikti presence ir IO įvykius (§3.4: įrenginys siunčia paskutines galiojusias koordinates su angle=0, sat=0, speed=0). E02-6 paliko trail'ą kaip vientisą LineString (fixValid saugomas per tašką, bet nenaudojamas), o worker'yje nėra jokio motion-vartotojų stub'o, kurį I5 saugotų.

**AC:** [1] I5 unit testas: invalid-fix įrašas nemutuoja nei trip-distance akumuliatoriaus (stub hook), nei geofence evaluator input queue · [2] invalidFix scenarijus atvaizduoja matomą trail'o tarpą.

## Būsena (žvalgyba)

- `apps/worker/src/normalize.ts:63` — `fixValid: p.satellites > 0` JAU yra, padengtas `normalize.spec.ts` („satellites 0 ⇒ false"). **Nekeičiama.**
- Worker'yje NĖRA trip/rules/geofence kodo — tik komentaras `consumer.ts:18`. `main.ts` onBatch šiandien: prom + `liveState.apply` (LiveState fixValid nefiltruoja — teisinga, presence kelias).
- `tools/simulator/scenarios/invalidFix.ts` — kas 3-čias įrašas invalid (paskutinės valid koordinatės, sat=0, speed=0, angle=0).
- `apps/web/src/lib/liveStore.ts` `pushMapFrame` — trail = vienas LineString per VISUS taškus (gap logikos nėra); `LiveMap.tsx` — vienas `trail-line` sluoksnis.

## Pakeitimai

### 1. Worker: I5 siūlė + motion stub'ai (AC[1])

**Naujas `apps/worker/src/motion.ts`** — VIENINTELIS taškas, per kurį įrašai teka į judesio vartotojus (trip engine E04-1, geofence/rules E05-x); presence kelias (LiveState) sąmoningai eina APLINK:
- `motionRecords(records): NormalizedRecord[]` — `filter(r => r.fixValid)` (pati I5 apsauga).
- `TripDistanceStub` — per-device haversine akumuliatorius virš gaunamų taškų (E04-1 pakeis tikru trip engine; stub'as egzistuoja, kad I5 testas turėtų KĄ saugoti — AC formuluotė).
- `GeofenceQueueStub` — input eilė (masyvas) būsimam evaluator'iui.
- `MotionFeed.feed(records)` — filtruoja per `motionRecords`, paduoda abiem stub'ams.

**`apps/worker/src/main.ts`** — onBatch'e po `liveState.apply` (atskiras try/catch, best-effort kaip live): `motionFeed.feed(records)`.

**Naujas `apps/worker/__tests__/motion.spec.ts`** (AC[1] testas):
- mišrus batch'as (invalidFix scenarijaus forma: valid, valid, invalid, …) → `TripDistanceStub` suma identiška vien-valid batch'ui; invalid taškų poslinkiai (jie dubliuoja paskutinę valid koordinatę, bet ir „teleportas" testuojamas su skirtingom koordinatėm) nepridedami.
- `GeofenceQueueStub` neturi nė vieno `fixValid=false` įrašo.
- Presence paritetas: `LiveState.apply` su invalid įrašu VIS TIEK atnaujina `device:{id}:last` (naujesnis fixTime) — invalid veikia presence (jau dengiama liveState.spec, čia tik seam-level assert per motionRecords: invalid NE-išmetami iš pradinio batch'o objekto).

### 2. Web: trail gap (AC[2])

**`apps/web/src/lib/liveStore.ts` `pushMapFrame`** — segmentacija:
- Iš eilės einantys valid taškai → solid LineString feature'ai (`properties.gap=false`).
- Tarp dviejų valid „bėgių", perskirtų ≥1 invalid tašku, → dashed jungtis nuo paskutinio valid iki pirmo valid (`gap=true`). Invalid taškų koordinatės niekada nepiešiamos (jos ir taip dublikatai).
- `DASHBOARD_UI_SPEC §4: „Invalid-fix gap = dashed"`.

**`apps/web/src/components/LiveMap.tsx`**:
- `trail-line` gauna filter `gap=false`; naujas `trail-gap` sluoksnis: `line-dasharray [2,2]`, muted spalva, filter `gap=true`.
- Testų kabliukas: `container.__map = map` (viena eilutė) — Playwright per `queryRenderedFeatures({layers:['trail-gap']})` asertina REALIAI atvaizduotą gap'ą.

**`apps/web/__tests__/liveStore.spec.ts`** — segmentacijos unit testai: valid-run'ai → solid features; invalid tarpas → vienas gap feature su teisingom galūnėm; vien-valid seka → jokio gap; invalid gale/pradžioje → be kabančių jungčių.

### 3. Playwright smoke praplėtimas (AC[2] end-to-end)

`apps/web/tests/pw/smoke.spec.ts` — naujas testas po esamų (serial): paleisti `invalidFix` scenarijų 4-am seed'intam įrenginiui (global-setup seed'ina DEVICES=3 → pakelti iki 4 arba seed'inti teste), select + trail on, palaukti ≥2 valid run'ų, `queryRenderedFeatures` → `trail-gap` features ≥1, screenshot `trail-gap.png` artefaktas. Invalid įrašai su savo fixTime vėlesni už valid — max-wins juos priima (presence), bet trail'e jie tampa gap'u.

Pastaba dėl trail šaltinio: trail pildosi TIK iš WS srauto nuo select momento — testas selectina PRIEŠ paleisdamas scenarijų.

## Ne šios story

Tikras trip engine (E04-1), rules/geofence evaluator (E05-x), overspeed, invalid-fix filtravimas DB/report lygyje (caggs jau `WHERE fix_valid`), LiveState keitimai (presence teisingai gauna invalid).

## Žingsniai

1. Planas → `docs/epics/E02-7-plan.md`; branch `feat/e02-7-invalid-fix`.
2. Worker: motion.ts + main.ts wiring + motion.spec.ts → gates.
3. Web: liveStore segmentacija + LiveMap sluoksniai + unit testai → gates.
4. Smoke praplėtimas + lokalus `pnpm e2e`.
5. Docs (W1.md eilutė po merge; README nereikia — env nesikeičia). Metrika nesikeičia (pipeline'e naujo I/O nėra; stub'ai in-memory).
6. Gates → adversarinė peržiūra (šviežias subagentas) → radiniai → PR → CI → merge → atmintis.

## Verifikacija (DoD)

- `pnpm turbo run typecheck lint test --filter=...@orbetra/worker --filter=...@orbetra/web` žalia; nauji testai: motion.spec (I5 AC[1]), liveStore segmentacija, smoke `trail-gap` (AC[2] — realiai atvaizduota per queryRenderedFeatures).
- §10 failure map #4 („invalid-fix as movement") — I5 testas dengia; PR'e nurodyti.
- Manual: headed screenshot su invalidFix scenarijum (PR artefaktas).
