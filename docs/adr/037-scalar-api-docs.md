# ADR-037: Scalar for the API reference page

Date: 2026-08-17 · Status: accepted

## Context

`/v1/docs` rendered a minimal home-grown list of operations — deliberately dependency-free
(the docs.ts comment reserved "a Scalar/Stoplight embed can replace the renderer later behind
an ADR"). The founder asked (2026-08-17) for the API reference to match the company's other
project, extractbee.com/api/reference, which is Scalar with the `kepler` theme: a proper
three-pane reference with try-it, generated code samples and search, which the hand-rolled
list was never going to grow into.

## Decision

Render `/v1/docs` with **Scalar's standalone browser bundle from jsDelivr, pinned to an exact
version** (`@scalar/api-reference@1.65.1`), configured `{ url: '/v1/openapi.json', theme:
'kepler' }` — the same integration shape extractbee uses.

- **No npm runtime dependency** (rule 10 satisfied via this ADR either way): the bundle is a
  `<script src>` tag, nothing enters package.json or the server bundle.
- **Pinned version, not `latest`**: jsDelivr rewrites minified artifacts, so SRI hashes are
  not usable — the exact-version pin is the supply-chain control. Bumps are deliberate edits.
- `/v1/openapi.json` is unchanged and remains the machine-readable contract.

## Consequences

- The docs PAGE now needs jsdelivr.net reachability in the reader's browser; the spec JSON
  stays first-party. Acceptable for a docs page; if the CDN ever becomes a problem, vendor
  the same bundle into the repo and serve it first-party (the page shell doesn't change).
- The page still uses an inline bootstrap script — the existing "no CSP on /v1/docs" note in
  security.ts (security-pass audit) is unchanged; a future CSP needs a nonce/hash plus a
  `script-src`/`connect-src` allowance for cdn.jsdelivr.net.
- The spec models routes, auth and status codes but not request/response bodies (openapi.ts);
  Scalar renders those operations thin. Enriching the spec is a separate, worthwhile story.
