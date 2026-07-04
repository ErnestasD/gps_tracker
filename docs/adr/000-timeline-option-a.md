# ADR-000: Delivery timeline — Option A (10 weeks)

**Date:** 2026-07-04 · **Status:** accepted · **Deciders:** founders

## Context
IMPLEMENTATION_PLAN.md Appendix E audit R5 counted the backlog at 7 L + 29 M + 9 S ≈ 47.5
focused dev-days; with review/rework tax (×1.3) and real-device debugging tail this is
~66–68 days needed vs ~56 available at 70% founder allocation. The plan required choosing
one of three options before W1: (A) 10 weeks, (B) 8 weeks with pre-committed descopes,
(C) allocation ≥85%.

## Decision
**Option A — 10 calendar weeks.** Pilots start W10. W9 = pilot shadow mode + E09 (affiliate
module & public-site glue). W10 = hardening buffer. Full scope retained; no verification
work (invariant tests, isolation suite, restore drill, load gate) is cut under any schedule
pressure.

## Consequences
- Epic-to-week mapping E01–E08 keeps its W1–W8 labels; the calendar simply allows slippage
  into W9–W10 without triggering panic descopes.
- Kill/pivot review (PROJECT_PLAN §11) moves to W10 accordingly.
- If W2 exit still slips past day 18, ADR-001's Traccar-headless Plan B trigger applies
  unchanged.
