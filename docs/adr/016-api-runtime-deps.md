# ADR-016: apps/api runtime dependencies — hono, @hono/node-server, ws, ioredis

**Date:** 2026-07-04 · **Status:** accepted · **Story:** E02-4 (CLAUDE.md rule 10 gate)

- **hono + @hono/node-server** — the API framework is named in PROJECT_PLAN §5
  ("apps/api Hono REST + WS gateway"); node-server is its official Node adapter.
- **ws** — WebSocket server for the live stream (§6.6 `wss://…/v1/stream?ticket=`);
  Node has no built-in WS server. De-facto standard, zero deps.
- **ioredis** — same client as ingest/worker (ADR-014/015): ticket GETDEL, live pub/sub.

zod-openapi middleware arrives with E06-3 (public API) — not needed for the WS gateway.
