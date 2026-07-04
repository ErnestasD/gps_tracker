#!/usr/bin/env sh
# Plain-sh assertions for hook-gate.sh + hook-commit-gate.sh (E01-1 AC).
# Usage: sh scripts/__tests__/hooks.spec.sh   (from anywhere; exits non-zero on any failure)
set -u
ROOT=$(cd "$(dirname "$0")/../.." && pwd)
FAILS=0

ok() { echo "  ok: $1"; }
ko() {
  echo "  FAIL: $1" >&2
  FAILS=$((FAILS + 1))
}

echo "hook-gate.sh"

out=$(CLAUDE_FILE_PATHS="$ROOT/packages/shared/src/index.ts" DRY_RUN=1 sh "$ROOT/scripts/hook-gate.sh" </dev/null)
case "$out" in
  *"--filter=...@trackcore/shared"*) ok "maps package path to dependents-inclusive filter" ;;
  *) ko "expected ...@trackcore/shared filter, got: $out" ;;
esac

out=$(CLAUDE_FILE_PATHS="$ROOT/docs/x.md $ROOT/README.md" DRY_RUN=1 sh "$ROOT/scripts/hook-gate.sh" </dev/null)
if [ -z "$out" ]; then ok "no-ops on non-package paths"; else ko "expected no-op, got: $out"; fi

out=$(CLAUDE_FILE_PATHS="$ROOT/apps/api/src/index.ts $ROOT/apps/api/tsconfig.json" DRY_RUN=1 sh "$ROOT/scripts/hook-gate.sh" </dev/null)
case "$out" in
  *"--filter=...@trackcore/api --filter="*) ko "duplicate filter not deduped: $out" ;;
  *"--filter=...@trackcore/api"*) ok "dedupes filters for same package" ;;
  *) ko "expected api filter, got: $out" ;;
esac

echo "hook-commit-gate.sh (in throwaway repo)"
TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT
(
  cd "$TMP"
  set -e
  git init -q -b main
  git config user.email t@t && git config user.name t
  mkdir -p scripts packages/codec/__fixtures__ packages/shared/src docs
  cp "$ROOT/scripts/hook-commit-gate.sh" scripts/
  printf '{\n  "name": "@trackcore/shared"\n}\n' > packages/shared/package.json
  git add -A && git commit -qm init
) || ko "throwaway repo setup"

# staged package file -> gates would run for that package + dependents
(
  cd "$TMP"
  set -e
  echo 'export const x = 1' > packages/shared/src/a.ts
  git add packages/shared/src/a.ts
  out=$(DRY_RUN=1 sh scripts/hook-commit-gate.sh staged)
  case "$out" in
    *"--filter=...@trackcore/shared"*) exit 0 ;;
    *) exit 1 ;;
  esac
) && ok "computes dependents-inclusive turbo filter for staged package" || ko "staged package should produce turbo filter"

# docs-only staged -> no gates run
(
  cd "$TMP"
  set -e
  git reset -q --hard
  echo 'notes' > docs/note-plain.md
  git add docs/note-plain.md
  out=$(DRY_RUN=1 sh scripts/hook-commit-gate.sh staged)
  [ -z "$out" ]
) && ok "runs no gates for docs-only commits" || ko "docs-only commit should skip gates"

# TODO(VERIFY-WIKI) in staged code diff -> block
(
  cd "$TMP"
  set -e
  git reset -q --hard
  mkdir -p packages/shared/src
  echo '// TODO(VERIFY-WIKI): what is byte 7?' > packages/shared/src/a.ts
  git add packages/shared/src/a.ts
  ! DRY_RUN=1 sh scripts/hook-commit-gate.sh staged 2>/dev/null
) && ok "blocks TODO(VERIFY-WIKI) in staged code diff" || ko "should block VERIFY-WIKI marker"

# marker in a .md doc -> allowed (rule 8 targets code/comments, not docs)
(
  cd "$TMP"
  set -e
  git reset -q --hard
  mkdir -p docs
  echo 'the TODO(VERIFY-WIKI) marker blocks commits' > docs/note.md
  git add docs/note.md
  DRY_RUN=1 sh scripts/hook-commit-gate.sh staged 2>/dev/null
) && ok "allows VERIFY-WIKI text in markdown docs" || ko "should allow marker text in docs"

# fixture change without trailer -> block; with trailer -> pass
(
  cd "$TMP"
  set -e
  git reset -q --hard
  echo '{"hex":"00"}' > packages/codec/__fixtures__/wiki-example.hex.json
  git add packages/codec/__fixtures__/wiki-example.hex.json
  echo 'fix: tweak fixture' > msg.txt
  ! sh scripts/hook-commit-gate.sh msg msg.txt 2>/dev/null
) && ok "blocks fixture change without FIXTURE-APPROVED trailer" || ko "should block fixture without trailer"

(
  cd "$TMP"
  set -e
  printf 'fix: tweak fixture\n\nFIXTURE-APPROVED: wiki /view/Codec section 3, founder sign-off\n' > msg.txt
  sh scripts/hook-commit-gate.sh msg msg.txt 2>/dev/null
) && ok "passes fixture change with FIXTURE-APPROVED trailer" || ko "should pass fixture with trailer"

# non-fixture commit with plain message -> pass
(
  cd "$TMP"
  set -e
  git reset -q --hard
  mkdir -p packages/shared/src
  echo 'export const y = 1' > packages/shared/src/b.ts
  git add packages/shared/src/b.ts
  echo 'feat: normal change' > msg.txt
  sh scripts/hook-commit-gate.sh msg msg.txt 2>/dev/null
) && ok "msg mode ignores non-fixture commits" || ko "msg mode should ignore non-fixture commits"

echo
if [ "$FAILS" -gt 0 ]; then
  echo "$FAILS assertion(s) FAILED" >&2
  exit 1
fi
echo "all hook assertions passed"
