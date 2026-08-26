#!/usr/bin/env bash
# Run every remaining unit of a plan file end-to-end, unattended.
#
#   bash scripts/auto-units.sh docs/plans/mini-app-v7.md
#   bash scripts/auto-units.sh docs/plans/mini-app-v7.md --max 3
#   bash scripts/auto-units.sh docs/plans/mini-app-v7.md --dry-run
#
# One fresh `claude -p` session per unit — the equivalent of /clear
# between units, with no context carried across them. Each session runs
# /unit-auto, which implements, verifies, reviews, commits, opens the PR,
# watches CI and merges. This script only decides WHICH unit runs next
# and refuses to continue after anything goes wrong.
#
# Flags:
#   --max N     stop after N units (default: all remaining)
#   --from ID   skip units before ID
#   --dry-run   list what would run, run nothing
#   --model M   model for the unit sessions (default: opus)
set -uo pipefail

PLAN=""; MAX=0; FROM=""; DRY=0; MODEL="opus"
while [ $# -gt 0 ]; do
  case "$1" in
    --max)     MAX="$2"; shift 2 ;;
    --from)    FROM="$2"; shift 2 ;;
    --model)   MODEL="$2"; shift 2 ;;
    --dry-run) DRY=1; shift ;;
    -h|--help) sed -n '2,19p' "$0"; exit 0 ;;
    *)         PLAN="$1"; shift ;;
  esac
done

[ -n "$PLAN" ] && [ -f "$PLAN" ] || { echo "usage: bash scripts/auto-units.sh <plan-file> [--max N] [--from ID] [--dry-run]"; exit 2; }
command -v claude >/dev/null || { echo "FATAL: claude CLI not on PATH"; exit 2; }
command -v gh     >/dev/null || { echo "FATAL: gh CLI not on PATH"; exit 2; }

RUN_DIR=".auto-units/$(date +%Y%m%d-%H%M%S)"
mkdir -p "$RUN_DIR"
say() { printf '\n\033[1m== %s\033[0m\n' "$*"; }

# --- pre-flight -------------------------------------------------------
[ -z "$(git status --porcelain)" ] || { echo "FATAL: working tree is dirty — commit or stash first"; exit 1; }
[ "$(git rev-parse --abbrev-ref HEAD)" = "master" ] || { echo "FATAL: not on master (on $(git rev-parse --abbrev-ref HEAD))"; exit 1; }
git pull --ff-only >/dev/null 2>&1 || { echo "FATAL: could not fast-forward master"; exit 1; }

# --- unit list --------------------------------------------------------
# Unchecked units, in plan order.
mapfile -t UNITS < <(grep -oE '^- \[ \] \*\*U[0-9][0-9.]*\*\*' "$PLAN" | grep -oE 'U[0-9][0-9.]*')
[ "${#UNITS[@]}" -gt 0 ] || { echo "Nothing to do — no unchecked units in $PLAN"; exit 0; }

# The unit's own text block, used to detect human gates.
unit_block() {
  awk -v id="$1" '
    $0 ~ "^- \\[.\\] \\*\\*" id "\\*\\*" { p=1; print; next }
    p && /^- \[.\] \*\*U/ { exit }
    p && /^#/ { exit }
    p { print }
  ' "$PLAN"
}

say "Plan: $PLAN"
echo "Remaining units: ${UNITS[*]}"
echo "Logs: $RUN_DIR"

RAN=0; STARTED=0
for UNIT in "${UNITS[@]}"; do
  if [ -n "$FROM" ] && [ "$STARTED" -eq 0 ]; then
    [ "$UNIT" = "$FROM" ] || { echo "skip $UNIT (before --from $FROM)"; continue; }
  fi
  STARTED=1
  if [ "$MAX" -gt 0 ] && [ "$RAN" -ge "$MAX" ]; then say "Reached --max $MAX — stopping"; break; fi

  BLOCK="$(unit_block "$UNIT")"
  if printf '%s' "$BLOCK" | grep -qiE 'ask the human|migrations/versions|confirm with the human'; then
    say "HUMAN GATE at $UNIT — stopping"
    echo "This unit's plan text asks for a human decision (migration file, contract, or similar)."
    echo "Run it yourself with:  /unit $UNIT $PLAN"
    exit 3
  fi

  if [ "$DRY" -eq 1 ]; then echo "would run: $UNIT"; RAN=$((RAN+1)); continue; fi

  say "$UNIT — starting ($(date +%H:%M:%S))"
  LOG="$RUN_DIR/$UNIT.log"
  claude -p "/unit-auto $UNIT $PLAN" \
    --model "$MODEL" \
    --output-format text \
    --permission-mode acceptEdits \
    --allowedTools 'Bash(cat:*)' 'Bash(ls:*)' 'Bash(sed -n:*)' 'Bash(head:*)' \
                   'Bash(grep:*)' 'Bash(rg:*)' 'Bash(find:*)' 'Bash(wc:*)' \
                   'Bash(gh pr:*)' 'Bash(git:*)' 'Task' 'TodoWrite' \
    2>&1 | tee "$LOG"

  # --- verdict: trust the merge, not the transcript --------------------
  RESULT="$(grep -oE 'AUTO_UNIT_RESULT: (DONE|STOPPED).*' "$LOG" | tail -1)"
  git checkout master >/dev/null 2>&1
  git pull --ff-only  >/dev/null 2>&1
  if grep -qE "^- \[x\] \*\*$UNIT\*\*" "$PLAN" && [ -z "$(git status --porcelain)" ]; then
    say "$UNIT — DONE and merged to master  (${RESULT:-no result line})"
    RAN=$((RAN+1))
  else
    say "$UNIT — STOPPED"
    echo "${RESULT:-no AUTO_UNIT_RESULT line — session died or was interrupted}"
    echo "Checkbox on master is still unchecked. Log: $LOG"
    echo "Nothing further will run. Branch left in place for inspection."
    exit 4
  fi
done

say "Finished — $RAN unit(s) merged. Logs in $RUN_DIR"
