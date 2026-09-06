# Asset trackers: close a trip from AVL 240, not only from displacement

**Date:** 2026-09-06 · **Status:** decided, deliberately DEFERRED (founder: "kol kas nereik").
**Size:** small — same shape as the ignition fix in PR #287, plus tests.
**Trigger to build it:** the first customer with real asset trackers. Today there is exactly **one**
`noIgnition` device on the platform (11 profiles, 1 device) against 98 profiles / 499 devices with
an ignition line, which is why this is not worth doing yet.

## The gap

PR #287 let an INVALID fix end a trip: "the ignition is off" is not a claim about where the vehicle
is, so a car parked under a roof (`satellites = 0`) can still be seen to stop. That fixed every
ignition-wired tracker.

It deliberately excluded the `noIgnition` (asset) profile. That profile decides a stop from
DISPLACEMENT between two positions, and displacement is exactly what an unplaceable record cannot
supply. So an asset tracker parked where it has no sky never stops in the engine's eyes:

- the trip is closed by the nightly `closeOrphans` sweep instead of by the engine
- the figures it writes are correct (that path reconstructs from `positions`, fixed 2026-09-05)
- but the trip only ENDS hours late

## The fix

`AVL 240 "Movement"` — one byte, `0 – Movement Off / 1 – Movement On` — is the device's own
accelerometer answering "am I moving". Like ignition, it is a statement about the DEVICE'S MOTION,
not about its position: an accelerometer does not need the sky. It is therefore readable from an
invalid-fix record on exactly the same grounds, and it is present on the asset tables (checked:
`tat100` carries both 239 and 240).

In `TripEngine.observeStopWithoutFix`, which today returns early for `noIgnition`:

- `movement === false` drives the stop timer against `parkedStopS` (300 s)
- `movement === true` clears it, as `ignition === true` does now
- `movement === null` is no statement and leaves it alone
- the trip still ends at the last VALID fix — only a valid fix ever wrote those coordinates

`normalize.ts` already lifts AVL 240 into `NormalizedRecord.movement`, and the engine already reads
it when OPENING a trip on the ignition profile (`r.movement === true || speed > …`). Nothing reads
it for CLOSING one. No new plumbing is needed.

## What it changes, and what it does not

Only WHEN the trip closes — minutes instead of overnight. Distance, max speed and the end position
are already correct either way, because the orphan sweep reconstructs them from `positions`.

Where the delay is actually felt: the live map keeps the asset marked as moving until the sweep; a
"trip ended at base" geofence rule fires late; an end-of-day report run in the evening does not yet
contain the trip.

Ignition-wired vehicles are unaffected — PR #287 already covers them.
