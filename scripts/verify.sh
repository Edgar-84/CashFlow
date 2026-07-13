#!/usr/bin/env bash
# Single source of truth for "is this code OK".
# Called by: Claude Code Stop-hook, pre-commit/pre-push, GitHub Actions, you.
set -uo pipefail
fail=0
step() { echo "==> $1"; }

step "ruff format --check"
uv run ruff format --check . || fail=1

step "ruff check"
uv run ruff check . || fail=1

step "mypy"
uv run mypy . || fail=1

step "pytest (unit, no integration)"
uv run pytest -q -m "not integration" || fail=1

if [ $fail -ne 0 ]; then
  echo "VERIFY: FAILED"
  exit 1
fi
echo "VERIFY: OK"
