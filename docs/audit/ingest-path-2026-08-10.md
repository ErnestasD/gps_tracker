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

## Status (2026-08-11)

| Finding | State |
|---|---|
| #2 unbounded Redis offline queue | **FIXED & LIVE** — PR #189 |
| #6 two loss counters never exported | **FIXED & LIVE** — PR #189, with `IngestSheddingDatagrams` |
| #4 parse failures carry no device identity | **FIXED & LIVE** — PR #192 (the livelock itself is NOT fixed; see below) |
| #9 XAUTOCLAIM's evicted-pending list discarded | **FIXED & LIVE** — PR #192, with `PipelinePendingEvicted` |
| #1 registry resurrection | **OPEN** — two attempts rejected, design below |
| #3 lapse re-assert skipped | **OPEN** — one attempt rejected, design below |
| #5 first frame of a session persists before any depth check | **OPEN**, untouched |
| #7 Codec 16 parked in an unread ring | **OPEN**, untouched — lowest priority (spec'd, alerted, no pilot device speaks it) |
| #8 one bad record discards the whole packet | **OPEN**, untouched — not loss on its own; only matters with #4's livelock |

**What #4 did and did not do.** The device is now named in the log (once per device per process) on
both transports, so an operator can pull a capture. The LIVELOCK is untouched: a deterministic
`FrameError` still gets ACK 0, so a device sending bytes we will never accept still resends forever
until its own buffer overwrites its oldest records. The fix for that is parking after k consecutive
failures — `parkUndecodableFrame` already exists in `apps/ingest/src/persist.ts`, takes a `reason`,
and writes imei + raw bytes to a MAXLEN-capped stream. It should be done with #8 (per-record
isolation), because together they turn "one poison record kills every packet forever" into "the bad
record is parked and the rest of the batch is ACKed".

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

---

## Finding #1 — two rejected attempts, and the design that survived review

Both attempts were written, reviewed by an independent hostile reviewer, and **rejected**. Neither
was merged or deployed. They are recorded because each failed for a reason worth not repeating.

### Attempt 1 — a guard on the write (rejected)

Added `HSET_IF_FREE_OR_MINE` to `activateDevice` plus a repair pass. Rejected because:

- it guarded a function **the boot path does not call** — `rehydrate` writes `registry:imei` through
  a raw pipelined `hset`, so the guard covered nothing that mattered;
- a refused write was **silent and partial**: the mapping absent while `device:tenant`,
  `device:account`, `device:config` and the index all said the device was live, and
  `restoreTenantDevices` still reported `{ ok: true }` so `unsuspend` cleared the flag;
- its repair pass could **delete the mapping of the device that legitimately reclaimed the IMEI** —
  verbatim the failure the neighbouring delete-if-mine guard exists to prevent;
- the test fake decided "is this guarded?" from a regex over the script text. A blind write that
  keeps the tokens satisfies all three predicates — **verified by executing them** — so every test
  passed while production stole every mapping.

### Attempt 2 — reconcile `registry:imei` against the DB after the pipeline (rejected)

Closer, and the *delete* direction is right. Rejected because:

- **the "add missing" loop is a regression `main` does not have.** Retire tears Redis down *before*
  the DB soft-delete commits, so a retire landing between the reconcile's read and its exec is
  **undone**. The losing window becomes strictly larger than `main`'s, and the resulting state is
  worse than either: the mapping is back while the id-keyed hashes stay deleted, so ingest accepts
  and persists, the live feed is silent (`liveState` sees a null tenant), and `usageWorker` — which
  has no `retiredAt` filter — **meters the customer for a device they retired**;
- **the two branches need contradictory read orderings.** Delete is sound only if the DB read is the
  newer; add is sound only if the Redis read is. `Promise.all` guarantees neither. A device created
  between the DB statement start and the HGETALL gets **HDEL'd while showing Active in the UI**;
