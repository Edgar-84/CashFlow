#!/usr/bin/env bash
# Stop hook: Claude may not finish the turn while verification fails.
# exit 2 + stderr = "keep working, here is why".
INPUT=$(cat)

# CRITICAL: prevent infinite loop — if we already blocked once this turn
# and Claude tried again, let it stop and report honestly.
if [ "$(echo "$INPUT" | jq -r ".stop_hook_active")" = "true" ]; then
  exit 0
fi

# Only gate when code actually changed (cheap heuristic: dirty working
# tree). Pure Q&A turns should not trigger a test run.
if git rev-parse --git-dir >/dev/null 2>&1; then
  if [ -z "$(git status --porcelain 2>/dev/null)" ]; then
    exit 0
  fi
fi

[ -f scripts/verify_old.sh ] || exit 0

OUT=$(bash scripts/verify_old.sh 2>&1)
if [ $? -ne 0 ]; then
  echo "verify.sh FAILED. Fix these before finishing:" 1>&2
  echo "$OUT" | tail -n 40 1>&2
  exit 2
fi
exit 0
