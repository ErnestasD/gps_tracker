# E05-5 Plan — Notification dispatch (email SES + Telegram + channel config)

> W5 S5. PROJECT_PLAN §6.5. Autonominė sesija. Split: **E05-5a dispatch core (this)** + follow-ups blokuoti ant founder credų.

## Context

E05-4 rašo `events` (su ruleId+kind) PRIEŠ notifikaciją. `Rule.channels` jsonb egzistuoja bet be shape. §6.5: „Every event persisted before notification attempted; notification failures retried by BullMQ (exp backoff, max 5)". Kanalai: email (SES eu-central-1) + Telegram (pairing deep-link → chat_id). ADR-020 jau padengia BullMQ visiems async (įsk. notifications) — naujo dep NĖRA (Telegram=fetch, email=injected transport).

**AC (W5 S5):** email + Telegram channel + per-account channel config. Exit: real car → Telegram <15s; panic instant.

## E05-5a scope (buildable + testable BE credų)

- **shared:** `notificationChannelSchema` = discriminatedUnion(email {to}, telegram {chatId}); `ruleCreateSchema.channels` = array(channel).max(20).
- **worker/notify/:** `message.ts` (pure: event→{subject,text} per kind), `drivers.ts` (Driver iface; `telegramDriver(token,fetch)` Bot API; `emailDriver(transport)` injected; `driversFromEnv` — token→telegram, transport→email, absent→skip), `dispatch.ts` (`dispatchEvent` per-channel dedup: alreadySent→skip, unconfigured→skipped(ne fail), send→markSent PO success; grąžina {sent,failed,skipped}).
- **worker/jobs/:** `notifyQueue.ts` (NOTIFY_QUEUE, enqueueNotify: jobId `notify:{ruleId}:{dev}:{atMs}` dedup, attempts:5 exp backoff), `notifyWorker.ts` (`loadRuleChannels` raw SQL `SELECT channels FROM rules WHERE id=$1 AND enabled`, validate; `runNotify` dispatch su Redis sent-set `notify:sent:{jobId}` sismember/sadd+EXPIRE 24h; throw jei failed>0 → BullMQ retry).
- **main.ts:** notifyQueue + notifyWorker (drivers=driversFromEnv(env)); enqueue PO `rulePersister.persist` (best-effort try); offline worker `onEvents` → enqueue device_offline notifs; SIGTERM close.
- **prom:** notification_sent_total{channel} / _failed_total{channel} / _skipped_total{reason}.

## Idempotencija / retry (§6.5)

- enqueueNotify jobId dedup: redelivered batch (ACK replay) → tas pats jobId → ne double-enqueue.
- Per-channel sent-set: retry re-siunčia TIK failed kanalus (delivered kanalas sent-set'e → skip). markSent PO success → failed send re-attemptina.
- Unconfigured driver → skipped (ne throw) → NE retry (credų retry nepataisys). Configured fail → throw → retry (max 5).

## BLOCKED-INFO (founder turi provisint)

- **AWS SES production access** + MAIL_FROM — real email. SES dar sandbox (docs/runbooks/aws-ses-setup.md). Email transport (nodemailer/SES, ADR-022) wire'inam kai credai. Iki tol email kanalas skipped.
- **TELEGRAM_BOT_TOKEN** — real Telegram send + pairing deep-link (t.me/<bot>?start=<token> → /start binds chat_id). Iki tol telegram skipped. Driver fetch VEIKIA — tik token trūksta.
- **Per-account channel config UI + Telegram pairing** — follow-up (E05-5b): naujas notification_channels/telegram-pairing table + /v1/channels CRUD + web + /start binding endpoint. Reikia token pilnam round-trip.
- **Webhook channel** — E06-4 (HMAC X-Signature). Ne šiame scope.

## Testai (22)

- notify.spec (11): dispatch sent/skipped/failed/dedup/mix; telegramDriver POST+throw; emailDriver delegate; driversFromEnv gating; message per kind.
- notify-worker.spec (8): loadRuleChannels validate+disabled; runNotify deliver/throw-on-fail/skip-unconfigured/no-channels.
- offline onEvents integ per enqueue (main).

## Verifikacija

Gates + 22 unit žali. Manual (kai credai): rule su telegram channel → panic → Telegram <15s. §10 #7 (tenant leak) — notify skaito channels by ruleId (rule jau account-scoped); message neturi cross-tenant duomenų.

## Rizikos

- Partial-failure double-send → sent-set per-channel dedup.
- Retry storm ant unconfigured → skipped(ne throw) neretryja.
- Email transport dar nėra → skipped; NE build throwaway nodemailer iki SES credų (ADR-022 kai wire).
- channels validacija: senos rules turi channels=[] (E05-3 UI nesetina) → jokių notif iki configūravimo (follow-up UI).