- **no blast-radius guard.** An empty `listAllForRegistry()` — wrong `DATABASE_URL`, a restored empty
  DB — deletes every mapping on the platform. On `main` an empty read is a harmless no-op;
- **the suspension case gets worse**, not better: the add loop undoes a suspension that races the
  boot, and nothing reliably re-tears it down (see finding #3);
- **two of the four new tests pass against `main`** — verified by aliasing the module. The headline
  correction branch has **zero** coverage: deleting those five lines leaves all 13 tests green.

### The design to build next

1. **Delete branch only.** Its whole reachable population is teardowns that must not be undone plus
   hset failures the existing `failed` counter already reports. Drop the add loop.
2. **Sequence the reads, Redis first**: `HGETALL` (or better `HSCAN`) *then* the DB read, so the DB
   snapshot is strictly the newer one — the ordering the delete branch needs.
3. **Blast-radius guard**: refuse to delete when the DB read is empty and the hash is not, and cap
   the proportion removed in one pass without an explicit override. Log loudly either way.
4. **`listAllForRegistry` must filter suspended tenants** (`tenant: { suspendedAt: null }`). That
   repairs the additive pass and the reconcile at once, and closes most of finding #3.
5. **Reconcile the id-keyed keys in the same pass** — `device:tenant`, `device:account`,
   `device:config` and the per-tenant index — or the fix leaves a half-torn device that ingest
   refuses while the UI still lists it.
6. **Cheaper**: select `id, imei` only, and `HSCAN` rather than `HGETALL` (single-threaded Redis; the
   same function 40 lines below rejects `KEYS` for exactly this reason).
7. **A metric**, `rehydrate_imei_reconciled_total{action}`, so a mass delete is a graph and not a grep.
8. **Tests that fail against `main`.** Check every new test by aliasing the module to the `main`
   version first — that is what caught two useless ones here.

---

## Finding #3 — attempt rejected, and the design that survived review

The direction is right and was confirmed: the re-assert belongs above the grace check, it is keyed
on `suspendedAt` and not on ladder progress, the restore/warn/suspend order still holds, and the
ladder loop's replacement `continue` drops nothing (mail, `markLapseNotice`, `result.warned` and the
suppression path all sit above it). **The regressions were all in what the attempt ADDED.**

- **The budget is a category error and a strict regression.** `main` re-asserted every past-grace
  suspended tenant on every run, uncapped. The attempt added `MAX_REASSERTS_PER_RUN = 200` with a
  bare `break`, over a query with **no `ORDER BY`** — so Postgres heap order decides who is covered,
  the same first 200 are re-asserted daily, and 201+ are re-asserted *never*. Since the ladder loop
  now `continue`s unconditionally there is no second path to pick them up. Re-asserting is
  idempotent maintenance, not a destructive novel action like suspending; it does not want a blast
  radius. **Drop the cap.** If one is ever needed it must rotate (`orderBy: suspendedAt`, a
  persisted cursor) and report what it deferred.
- **It re-reads the wrong half of the predicate.** `isSuspended` is re-read; "still lapsed" comes
  from the snapshot. The restore-on-payment webhook commits `status = 'active'` **before**
  `unsuspend`, so a tenant is paid-but-still-flagged for the seconds its fleet takes to restore. The
  new pass tears that fleet down again, the webhook then clears the flag, and the result is a dark
  fleet flagged Active — invisible to `listSuspended` (not suspended) and to `listLapsedTenants`
  (paid), repairable only by an API restart. `main` was protected from this **only by the bug being
  fixed.** Gate on a re-read of the whole predicate (`suspendedAt` AND lapsed), and after the walk
  re-check `isSuspended`: if it flipped, restore immediately and log.
- **`reasserted++` sits inside the `try`, after the walk**, so when Redis is degraded — the exact
  scenario the cap was written for — nothing increments, `break` never fires, and every suspended
  tenant is attempted. Count attempts, not successes.
