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
