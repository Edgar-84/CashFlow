#!/usr/bin/env bash
# PostToolUse (Write|Edit|MultiEdit): auto-format the touched Python file.
# Convenience, not a gate — must ALWAYS exit 0.
INPUT=$(cat)
f=$(echo "$INPUT" | jq -r ".tool_input.file_path // empty")
case "$f" in
  *.py)
    ruff format "$f" >/dev/null 2>&1
    # --fix silently repairs trivial issues; remaining problems go to stderr
    # so Claude sees them immediately, on the file it JUST edited.
    ruff check --fix "$f" 1>&2 || true
    ;;
esac
exit 0