- **Nothing is observable.** `reasserted` is a local; `LapseSweepResult` and
  `billing_lapse_action_total` gain nothing, budget exhaustion is a bare `console.warn`. And the one
  gauge that should have caught the original incident still cannot: `billing_lapsed_actionable` is
  fed by `isActionable`, which excludes `past < 0` — precisely the clock-refreshed tenant.
- **`billing_lapsed_devices` silently changes meaning**: it now counts devices the same run has just
  removed from the registry, while its help text and runbook say "still ingesting for free".
- **`registryDevicesFor` runs an unfiltered platform-wide `deviceProfile.findMany` per tenant**, so
  the pass is 200 full profile scans a day. Resolve the profile map once per sweep.

### Tests — two lessons, both worth keeping

1. The second new test (`a tenant restored by a human mid-run is NOT torn back down`) **passes on
   `main` and passes with the entire new pass deleted** — its fixture is inside grace, so nothing
   runs either way. It asserts only a negative and never checks that the guard was consulted.
2. **The fix can be INVERTED with all 25 tests green.** Swap `suspendTenantDevices` for
   `restoreTenantDevices` — turning the pass into "re-arm every suspended fleet daily", the exact
   catastrophe — and everything still passes, because the fake Redis records only `'eval'` and
   `'multi'`, which both calls produce. A double that records command *names* and not command
   *shapes* cannot tell a teardown from a restore. Record keys and fields, then assert the teardown
   wrote `hdel device:tenant`.

---

## Finding #8 (+#4 parking) — attempt rejected. Read this before trying again.

**The attempt was a no-op for the trigger it cited**, and the reviewer proved it by building the
packets and running them against the vendored parser:

```
2 good + 1 with a REPEATED avl id (the audit's trigger)  -> THREW: Repeated id '1' in IOElement.
2 good + 1 with priority 5                               -> parsed OK, 3 records
```

`decodeIoWithLib` decodes **all** records in one `new ProtocolParser(hex)` call, *before* the
per-record loop. The lib's default `on_ioElement_error` rethrows, so a repeated id kills the whole
packet upstream of any isolation. What the attempt actually isolated was `priority > 2` — a
deliberate spec assertion it deleted — and a null IO value that is unreachable for codec 8.

**Any real fix must move the lib decode per-record** (a `ProtocolParser` per slice, or pass
`on_ioElement_error` so a bad record yields a partial map the loop can reject on its own). Without
that, per-record isolation cannot see the only failure worth isolating.

### The three rule-4 regressions it introduced

1. **A partial persist became a full ACK.** `persistAvlBatch` returns the count ACTUALLY written —
   an ioredis pipeline can partially fail without rejecting, and that under-count is what makes the
   device resend. Overriding it with `declaredCount` whenever any bad record is present acknowledges
   records that were never XADDed. `ackedRecordsTotal += acked - persisted` then feeds the fabricated
   number to the very I1 reconciliation that would have caught it.
2. **A swallowed park failure is permanent loss.** `parkBadRecord` is an XADD; catching its throw
   and ACKing anyway means a *transient* Redis blip destroys the record. Worse with no fault at all:
   a packet whose records are ALL bad gives `records = []`, `persistAvlBatch` early-returns 0 without
   touching Redis, and the full count is ACKed. The codec-16 precedent the attempt cited does the
   opposite — it does not catch, so a park failure kills the socket and the device retries.
3. **UDP got the new parse behaviour with none of the handling.** `parseUdpAvl` funnels through the
   same `parseAvl`, so on UDP the packet now parses, `badRecords` is ignored, nothing is parked, and
   `frameViolationsTotal`/`parseFailTotal`/the named IMEI all disappear — the wedge survives and
   every signal of it is removed. That silently re-opens finding #4 on the quieter transport.

### And the test looked right while testing nothing

