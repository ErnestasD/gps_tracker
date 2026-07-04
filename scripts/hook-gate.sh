#!/usr/bin/env sh
# PostToolUse gate (CC_PLAYBOOK §5): edited file -> owning package -> typecheck+lint+test.
# CLAUDE.md Commands section mandates all three after every edit.
# Graceful no-op when: non-package paths, toolchain missing, deps not installed.
set -eu
cd "$(dirname "$0")/.."

# Prefer repo-pinned Node 22 if the interactive shell has another version active
NVM_BIN=$(ls -d "$HOME/.nvm/versions/node"/v22*/bin 2>/dev/null | sort -V | tail -1 || true)
[ -n "$NVM_BIN" ] && PATH="$NVM_BIN:$PATH"

FILES="${CLAUDE_FILE_PATHS:-}"
if [ -z "$FILES" ] && [ ! -t 0 ]; then
  # Claude Code hooks pass a JSON payload on stdin; take tool_input.file_path
  FILES=$(node -e '
    let d = "";
    process.stdin.on("data", (c) => (d += c)).on("end", () => {
      try {
        const j = JSON.parse(d);
        console.log(j.tool_input?.file_path ?? "");
      } catch {
        console.log("");
      }
    });
  ' 2>/dev/null || true)
fi
[ -z "$FILES" ] && exit 0
command -v pnpm >/dev/null 2>&1 || exit 0
[ -d node_modules ] || exit 0

FILTERS=""
for f in $FILES; do
  rel=${f#"$PWD"/}
  case "$rel" in
    apps/*/*|packages/*/*|tools/*/*)
      dir=$(echo "$rel" | cut -d/ -f1-2)
      [ -f "$dir/package.json" ] || continue
      name=$(node -p "require('./$dir/package.json').name")
      # leading ... = the package AND its dependents (editing packages/shared gates apps too)
      case " $FILTERS " in
        *" --filter=...$name "*) ;;
        *) FILTERS="$FILTERS --filter=...$name" ;;
      esac
      ;;
  esac
done
[ -z "$FILTERS" ] && exit 0

if [ "${DRY_RUN:-}" = "1" ]; then
  echo "would run: turbo run typecheck lint test$FILTERS"
  exit 0
fi

# shellcheck disable=SC2086 # FILTERS is intentionally word-split
if ! pnpm turbo run typecheck lint test $FILTERS; then
  echo "hook-gate: gates FAILED for$FILTERS — fix before continuing" >&2
  exit 2
fi
