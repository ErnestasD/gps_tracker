# CC_PLAYBOOK.md — Running Claude Code on Orbetra Without Drift
Companion to CLAUDE.md (hard rules) and IMPLEMENTATION_PLAN.md (backlog). This file is HOW; those are WHAT.
Sources: Anthropic Claude Code docs (worktrees, subagents, hooks), community best-practice compilations
(github.com/hesreallyhim/awesome-claude-code, github.com/shanraisshan/claude-code-best-practice,
rosmur.github.io/claudecode-best-practices). Numeric heuristics below are community-derived, not laws — tune them.

## 1. Operating philosophy
Treat CC as a capable engineer with amnesia: perfect execution inside a session, zero memory across them.
Therefore: all truth lives in files (PROJECT_PLAN/CLAUDE.md/IMPLEMENTATION_PLAN/ADRs), never in chat history.
Demand evidence, not claims — "show me the failing-then-passing test output", never accept "it works".
Separate contexts catch bugs the writing context can't: one agent writes, a fresh one reviews (test-time compute).

## 2. Session lifecycle (per story)
1. `claude` in the right worktree → paste: "Read CLAUDE.md, IMPLEMENTATION_PLAN.md story <ID>, and PROJECT_PLAN §<ref>. Enter plan mode."
2. **Plan mode always** before edits. Approve/edit the plan; for L-stories save it to `docs/epics/<ID>-plan.md`.
3. Tests first where the story says so (codec/pipeline/trip stories name their fixture/scenario — CC must write or extend it before implementation).
4. Implement smallest diff → hooks run gates automatically → fix until green.
5. `/review` (adversarial subagent, fresh context, read-only) → triage findings → fix.
6. Commit (conventional: `feat(scope): ... [E02-3]`), PR with evidence block (test output, metrics screenshot if pipeline).
7. `/clear`. Never carry a finished story's context into the next one.

