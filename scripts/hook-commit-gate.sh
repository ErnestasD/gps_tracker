#!/usr/bin/env sh
# Commit gate (CC_PLAYBOOK §5, CLAUDE.md rules 8–9). Three enforcement entry points:
#   staged        git pre-commit hook: quality gates for staged packages + TODO(VERIFY-WIKI)
#   msg <file>    git commit-msg hook: fixture changes need FIXTURE-APPROVED: trailer
#   claude        Claude Code PreToolUse(Bash) hook: same checks when the command is a git commit
#
# Gates are re-verified at commit time by running turbo for the staged packages
# (+ their dependents). Turbo's cache makes this near-instant when hook-gate.sh
# or `make gates` already ran; a cold/red package fails closed here.
set -eu
cd "$(dirname "$0")/.."

# Prefer repo-pinned Node 22 if the interactive shell has another version active
NVM_BIN=$(ls -d "$HOME/.nvm/versions/node"/v22*/bin 2>/dev/null | sort -V | tail -1 || true)
[ -n "$NVM_BIN" ] && PATH="$NVM_BIN:$PATH"

fail() {
  echo "commit-gate: $1" >&2
  exit "${2:-1}"
}

check_staged() {
  code="${1:-1}"
  # package dirs are always <root>/<name>/ with no spaces in the first two segments
  pkg_dirs=$(git diff --cached --name-only --diff-filter=ACMR -z | tr '\0' '\n' |
    grep -E '^(apps|packages|tools)/[^/]+/' | cut -d/ -f1-2 | sort -u || true)
  FILTERS=""
  for d in $pkg_dirs; do
    [ -f "$d/package.json" ] || continue
    name=$(node -p "require('./$d/package.json').name")
    FILTERS="$FILTERS --filter=...$name" # leading ... = package AND its dependents
  done
  if [ -n "$FILTERS" ]; then
    if [ "${DRY_RUN:-}" = "1" ]; then
      echo "would run: turbo run typecheck lint test$FILTERS"
    else
      command -v pnpm >/dev/null 2>&1 ||
        fail "pnpm not on PATH — cannot verify gates ('nvm use' then 'npm i -g pnpm@10')" "$code"
      # shellcheck disable=SC2086 # FILTERS is intentionally word-split
      if ! out=$(pnpm turbo run typecheck lint test $FILTERS 2>&1); then
        printf '%s\n' "$out" | tail -25 >&2
        fail "quality gates failed for staged packages — fix and retry" "$code"
      fi
    fi
  fi
  # Rule 8 targets code/comments; .md docs and this enforcement tooling legitimately
  # contain the marker text and are excluded (they'd self-trigger otherwise).
  if git diff --cached -- . ':(exclude)*.md' ':(exclude)**/*.md' \
    ':(exclude)scripts/hook-commit-gate.sh' ':(exclude)scripts/__tests__/hooks.spec.sh' \
    ':(exclude).github/workflows/ci.yml' | grep -q '^+.*TODO(VERIFY-WIKI)'; then
    fail "TODO(VERIFY-WIKI) in staged diff — resolve the citation first (CLAUDE.md rule 8)" "$code"
  fi
}

check_msg_text() {
  msg="$1"
  code="${2:-1}"
  if git diff --cached --name-only | grep -q '^packages/codec/__fixtures__/'; then
    printf '%s\n' "$msg" | grep -q '^FIXTURE-APPROVED:' ||
      fail "golden fixture change without FIXTURE-APPROVED: trailer (CLAUDE.md rule 9)" "$code"
  fi
}

case "${1:-staged}" in
  staged)
    check_staged 1
    ;;
  msg)
    [ -n "${2:-}" ] || fail "msg mode needs the commit-message file path"
    check_msg_text "$(cat "$2")" 1
    ;;
  claude)
    # stdin: Claude Code hook JSON; only act on `git commit` commands (matcher is tool-level)
    [ -t 0 ] && exit 0
    cmd=$(node -e '
      let d = "";
      process.stdin.on("data", (c) => (d += c)).on("end", () => {
        try {
          const j = JSON.parse(d);
          console.log(j.tool_input?.command ?? "");
        } catch {
          console.log("");
        }
      });
    ' 2>/dev/null || true)
    printf '%s' "$cmd" | grep -Eq '(^|[;&|[:space:]])git[[:space:]]+commit' || exit 0
    check_staged 2
    # try the inline -m message; the commit-msg git hook is the authoritative trailer check
    msg=$(printf '%s' "$cmd" | sed -n 's/.*-m[[:space:]]*"\([^"]*\)".*/\1/p')
    [ -n "$msg" ] && check_msg_text "$msg" 2
    ;;
  *)
    fail "unknown mode '${1}'"
    ;;
esac
exit 0
