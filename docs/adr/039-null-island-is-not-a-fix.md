# ADR-039: an exact 0/0 is not a fix, whatever the satellite count says

Date: 2026-08-24 · Status: accepted

## Context

PROJECT_PLAN §3.4 is **wiki-verified** and models one no-fix shape: at acquisition, a Teltonika
device repeats its **last valid lat/lon with angle 0, satellites 0, speed 0**. From that,
`fix_valid := satellites > 0`, restated as CLAUDE.md hard rule 6.

On 2026-08-20 the founder watched a vehicle jump mid-drive to the Gulf of Guinea. The device — an
FTC887, IMEI redacted — had sent **lat 0, lon 0 with 34–37 satellites** and speed 0, fifty times
across two days. Every one was stored as a **valid** fix, because §3.4's rule is about satellite
count and says nothing about the coordinate.

Downstream, `fix_valid` is what every consumer trusts: the public share link, trip distance and
max-speed, geofence evaluation, the map trail, the GDPR export. A trip opened at 0/0 and a geofence
exit was one zone away from firing.

CLAUDE.md says that when the plan and the hardware disagree, the hardware wins and the discrepancy is
recorded here. This is that record. §3.4 is not wrong — it is **not sufficient**, and the wiki does
not document this shape at all.

## Decision

`fix_valid` requires **both**:

1. `satellites > 0` — §3.4, unchanged; and
2. **not an exact 0/0** — `lat === 0 && lon === 0` is rejected at any satellite count.

**Exact equality, not a radius.** A tolerance would begin discarding real fixes off the African
coast. This is a sentinel value, not a region. A single zero axis is a real place and is explicitly
preserved: the Greenwich meridian (`lon = 0`) and the equator (`lat = 0`) both stay valid, and both
are asserted in the worker, web and migration tests.

**One definition.** The predicate is `isNullIsland` in `@orbetra/shared`, imported by the worker
(write path) and the web client (read path). A rule with two definitions is a rule with two answers,
and the client must refuse the same rows the pipeline refuses — the stored rows outlive the fix.

**The client keeps its own guard even after the repair.** `004_null_island_fix_valid.sql` repairs
stored rows only within 14 days (the compression boundary), so rows older than that keep saying
`fix_valid = true` forever. `placeableFix` on the client is not belt-and-braces; it is the only thing
standing in front of those rows.

## Consequences

- §3.4 and rule 6 are amended to state both conditions. Without that, the next reader of the
  normative spec has a documented mandate to revert this.
- `docs/runbooks/first-hardware.md` step 4 ("`fix_valid` vs `satellites == 0` must be the same set;
  a mismatch is ours") is no longer true as written and is amended: they are the same set **except**
  for an exact 0/0.
- Trips already closed with a null-island endpoint keep their distance until someone enqueues a
  recompute. The migration says so rather than implying otherwise.
- Golden fixtures are untouched: `codec8`/`codec8e` carry 0/0 with `satellites: 0`, already invalid
  under the old rule. Rule 9 holds.

## Alternatives rejected

- **Radius around 0/0.** Discards real Atlantic fixes to catch a sentinel. Wrong shape of tool.
- **Client-only guard.** Leaves the database asserting something false, which trips, geofences,
  billing exports and the share link all read directly.
- **Server-only guard.** Does nothing for the rows already written, which is what the founder saw.