**Context hygiene (community heuristics):** keep CLAUDE.md under ~2k tokens (ours is — don't let CC bloat it; pointers over prose); clear or compact when context feels heavy (~50–60k tokens of chatter) or after two failed correction attempts — a fresh session with the plan file beats arguing; check `/context` when sluggish.

## 3. Worktrees = parallel lanes (native support)
Claude Code has first-class worktrees: `claude --worktree <name>` creates `.claude/worktrees/<name>/` on its own branch; desktop app isolates every session automatically; subagents accept `isolation: worktree` frontmatter so parallel edits never collide. Add `.claude/worktrees/` to .gitignore and a `.worktreeinclude` file so `.env` copies into new worktrees.
**Our discipline:** max **2–3 concurrent lanes** — the cap is founder review capacity, not CC. Legal pairs are listed in IMPLEMENTATION_PLAN "Parallelization map"; anything touching `packages/codec/__fixtures__` or `packages/db/sql` runs alone on main lane. Weekly `git worktree prune`.
Pattern per lane: Terminal A = feature story · Terminal B = independent story from the map · Terminal C (optional) = review/docs lane running subagents only.

## 4. Subagent roster (`.claude/agents/*.md`, checked into repo)
Design rule from the field: use subagents to (a) keep noisy research out of the main context and (b) **narrow capability** — reviewers are read-only. Writer-type agents get `isolation: worktree`.

- **adversarial-reviewer** (read-only; tools: read, grep, bash[test-only]) — runs the Adversarial Review prompt from CLAUDE.md against a diff; outputs violation|file:line|why|fix. Invoked by `/review`.
- **tenant-guard** (read-only) — scans diffs for unscoped queries, raw prisma imports, missing tenant params; fails loudly. Runs inside `/review` for any packages/db or apps/api change.
- **protocol-verifier** (read-only + web fetch of wiki.teltonika-gps.com only) — checks every byte-offset/AVL claim in a diff against the wiki; emits TODO(VERIFY-WIKI) list. Mandatory for packages/codec and apps/ingest diffs.
- **test-writer** (isolation: worktree) — given a story's AC, writes failing tests + fixtures only; never implementation. Used at step 3 when the founder wants tests drafted in parallel.
- **doc-sync** (isolation: worktree) — after merge, updates README env table, OpenAPI notes, runbooks touched by the story.
Keep the roster this small. Community consensus: sprawling agent zoos and heavy MCP loadouts (>~20k tokens of tool definitions) degrade results — this repo needs no MCP servers at all.

## 5. Hooks (`.claude/settings.json`) — guarantees, not requests
CLAUDE.md is advisory to the model; hooks are enforced. Ours:
```json
{
  "hooks": {
    "PostToolUse": [{
      "matcher": "Edit|Write",
      "hooks": [{"type":"command","command":"scripts/hook-gate.sh \"$CLAUDE_FILE_PATHS\""}]
    }],
    "PreToolUse": [{
      "matcher": "Bash(git commit*)",
      "hooks": [{"type":"command","command":"scripts/hook-commit-gate.sh"}]
    }]
  }
}
```
- `hook-gate.sh`: maps changed path → package → `turbo run typecheck test --filter=<pkg>`; nonzero exit surfaces to CC immediately (tight feedback beats end-of-session surprises).
- `hook-commit-gate.sh`: blocks commit if (a) full affected-graph tests haven't passed since last edit (marker-file pattern), (b) `grep -R "TODO(VERIFY-WIKI)"` hits, (c) fixtures dir modified without `FIXTURE-APPROVED:` trailer in the staged commit message (enforces CLAUDE.md rule 9).
- Anti-pattern (community-flagged): auto-format-on-every-edit hooks burn tokens/time — format only in the commit gate.

## 6. Slash commands (`.claude/commands/`, in git)
- `/story <ID>` → loads CLAUDE.md + story + linked plan section, enters plan mode.
- `/review` → spawns adversarial-reviewer (+tenant-guard, +protocol-verifier when paths match) on `git diff main...HEAD`, collates findings.
- `/adr <title>` → scaffolds docs/adr/NNN with context/decision/consequences.
- `/catchup` → summarizes diff vs main + open TODOs for a returning founder (start-of-day).
- `/evidence` → runs the story's named tests and formats output for the PR body.
Rule of thumb: if you do it more than once a day, make it a command; if the command list grows past ~8, you're automating a broken process — simplify instead.

## 7. Multi-Claude verification pattern (the highest-ROI habit)
Writer session finishes → open FRESH session (or `/review`): "You didn't write this. Prove it's wrong." Same model, separate context, reliably finds what the author-context is blind to. For risky refactors, add "grill me on these changes; don't approve until I pass" — make CC argue against merging.
Escalation ladder when stuck: (1) protocol question → cite wiki or mark VERIFY-WIKI; (2) design ambiguity → concrete either/or question to founder; (3) two failed fixes → `/clear`, restate from plan file; (4) "knowing everything you know now, scrap this and implement the elegant solution" — the rewrite prompt outperforms patch-on-patch.

## 8. Headless & CI
`claude -p "<prompt>" --output-format json` for automation: nightly `/catchup` digest to Telegram; label-triggered issue triage; CI comment bot running adversarial-reviewer on PRs (read-only token). Never give headless runs write perms beyond the worktree; the deny-list in settings blocks `curl` to non-wiki hosts, `rm -rf`, and network installs outside allowlisted registries.

## 9. Anti-patterns (do NOT)
Mega-sessions spanning stories (context rot) · trusting "done" without test output · letting CC edit golden fixtures to make tests pass · adding MCP servers "just in case" · >3 parallel lanes · complex agent orchestration frameworks (debugging them costs more than they save) · vague prompts ("improve the ingest") — always story-ID-anchored · skipping plan mode "because it's small".

## 10. Playbook audit log (5 rounds)
- **P1 source-accuracy:** every CC capability claimed here (worktree flag & auto-desktop isolation, `isolation: worktree` frontmatter, `.worktreeinclude`, hooks PreToolUse/PostToolUse, headless `-p`) verified against Anthropic docs/community sources listed in the header; community numbers (2k-token CLAUDE.md, ~60k clear cadence, 2–3 lane cap, >20k-token MCP warning) labeled as heuristics, not facts.
- **P2 consistency with CLAUDE.md:** no command/agent here permits what CLAUDE.md forbids; fixture-immutability is enforced twice (rule 9 + commit-gate (c)); free-stack mandate respected (protocol-verifier may fetch ONLY the Teltonika wiki).
- **P3 consistency with IMPLEMENTATION_PLAN:** parallel-lane pairs reference the plan's map verbatim; `/story` assumes story IDs exist (they do); test-first step mirrors stories that name fixtures.
- **P4 failure-mode walk:** for each §9 anti-pattern, checked a mechanical counter exists (hooks, worktree isolation, command design) — two gaps closed during drafting: commit-gate fixture check added; deny-list for headless network access added to §8.
- **P5 founder-workflow realism:** two-person team can run this — daily cost is one `/catchup`, plan approvals, and PR reviews; nothing requires babysitting live sessions; weekly maintenance = worktree prune + CLAUDE.md token check.
