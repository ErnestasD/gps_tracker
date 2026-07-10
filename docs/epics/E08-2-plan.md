# E08-2 Plan — Codec 12 commands (backend)

> W8 S2 (pulled early — paskutinis didelis V1-MUST software gap). PROJECT_PLAN §3.5 + §6.6. Autonominė sesija. E08-2a backend; E08-2b web UI + presets grid.

## Context

Command modelis + statusai (queued/sent/acked/failed/expired) JAU yra; packages/codec encodeCodec12/decodeCodec12 (cituota wiki §3.5); ingest session.ts jau capture'ina Codec12/13/14 responses į `cmd:resp:{deviceId}`. §3.5: per-device queue, send only socket live, correlate by socket order (device answers sequentially), 30s timeout → failed, retry max3, expire 24h. **Rule 3: NO business logic in ingest** — queue/timeout/retry policy = worker; ingest = transport only.

## Architektūra (Redis = transporto seam api↔ingest↔worker; DB = statusų šaltinis)

- **Redis raktai:** `cmd:pending:{dev}` LIST {id,text,attempt} (api push, ingest LPOP); `cmd:inflight:{dev}` LIST {id,text,attempt,sentAtMs} (ingest po send); `cmd:resp:{dev}` LIST {codec,text,nack} (ingest, egzistuoja); `cmd:active` SET deviceId (dispatcher wake).
- **api** `POST /v1/devices/:id/commands {text}`: device-scope gate PIRMA (db.devices.get→404); retired→400; empty text→400; db.commands.create (queued, expiresAt +24h, accountId iš DEVICE eilutės — ne scope, kad tenant-admin veiktų); RPUSH cmd:pending + SADD cmd:active (best-effort). `GET /v1/commands/:id` + `GET /v1/devices/:id/commands`. entity 'command': READ [...ROLES], WRITE ACCOUNT_WRITERS (hardware control).
- **ingest `drainPending`** (TRANSPORT ONLY, rule 3): po handshake + po kiekvieno stream frame LPOP cmd:pending (bound 16/drain) → `encodeCodec12(text)` → socket.write → RPUSH cmd:inflight {sentAtMs} + SADD cmd:active. cmd:resp branch + SADD cmd:active. Best-effort: send fail palieka inflight → dispatcher timeout re-queue'ina.
- **worker dispatcher** (`commands/dispatcher.ts` repeatable ~15s, concurrency:1): SMEMBERS cmd:active; per dev LRANGE inflight+resp → **`reconcile` (pure)** FIFO pair (device answers sequentially §3.5): resp[i]↔inflight[i] → acked (nack→failed); tail timeout>30s → retry attempt+1<3 → resend (RPUSH pending), else failed; remaining stay. Apply: DB UPDATE queued→sent (visi inflight), acked+response, failed, resend→queued; **race-safe cleanup** LTRIM resp (consumed head) + LREM inflight by value (ne destruktyvus rebuild — concurrent ingest append išsaugomas); DB-authoritative expiry (expiresAt<now → expired RETURNING); SREM cmd:active kai pending+inflight+remaining tušti. Metrika commands_resolved_total{outcome}.

## Failai

**Nauji:** packages/shared/src/entities.ts (commandCreateSchema + COMMAND_PRESETS 10); packages/db/src/repos/commands.ts (+db.ts+index); apps/worker/src/commands/{reconcile,dispatcher}.ts; apps/worker/__tests__/{command-reconcile,command-dispatcher}.spec.ts; apps/api/__tests__/commands.spec.ts; docs/epics/E08-2-plan.md.
**Keičiami:** apps/ingest/src/session.ts (drainPending + SADD); apps/worker/src/{main.ts,prom.ts}; apps/api/src/routes/crud.ts (3 routes + policies); apps/api/__tests__/helpers/auth.ts (fakeDb); tests/isolation/{fixtures.ts (commandId seed), suite.spec.ts (idFor)}; README.

## Testai (16 + isolation 22)

- **command-reconcile.spec (7, pure):** FIFO pair; nack→failed; within-window remaining; timeout retry attempt+1; final-attempt fail; mixed acked+pending; extra responses not consumed.
- **command-dispatcher.spec (4, fakes):** ack+trim+srem-idle; timeout retry DB→queued+rpush; final fail; DB-expired count.
- **commands.spec (5, api+pg+redis):** POST→201+cmd:pending+cmd:active+scoped GET; retired→400; cross-tenant→404+command-read 404; viewer send→403 read→200; empty→400.
- **isolation:** command fixture seed'inta → positive-control /v1/commands/:id 200 + item-route cross-tenant 404.

## Verifikacija (DoD)

Gates + testai žali. §3.5 semantika (FIFO correlate, 30s/retry3/24h). Rule 3: ingest = transport (LPOP/encode/RPUSH), policy worker'yje. §10 #7: command create iš device scope; get/list scoped; isolation. Rule 8: encodeCodec12 cituota.

## Rizikos

- **Late-response desync** (§3.5 accepted): timeout'inta komanda, jei device atsako vėliau, desyncina FIFO — real devices atsako per 30s; ilgesnė tyla = socket drop → re-send. Dokumentuota reconcile.ts.
- **ingest send-path testas**: simuliatorius nepriima komandų (read-side confuse) → NE e2e; padengta kontraktu (api įrodo cmd:pending, dispatcher įrodo inflight→DB) + transport mirror'ina esamą cmd:resp pattern.
- **Web UI + presets grid + deleterecords warning-gate** = E08-2b.
