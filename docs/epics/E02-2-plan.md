# E02-2 Plan — Simulator v1: adversarial scenarios (M)

**Story:** IMPLEMENTATION_PLAN.md E02-2 · **Implements:** PROJECT_PLAN §7.2 scenarios
**Status:** in progress (worktree lane, parallel to E01-3/E01-2 shipping)

## Deliverables
- `src/drive.ts` — shared route-record factory (extracted from liveDrive so flood/invalidFix
  reuse identical record synthesis)
- `scenarios/bufferedFlood.ts` — N records (default 300) timestamped now−2h..now,
  oldest-first, packed into MAX-SIZE packets at the 1280 B protocol cap boundary
  (PROJECT_PLAN §3.3), sent at wire speed (hz ignored)
- `scenarios/invalidFix.ts` — interleaves satellites=0 records carrying the LAST VALID
  coords with angle=0, speed=0 (§3.4 invalid-fix rule) between normal drive records
- `scenarios/panic.ts` — priority=2 records with DIN1 event (eventIoId=1, io 1=1) per §3.4
  priority semantics
- `scenarios/slowLoris.ts` — a valid packet trickled 1 byte / 5 s: scenario sets
  `byteDelayMs`; client gains optional per-byte write pacing
- CLI registers all scenarios

## Deviation note
Story AC "CI e2e job runs every scenario against compose stack" requires apps/ingest —
which is E01-5 (not yet built; build order E02-1 → E01-5 per Appendix E R2). Here:
unit/in-process-server tests prove scenario correctness; the compose e2e harness
(`tests/e2e/scenarios.spec.ts`) lands WITH E01-5 where a server exists to assert against.
Tracked in both plan docs.

## Tests
- flood: ≥1 packet whose wire size is within one record of 1280 B and none exceed it;
  timestamps strictly ascending oldest-first spanning ~2 h; all frames re-parse
- invalidFix: sats=0 records reuse previous valid coords exactly, angle=0, speed=0;
  valid/invalid interleave pattern as configured
- panic: priority=2 + DIN1=1 + eventIoId=1; frames re-parse
- slowLoris: byteDelayMs honored by client (in-process server measures inter-byte gaps
  loosely) — bounded count to keep the test fast
