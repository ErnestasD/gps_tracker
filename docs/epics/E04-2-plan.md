# E04-2 Plan — Trip recompute job (late batches, idempotent) (W4 S2)

> Core IP continuation (trip engine authority). TEST-FIRST: the AC is the idempotency property test. Autonominė sesija. Playbook: planas → ADR → failing property test → recompute fn → BullMQ delivery → enqueue → gates → adversarinė peržiūra → PR → CI → merge → atmintis.

## Context

E04-1 trip engine yra STATEFUL streaming (in-memory per-device), emituoja kiekvieną perėjimą VIENĄ kartą, ir DROP'ina out-of-order įrašus (lastSeen guard). Todėl vėluojantis buffered batch (§3.6: reconnect flood su senesniais fixTime) NEPERSKAIČIUOJA jau uždarytų/atidarytų trip'ų — tam reikia authoritative recompute iš DURABLE positions. §6.4: „Late historical batch overlapping closed trips ⇒ BullMQ trip-recompute(device, window) — idempotent (delete-overlap + replay)". Positions jau durabilūs (I1/I3). BullMQ dar neįdiegtas (planas §5 mandatuoja async jobs per BullMQ; rule 10 → ADR-020).

**AC (§8 W4 S2):** recompute job (late batches) **idempotency property test**.

## Sprendimai

