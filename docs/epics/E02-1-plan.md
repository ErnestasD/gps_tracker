# E02-1 Plan — Simulator v0 (M)

**Story:** IMPLEMENTATION_PLAN.md E02-1 · **Implements:** PROJECT_PLAN §7.2 · **Encoder:** ADR-012 (TS, @orbetra/codec)
**Status:** in progress

## Deliverables
- `tools/simulator/src/lcg.ts` — seeded PRNG (determinism AC; same pattern as codec property test)
- `tools/simulator/src/route.ts` — GeoJSON LineString walker: cumulative distances, position
  interpolation at 1 Hz with seeded speed profile, bearing → AVL `angle`
- `tools/simulator/src/routes/vilnius-loop.geojson` — synthetic ~2 km loop (test data, not protocol)
- `tools/simulator/src/scenarios/{liveDrive,corruptCrc,oversize}.ts` — Scenario interface
  `{ name, packets(opts): AsyncGenerator<Buffer> }` (runner owns the socket; scenarios emit wire bytes)
- `tools/simulator/src/client.ts` — TCP runner: IMEI handshake → await 0x01 → per packet
  write → await 4B ACK → verify count
- `tools/simulator/src/main.ts` — CLI: `sim --scenario liveDrive --imei 356... --host H --port 5027 --hz 1 --seed 1 --count 60`
  (hand-rolled arg parse — no new deps, CLAUDE.md rule 10)
- `packages/codec/package.json` gets an `exports` field so workspace consumers resolve `@orbetra/codec`

## AC mapping
- 3 scenarios runnable → CLI + tests instantiate each
- liveDrive protocol-valid → test round-trips every packet through @orbetra/codec framer+parse
- deterministic with --seed → test: same seed ⇒ byte-identical stream; different seed ⇒ differs

## NOT here
bufferedFlood/invalidFix/panic/slowLoris (E02-2); any server-side code.
