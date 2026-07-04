# E01-1 Plan — Monorepo scaffold & CI (M)

**Story:** IMPLEMENTATION_PLAN.md E01-1 · **Implements:** PROJECT_PLAN §5 map, §9.4 hooks
**Status:** awaiting founder approval

## Environment prerequisites (found during planning)
- Local machine runs **Node v25.6.1**; the plan mandates **Node 22 LTS**. Action: pin
  `"engines": { "node": ">=22" }` + `.nvmrc` with `22`, and recommend switching the dev
  shell to Node 22 (nvm/volta). CI will run on Node 22 regardless.
- **pnpm is not installed.** Action: `corepack enable` + `"packageManager": "pnpm@<pinned>"`
  in root package.json so every machine and CI resolve the identical pnpm version.

## Deliverables (files)
1. **Workspace root:** `package.json` (private, engines, packageManager, scripts),
   `pnpm-workspace.yaml` (apps/*, packages/*, tools/*), `turbo.json` (tasks: `typecheck`,
   `lint`, `test`, `build` with per-package caching), `tsconfig.base.json` (strict, NodeNext),
   `.prettierrc`, `vitest.workspace.ts`, `Makefile` (targets stubbed: `up`, `migrate` echo
   "E01-2/E01-3"; real ones land in those stories).
2. **ESLint:** flat config `eslint.config.js` at root (story's Files list says `.eslintrc.cjs`
   but its Approach says "ESLint flat config" — flat config wins: ESLint 9 default, matches
   "flat config" wording; noted here as the discrepancy resolution). Wired rules:
   - `no-restricted-imports`: `@prisma/client` banned everywhere EXCEPT `packages/db/**`
     (CLAUDE.md rule 2);
   - `@typescript-eslint/no-floating-promises`: error (PROJECT_PLAN §9.6);
   - typescript-eslint recommended-type-checked baseline.
3. **Package stubs** per §5 map: `apps/{ingest,worker,api,web}`, `packages/{codec,db,shared}`,
   `tools/{simulator,replay,redact}` — each: `package.json` (name `@trackcore/*`, scripts
   typecheck/lint/test), `tsconfig.json` extending base, `src/index.ts` placeholder, one
   trivial vitest spec so the test task is exercised end-to-end. `apps/web` stub stays a plain
   TS package for now (Vite scaffold arrives in E02-6 — smallest-diff rule).
4. **Hooks (guarantees, per CC_PLAYBOOK §5):**
   - `scripts/hook-gate.sh` — maps `$CLAUDE_FILE_PATHS` → owning package →
     `turbo run typecheck test --filter=<pkg>`; graceful no-op for non-package paths
     (docs/, root configs); writes a green-marker file consumed by the commit gate.
   - `scripts/hook-commit-gate.sh` — blocks commit when: (a) affected-graph gates haven't
     passed since last edit (marker-file pattern), (b) `TODO(VERIFY-WIKI)` present in staged
     diff, (c) `packages/codec/__fixtures__/**` staged without `FIXTURE-APPROVED:` trailer
     in the commit message (CLAUDE.md rules 8–9). Runs prettier check (format only at gate,
     not per-edit — playbook anti-pattern note).
   - `.claude/settings.json` — PostToolUse(Edit|Write) → hook-gate; PreToolUse(git commit) →
     commit-gate.
5. **CI:** Node 22 + corepack pnpm, install with lockfile, `turbo run typecheck lint test`
   (affected graph vs base on PRs via `--filter=...[origin/main]`, full run on main pushes).
   Greps the diff for `TODO(VERIFY-WIKI)` and fails on hit (mirrors the local gate —
   CLAUDE.md rule 8 CI-block). Host: GitHub Actions (`.github/workflows/ci.yml`) —
   origin is github.com/ErnestasD/gps_tracker (see Resolved below).
6. **Tests:** `scripts/__tests__/hooks.spec.sh` (plain sh assertions): gate no-ops on
   `docs/x.md`; gate maps `packages/shared/src/index.ts` → `@trackcore/shared`; commit-gate
   blocks on a staged `TODO(VERIFY-WIKI)`; commit-gate blocks fixture change without trailer
   and passes with it.

## Acceptance criteria walk (how each is demonstrated)
- [ ] `pnpm i && pnpm turbo run typecheck lint test` green on fresh clone → run locally, output in PR evidence block.
- [ ] Deliberate type error → CI red; `@prisma/client` import in apps/api → lint red → demonstrated via two scratch commits on a throwaway branch (evidence: CI screenshots/log), then reverted.
- [ ] hook-gate runs affected gates on CC edit → manual scratch-edit verification, transcript in PR.
- [ ] Staged `TODO(VERIFY-WIKI)` blocked by commit-gate → covered by hooks.spec.sh + manual demo.

## Out of scope (NOT here)
Docker/compose (E01-2), Prisma schema (E01-3), any app logic, Vite web app (E02-6),
`.claude/agents/*` + slash commands (playbook §4/§6 — proposed as a small follow-up chore
after E01-1 merges, so the adversarial-review flow exists before E01-4).

## Sequencing
Single branch `feat/E01-1-scaffold`, one PR. After merge, Appendix D allows the first
parallel lanes: E01-2 (infra) ∥ E01-4 (codec). Adversarial review pass on the diff before
merge per CLAUDE.md workflow step 6.

## Resolved during planning
- **CI host:** founder decision 2026-07-04 — `origin` = github.com/ErnestasD/gps_tracker
  (GitHub Actions CI as the backlog assumes); bitbucket.org/ErnestasD/gps_tracker kept as
  `bitbucket` mirror remote. E00-2's "GitHub org" satisfied by the personal repo for now.
- pnpm version: pin current stable (10.x) via `packageManager`; bump deliberately later.