- **ADR-020**: adopt BullMQ (apps/worker runtime dep). Redis `maxmemory-policy noeviction` (planas §6.1 hard req — dokumentuoti runbook/infra). Queue = `trip-recompute`, job data `{deviceId, from, to}` (ISO).
- **recomputeTrips(pool, deviceId, from, to)** (grynas IP, apps/worker/src/trip/recompute.ts):
  1. Expand window iki pilnų trip ribų: SELECT trips overlapping [from,to] → išplėsti [from,to] iki min(startTime)/max(endTime|now) kad nesukirstų trip'o per vidurį.
  2. SELECT positions WHERE device_id AND fix_time ∈ [from,to] ORDER BY fix_time → map į NormalizedRecord.
  3. Šviežias TripEngine replay → events (open/close). Įrašai, likę „open" window gale (be close), rašomi kaip status='open'.
  4. TRANSACTION: DELETE trips WHERE deviceId AND overlapping [from,to]; INSERT recomputed trips (tenant/account iš pirmo trip'o arba registry). COMMIT.
  - **Idempotent**: delete-overlap + replay iš tų pačių positions → tas pats rezultatas. Antras paleidimas = tas pats.
- **Positions reader** (positions → NormalizedRecord): mapper apps/worker/src/trip/recompute.ts (device_id/fix_time/lat/lon/speed/ignition/movement/odometer_m/fix_valid; serverTime/course/satellites/priority/recHash/attrs — engine nenaudoja, užpildyti default).
- **BullMQ delivery**: `apps/worker/src/jobs/queue.ts` (Queue factory) + `apps/worker/src/jobs/recomputeWorker.ts` (BullMQ Worker → recomputeTrips). Worker startuoja main.ts. Graceful shutdown (SIGTERM close).
- **Enqueue on late batch**: TripPersister/consumer aptinka late įrašą (fixTime < engine lastSeen device'ui su trip'ais). E04-1 engine jau drop'ina; reikia SIGNALO. Sprendimas: engine.feed grąžina ne tik events bet ir `lateDevices: {deviceId, from}[]` (drop'inti įrašai su jų fixTime). Persister enqueue'ina trip-recompute(device, [min(lateFixTime, ...), now]) su debounce (jobId = `recompute:{device}:{windowBucket}` kad dedupe). ARBA paprasčiau: engine praneša per callback. **Sprendimas**: TripEngine.feed grąžina `{events, late: Map<deviceId, earliestLateFixTime>}`; MotionFeed prakiša; persister enqueue'ina.
- **Tenant/account recompute'e**: iš Redis registry (kaip persister) — recompute funkcijai paduoti resolver arba tenant/account iš esamo trip'o (delete prieš insert → paimti iš seno trip'o prieš delete). Saugiau: registry resolver (miss → skip recompute, log).

## Failai

**Nauji:** `docs/adr/020-bullmq.md`; `apps/worker/src/trip/recompute.ts` (recomputeTrips + positions→record mapper + window expand); `apps/worker/src/jobs/{queue.ts, recomputeWorker.ts}`; `apps/worker/__tests__/recompute.spec.ts` (idempotency property test, pg container); docs/epics/E04-2-plan.md.

**Keičiami:** `apps/worker/src/trip/engine.ts` (feed grąžina {events, late}); `apps/worker/src/motion.ts` (prakiša late); `apps/worker/src/trip/persister.ts` (enqueue recompute per late) — arba enqueue main.ts'e; `apps/worker/src/main.ts` (start recompute BullMQ worker + queue; enqueue on late; graceful shutdown); `apps/worker/package.json` (+bullmq); `apps/worker/src/prom.ts` (+trip_recompute_total, trip_recompute_deleted); README + PROJECT infra runbook (noeviction).

## Testai (test-first)

- **recompute-idempotency** (pg container, PROPERTY): sugeneruoti poziciją seką (drive+stop+drive) → įrašyti į positions → recomputeTrips → snapshot trips; recomputeTrips DAR KARTĄ → identiškas snapshot (id gali skirtis, bet startTime/endTime/distanceM/idleS/maxSpeed/status identiški). Property: N atsitiktinių window'ų → 2× recompute == 1×.
- **recompute-equals-streaming**: recompute iš positions == streaming engine tas pats trip'as (ta pati distance/times) — authoritative == online kai tvarkinga.
- **recompute-late-fix**: streaming uždaro trip'ą; tada into positions įrašomas late įrašas prailginantis trip'ą; recompute(window) → trip'as perskaičiuotas su nauja distance; delete-overlap pašalina seną.
- **recompute-invalid-fix (I5)**: positions su fix_valid=false → recompute distance nekinta.
- **window-expand**: recompute su window vidury trip'o → išplečia iki trip ribų, nesukerta.
- **enqueue on late** (unit): engine.feed su late batch → grąžina late device; persister/main enqueue'ina job su dedupe jobId.
- **BullMQ worker** (integracija, redis container): enqueue trip-recompute → worker apdoroja → trips atnaujinti.

## Žingsniai

1. Branch + planas + ADR-020. ✅ (branch)
2. bullmq dep + ADR. recompute.ts recomputeTrips + mapper → failing idempotency property test → iki žalia.
3. engine.feed {events, late} + motion prakiša + persister/main enqueue.
4. jobs/queue.ts + recomputeWorker.ts + main.ts wiring + graceful shutdown + metrics.
5. Gates → adversarinė peržiūra (fokusas: idempotency tikra (delete-overlap tranzakcijoje, ne partial); window expand nesukerta gretimo trip'o; late-detection nepraleidžia; recompute I5; tenant iš registry ne guess; BullMQ jobId dedupe; concurrent recompute to paties device — job dedupe/lock; positions decompress cost; unbounded enqueue) → PR → CI → merge → atmintis.

## Rizikos

- **Idempotency**: delete-overlap privalo būti TOJE PAČIOJE tranzakcijoje kaip insert (kitaip crash palieka tuščią). Window expand privalo apimti VISUS overlapping trip'us (kitaip pusę trip'o palieka).
- **Concurrent recompute** to paties device: BullMQ jobId = `recompute:{device}:{bucket}` dedupe + galbūt per-device lock (Redis) kad du recompute'ai nesikirstų su streaming persister'iu. Streaming rašo status='open'/'closed'; recompute delete+insert. Race: recompute delete'ina trip'ą kurį persister ką tik uždarė. Mitigacija: recompute tik istoriniam window (fix_time < now - guard, pvz. 5 min), streaming valdo dabartį. Dokumentuoti.
- **BullMQ noeviction**: Redis maxmemory-policy noeviction (planas) — infra runbook.
- **Positions decompress**: recompute skaito senus (galbūt suspaustus) chunk'us — decompress kaina; window bounded.
- **Naujas dep BullMQ**: ADR-020 (rule 10).

## Verifikacija (DoD)

- Gates + idempotency property test žali; recompute==streaming; I5.
- Manual: streaming trip → įrašyti late position → enqueue recompute → trip perskaičiuotas.
- §10: I5 (recompute), tenant scope (registry), idempotency.
