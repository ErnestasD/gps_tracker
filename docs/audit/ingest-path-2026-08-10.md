# Ingest-path audit — 2026-08-10

Module 1 of the priority ranking (data acquisition: `apps/ingest` + `packages/codec` +
`packages/registry`). Rated 10/10 because a defect here destroys data that can never be re-derived,
silently, for every customer at once — everything else in the platform is a view over these rows.

**Method.** Three independent hostile audits (wire protocol · data loss & ordering · registry gate),
then three independent verifiers whose instruction was to **refute**, defaulting to REFUTED when
uncertain. Two verifiers ran empirical probes rather than reasoning: one measured the ioredis offline
queue against a dead Redis, the other desynchronised the real 26-packet Traccar corpus at 200 offsets
and pushed 20 000 random chunks through the framer.

That second pass paid for itself: **three findings were refuted outright, four were materially
rewritten, and the verifiers found two the auditors had missed.**

---

## Verified queue

| # | Finding | Status | Where |
|---|---|---|---|
| 1 | `activateDevice` writes `registry:imei` blind while `deactivateDevice` carries a delete-if-mine guard; a stale snapshot resurrects a retired device **permanently** | CONFIRMED ×2 | `packages/registry/src/index.ts`, `apps/api/src/rehydrate.ts` |
| 2 | ingest's Redis connection has an unbounded offline command queue (`maxRetriesPerRequest: null`, no `commandTimeout`, `enableOfflineQueue` default) | CONFIRMED, **measured** ~6.3 KB per stranded reconnect ⇒ ~7 GB/h on a 5 000-device fleet | `apps/ingest/src/main.ts:14` |
| 3 | the lapse sweep's suspension re-assert sits **below** `if (past < 0) continue`, and `lastBillingEventAt` is overwritten by any applied Stripe event ⇒ a suspended tenant can run free for the whole grace window after any restart | CONFIRMED | `apps/worker/src/jobs/lapseSweepWorker.ts` |
| 4 | a repeated AVL IO id is accepted by our walker and rejected by the ADR-010 wrapped parser ⇒ deterministic `FrameError` ⇒ ACK 0 ⇒ the device resends identically until its own buffer overwrites its oldest records | CONFIRMED (the **only** reachable parse-failure trigger of the four claimed) | `packages/codec/src/parse.ts:144` |
| 5 | `handleStreamFrame` persists a session's **first** frame before any depth check — the genuinely un-gated injection path (~136 records/session; ~370 new sessions burn a shard's headroom) | CONFIRMED (found by a verifier, not by the audit) | `apps/ingest/src/session.ts` |
| 6 | `udpInflightDropsTotal` and `sessionErrorsTotal` are incremented and never exported | CONFIRMED — and it is **#80 of the 2026-08-04 audit, double-confirmed then and absent from the remediation tracker** | `apps/ingest/src/prom.ts` |
| 7 | Codec 16 frames are ACKed into `raw:unsupported`, a 10 k ring with **no consumer** | CONFIRMED mechanism; severity lower than claimed | `apps/ingest/src/persist.ts` |
| 8 | one malformed record throws away every good record in the same packet | CONFIRMED; **not loss on its own** (the device resends the whole packet) — only with #4 | `packages/codec/src/parse.ts:93` |
| 9 | `XAUTOCLAIM`'s third element (PEL ids Redis deleted) is typed and discarded | CONFIRMED code fact; **not** the load-bearing signal it was claimed to be | `apps/worker/src/consumer.ts:170` |

### Notes that change what to do

- **#7** is a *normative v1 decision* (`PROJECT_PLAN` §3.1), it has a dedicated counter and an alert
  at any non-zero rate, and Codec 16 is FMB630/FM63XY only — **no pilot device speaks it**. The
  claim that "Codec 16 is trivially decodable so the trade was unnecessary" is half right: the layout
  was confirmed byte-exactly against the wiki, Traccar and our own fixture, but the ADR-010 parser
  **cannot** decode it (it reads group counts at 2 bytes where the wiki says 1), so this means
  writing our own IO decoder.
- **#4** is the *specified contract* (`PROJECT_PLAN` §3.2 — "the device becomes our replay buffer"),
  not a code defect. It is also loud in aggregate (`ParseFailSpike`). The real defect is
  **under-attribution**: no IMEI label, so the alert names a rate and not a device.
- **#9**: `res[2]` lists only entries already delivered to a consumer. In the trim-overflow case the
  evicted entries are the oldest and were never delivered, so they can never appear there. The real
  coverage (`stream_depth` + `StreamDepthCritical` at 90 k) exists and is wired.

---

## Refuted — do not act on these

- **GDPR erase leaves `registry:imei` behind.** Erase requires an already-retired device
  (`crud.ts:804`, re-checked in the worker), and retire is what removes the mapping. Unreachable on
  its own — but it becomes real **through #1**, which is why #1 is first.
- **A suspended tenant can re-add devices through CRUD.** A suspended tenant always resolves to
  `FLOOR_ENTITLEMENTS` with `deviceLimit: 0`, so all three create paths 403 before `activateDevice`.
  Covered by `entitlements.spec.ts:218`.
- **A CRC failure desynchronises the stream into a 40-minute silent shredder.** Measured: 199 of 200
  desync offsets throw in the framer on the first extraction, and 19 997 of 20 000 random chunks do;
  a throw is counted (`ingest_frame_violations_total`) and destroys the socket.

---

## What could not be broken (worth keeping)

All three auditors and two verifiers independently attacked **ACK-before-persist (hard rule 4)** and
none of them broke it. Every ACK write is downstream of an awaited Redis write; the persisted count
is derived from `pipeline.exec()` results, so it can only under-report, which resends. The same holds
for XACK placement, the `(device_id, fix_time, rec_hash)` conflict key (`rec_hash` covers the entire
wire record, so two distinct fixes cannot collide), shard-lease exclusivity, the CRC implementation
and span, and the framer's length bounds.

The losses found here do not come from the ACK contract. They come from **memory, from a ring nobody
reads, and from a signal nobody exported.**

---

## Process finding

**#6 was confirmed twice in the 2026-08-04 audit and never entered the remediation tracker** (74
findings; it is not among them). The memory note "113 findings, all closed" is false for at least
one. Before trusting that tracker again, diff the audit's confirmed set against it.