The e2e was invariant to its own title: **invert the fix so every good record is discarded and it
still passes** (ACK is `declaredCount` either way, one parked entry either way). Its stated excuse —
"the synthetic fixture's coordinates do not survive §3.6" — is factually wrong: `lat=0, lon=0` pass
sanity; it is the helper's default `tsMs` (2019) that is below `minTsMs`. Passing `tsMs: Date.now()`
would have let it assert the shard stream, which is the seam the change actually touches.

### Also required next time

- **Rule 8 and 14**: turning `priority > 2` from a rejection into a tolerated quirk is a codec
  semantics change. It needs a wiki citation and an ADR, not a Traccar anecdote.
- Batch the parks into the existing pipeline: 255 sequential XADDs sit in front of the ACK, inside
  the §6.1 latency budget, and `rejects` is shared with the §3.6 audit trail it would evict.
- Do not reuse `onParseFailure` (one line per device per process) for a handled condition — it burns
  the slot that finding #4 added for diagnosing a real wedge.
- Add `ingest_bad_records_parked_total` and a park-failure counter; do not raise `parseFailTotal`
  for a packet that parsed and was fully ACKed.

---

## Finding #5 — attempt rejected. The plan already forbids the obvious fix.

**`PROJECT_PLAN.md` §6.1, Round 7:** *"Backpressure ordering clarified: persist → ACK → depth-check
→ pause (**never pause before ACK of an accepted packet**)."* The attempt did exactly that, for a
packet that framed and CRC-verified clean, with no ADR superseding the decision. Read that line
before touching this again — it was red-teamed once already.

The reviewer then executed five reproductions showing why the plan is right:

- **The gated frame is destroyed, not deferred.** `codec.feed()` has already removed the bytes from
  the framer (`frame.ts:53`), so the early return drops the last reference. And the device is
  stop-and-wait (§3.2): it sent one packet and blocks on the 4-byte count, so resuming the socket
  achieves nothing — measured, the shard drained, `pollForDrain` resumed, and no ACK ever arrived
  while `raw:{shard}` stayed empty. The idle timer is a plain `setTimeout` that `socket.pause()`
  does not stop, so the device then holds a dead connection slot for `readIdleTimeoutMs` — **40
  minutes in production** — during the reconnect storm the change was written for.
- **The gate does not hold.** `gatedFirstFrame` is a one-shot flag set before the await, and the
  frame loop only breaks on `socket.destroyed`. Two packets in one chunk (exactly a buffered flood,
  or plain TCP coalescing): the second skips the gate and persists **while over depth**, and the
  peer receives ONE 4-byte ACK for TWO packets. The Teltonika ACK is a bare count with no packet
  identity, so the device can advance past records that were never persisted — a rule-4 violation
  introduced by a fix meant to prevent loss.
- **The drop is unobservable**: no counter attributes it, and `pausedSockets` cannot distinguish
  "paused after ACK" (no loss) from "paused and discarded" (loss).
- **No precedent for no-ACK-and-hold-open**: every other refusal path terminates the socket.

**UDP is the counter-argument, not the model.** `udp.ts:159` already checks depth before persisting
on every datagram, with its own counter — and that is safe precisely because a dropped datagram
strands no session state. Copying the shape onto a stateful TCP session is what produces the
40-minute dead socket.

**If this is fixed at all**, the shape is: refuse and CLOSE the socket (so the device reconnects in
seconds), counted with its own metric — and it needs an ADR that supersedes the Round-7 decision and
says why it was wrong.

**The test was also vacuous.** Its fixture inherits `tsMs = 2019-06-10`, below `minTsMs`, so the
record goes to `rejects` rather than the shard **on `main` too** — `expect(xlen).toBe(before)` is
true either way. Of three assertions only "no ACK was sent" carried information, so any change that
suppresses the ACK would have passed. `pauseAboveDepth: 1, depthCacheMs: 0` is also unrepresentative:
production is 50 000 with a 1 s cache that no env var can lower.
