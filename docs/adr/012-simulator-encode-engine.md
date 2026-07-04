# ADR-012: Simulator encode engine — in-house TS encoder in packages/codec

**Date:** 2026-07-04 · **Status:** accepted · **Story:** E01-4 (AC: "simulator encode-engine decision recorded")

## Context
E01-4/E02-1 need an encoder for Codec 8/8E packets (property test parse(encode(x))≡x now;
simulator scenarios in E02-1). PROJECT_PLAN §7.2 offered two paths: the Go
`alim-zanibekov/teltonika` library (shelling out to a Go binary) or a TS encoder written
from the wiki spec.

## Decision
**TS encoder inside packages/codec (`src/encode.ts`).** Rationale:
- Zero new runtime dependencies and no Go toolchain in CI (the Go lib would need a build
  step, a vendored binary per platform, and its own license/version tracking).
- Reuses our wiki-verified `crc16.ts` and the same byte-layout knowledge as `walk.ts` —
  encoder and walker cross-verify each other via the property test.
- Deterministic, seedable, one language across the monorepo.
- The wiki Codec page fully specifies the wire format; encode is the easy direction.

The Go library license check (the alternative's W1 AC) is therefore moot — decision is
recorded without it, as the story allowed ("Go lib license verified OR TS encoder chosen").

## Consequences
- tools/simulator (E02-1) imports `encodeAvlPacket` from @orbetra/codec — no shelling out.
- Codec 16 encode is not implemented (nothing needs it in v1; raw-fallback parse only).
