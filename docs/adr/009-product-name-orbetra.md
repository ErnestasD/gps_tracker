# ADR-009: Product name — Orbetra (replaces codename TrackCore)

**Date:** 2026-07-04 · **Status:** accepted · **Deciders:** founders

## Context
E00-5 flagged that "TrackCore" was a codename only, requiring a real product name
before the public site ships (trademark, domain, PL/DE pronunciation checks).
ADR numbers 001–008 are reserved by PROJECT_PLAN §9.7 for pre-allocated decisions.

## Decision
Product name is **Orbetra**. All documents, package scope (`@orbetra/*`), root package
name and API-key prefix (`orb_live_`) renamed on 2026-07-04.

## Consequences
- E00-5's remaining checks (EUIPO trademark quick search, domain availability,
  PL/DE pronunciation) still need founder confirmation before the public site ships —
  the rename itself does not close E00-5.
- Telegram bot display name (E00-4) and future tenant-facing defaults should use
  white-label-neutral naming per plan; platform-brand surfaces use Orbetra.
- Repo name stays `gps_tracker` (infra label, not brand).
