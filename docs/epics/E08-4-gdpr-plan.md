# E08-4 Plan — GDPR: device-delete cascade + account data export

> V1-MUST §4: „GDPR (retention config, device-delete cascade, export)". Autonominė sesija.

## Retention config — interpretacija (normatyvi, iš plano)

§6.3 (R8-3 sprendimas): retention yra PLATFORM-WIDE by design — `add_retention_policy('positions', 13 months)` **jau įgyvendinta W1** (packages/db/sql/001_positions.sql). „Tenants may configure SHORTER retention (delete-by-device job, **V2**)". Tad V1 „retention config" = platforminis 13 mėn. policy (padaryta) + dokumentacija; per-tenant trumpesnis retention SĄMONINGAI paliekamas V2 (rule 14 — plano tekstas laimi prieš dviprasmišką MUST eilutę; pažymėta čia, kad žmogus matytų). Šio story apimtis: **device-delete cascade + account export**.

## Sprendimai

### Device erase (cascade)
- **Guard'as:** erase leidžiamas TIK jau retired įrenginiui (`retiredAt !== null`, kitaip 400 „retire first") — retire jau nugriauna registry/ingest kelią, tad erase metu nauji duomenys nebeteka; atsitiktinis gyvo įrenginio data-wipe neįmanomas.
- **API:** `POST /v1/devices/:id/erase` — scope-gate `db.devices.get` PIRMA (404), WRITE tik **TENANT_ADMINS** (negrįžtamas duomenų naikinimas — griežčiau nei ACCOUNT_WRITERS). Enqueue BullMQ `gdpr-erase` (jobId `erase:{deviceId}` dedupe) + audit row. 202 {queued:true}.
- **Worker `gdprEraseWorker`:** (1) positions — raw SQL DELETE **laiko langais** (30 d nuo MIN(fix_time) iki now, bounded txn'ai hypertable'ui); (2) Prisma deleteMany: trips, events, commands (deviceId — FK nėra, cascade explicit); (3) Redis liekanos: device:{id}:last, cmd:pending/inflight/resp:{id}, SREM cmd:active, geofence:state, rule:iostate/offline/cd (scan by pattern su konkrečiu id — ne KEYS *); (4) hard DELETE devices row. Idempotentiškas (pakartotas job'as nieko neranda → OK). Metrika `gdpr_erase_total`.
- **Kas SĄMONINGAI lieka (dokumentuota):** `usage_daily` (billing — legitimate interest; deviceId be FK) ir `audit_log` (append-only įrodymų grandinė; joje gali būti imei/name snapshot — teisėtas interesas, redaction V2). `raw_rejects` turi tik imei be device sąsajos — valo retention'as.

### Account export
- **API:** `POST /v1/accounts/:id/export` (§6.6 tiksliai šis endpoint'as; TENANT_ADMINS; scope-gate account) → sukuria `ExportJob` eilutę (nauja lentelė, append-only migracija) + BullMQ `gdpr-export`. `GET /v1/exports/:id` (status, scoped) ir `GET /v1/exports/:id/download` (file stream, scoped, tik status=done).
- **Worker `gdprExportWorker`:** surenka account duomenis → vienas `.json.gz` į `EXPORT_DIR` (env, default `var/exports`; **R2 upload = follow-up kai founder duos S3 creds** — dokumentuota, driver-swap vieta pažymėta). Turinys: account, users (BE passwordHash!), devices, trips, events, commands, geofences (accountId=šio account), rules, webhooks (secret redaguotas '***'), positions per device (readPositions puslapiais po 10k iki galo). Status done + sizeBytes; failed + error.
- **Expiry:** ExportJob.expiresAt = +7 d; download po expiry → 410; failas šalinamas lazy (download 410 metu + eraseWorker nepriklauso). Paprasta, be atskiro sweep'o V1.

### Web (minimalus, AC-honest)
- Devices puslapyje retired eilutei „Erase data" mygtukas — dviejų žingsnių danger confirm (commands pattern) → POST erase → toast.
- Settings → nauja „Data export" sekcija (adminOnly): account select → Request export → sąrašas su status poll + Download nuoroda.
- i18n ×4.

## Failai

**Nauji:** prisma migracija (ExportJob); packages/db/src/{gdpr.ts (erasePositionsWindowed raw SQL), repos/exports.ts}; apps/worker/src/jobs/{gdprQueue.ts, gdprEraseWorker.ts, gdprExportWorker.ts}; apps/api/__tests__/gdpr.spec.ts; packages/db/__tests__/gdpr-erase.spec.ts; apps/worker/__tests__/gdpr-export.spec.ts; apps/web/src/lib/gdpr.ts; docs/epics/E08-4-gdpr-plan.md.
**Keičiami:** packages/db/src/{db.ts,index.ts}; apps/worker/src/{main.ts,prom.ts}; apps/api/src/routes/crud.ts (4 RouteDefs + 'export' entity policy); tests/isolation/{fixtures,suite}; apps/web/src/routes/app/{devices/index.tsx,settings.tsx} + i18n ×4; README (env EXPORT_DIR + GDPR sekcija su retention interpretacija).

## Testai

- **db gdpr-erase.spec (real pg):** seed 2 devices su positions/trips/events/commands → erase dev1 → dev1 duomenys 0 visur, dev2 nepaliestas; usage_daily lieka; pakartotas erase idempotentiškas.
- **worker gdpr-export.spec:** real pg seed → export → gunzip → sekcijos yra, users be passwordHash, webhook secret '***', positions count sutampa; failed kelias (blogas dir) → status failed.
- **api gdpr.spec:** erase: live device → 400; retired → 202 + queue'intas; viewer/account_admin → 403; cross-tenant → 404. export: POST → 201 job; GET status scoped; download prieš done → 409/404; cross-tenant → 404.
- **isolation:** ExportJob fixture + idFor 'export' case; erase/export routes cross-tenant auto.
- **e2e (jei stack leidžia be vargo):** retired device → Erase (2-step) → dingsta iš sąrašo. Kitaip API integracinio testo pakanka (dokumentuoju).

## Peržiūros pataisos (2 HIGH + 2 MED + LOW, visos pritaikytos)

- **HIGH-1 resurrection:** gyva TCP sesija išgyvena retire iki idle-timeout ir stream backlog'as drenuojasi asinchroniškai. TRYS diržai: (1) **ingest per-frame registry re-check** — de-registruoto device sesija nutraukiama su KITU frame'u be ACK (uždengia tat-asset 26 h read-idle ir niekada-tylinčią sesiją — re-verify residual'ai); (2) erase leidžiamas tik praėjus `eraseMinRetiredMs` (default 60 min; 409 anksčiau) — backlog'as išsidrenuoja; (3) worker'is po device row DELETE daro FINALINĮ sweep'ą (id niekada nepernaudojami). Ingest testas: mid-session hdel → socket destroyed, persisted == acked. ŽINOMA ops sąlyga: 60 min guard'as remiasi sveiku pipeline'u — NEvykdyti erase per pipeline outage (pipeline_lag_ms > guard lango; stebima alertais). Follow-up kandidatai: lag pre-check erase worker'yje, cmdResponse frame re-check simetrija, atskiras metrikos label mid-session kill'ams.
- **HIGH-2 užstrigęs erase:** BullMQ failed set'e likęs job'as blokuoja jobId → API 202 meluotų amžinai. `removeOnFail: true` (abu job'ai idempotentiški) + regresijos testas su realiu BullMQ.
- **BONUS latentinis bug'as (rastas per HIGH-2 testą):** BullMQ atmeta custom jobId su `:` (išskyrus legacy lygiai-3-segmentų atvejį) — `notify:*` (4 seg.) ir `wh:*` (5+ seg.) enqueue **metė klaidą nuo pat E05-5/E06-4**, o best-effort catch ją tyliai rijo → notifikacijos ir webhook'ai niekada nepasiekdavo eilės. Pataisyta į dash formatus + regresijos testas prieš realią eilę.
- **MED-3 expired failai:** valandinis `gdpr-export-sweep` (unlink + status='expired' → download 410) + lazy unlink 410 kelyje + POST /export koalescuoja pending job'ą (flood guard) su SELF-HEAL re-enqueue (zombie pending eilutė po Redis restart negali amžinai blokuoti — BullMQ dedupe'ina gyvą, atgaivina dingusį).
- **MED-4 atmintis:** trips/events/commands dabar keyset-paged kaip positions; gzip backpressure (`write()===false → drain`); tmp failas + atominis rename (download niekada nemato pusinio failo); try/finally destroy + tmp unlink klaidos kelyje.
- **LOW:** done-guard status UPDATE + UNIKALUS tmp sufiksas (zombie attempt negali rašyti į publikuoto failo inode); web erase klaida su savo žinute + 6s auto-disarm; account_manager 403 + 410 expiry + cross-account + coalesce testai; recompute jobId → dash formatas + removeOnFail:true (ta pati HIGH-2 klasė, deprecated carve-out).

## Kas SĄMONINGAI lieka po erase / ne-eksportuojama (dokumentuota)

- `webhook_deliveries` eilutės išlieka (eventId/kind — be koordinačių, be payload — ne lokacijos PII).
- Tenant-shared (accountId NULL) geofences/webhooks NEeksportuojami account eksporte (griežtas accountId filtras — jie ne to account'o nuosavybė).
- `usage_daily` (billing) ir `audit_log` (evidence) — kaip aprašyta viršuje.

## Rizikos

- **Hypertable DELETE apkrova:** laiko langai riboja txn dydį; V1 fleet'ai maži. Kompresuoti chunk'ai: Timescale DELETE iš compressed chunk — pinned image palaiko (R8-2 verifikuota insert; delete gali reikėti decompress — testas realiame timescale image parodys; jei lūžta, fallback: decompress_chunk() prieš delete, dokumentuota).
- **Export dydis:** JSON.gz streaming'u (nekaupti visko RAM — positions rašomi puslapiais tiesiai į gzip stream'ą).
- **PII audite:** dokumentuota kaip legitimate interest; redaction V2.
- **R2 BLOCKED:** local EXPORT_DIR yra teisėtas V1 (staging vienas host'as); S3 driver-swap follow-up.
