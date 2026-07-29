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

step "webapp: toolchain check"
if ! command -v pnpm >/dev/null 2>&1; then
  echo "ERROR: pnpm not found — install the JS toolchain (e.g. 'brew install node pnpm') to run the webapp lane." >&2
  fail=1
else
  (cd webapp && pnpm install --frozen-lockfile) || fail=1

  step "webapp: typecheck"
  (cd webapp && pnpm run typecheck) || fail=1

  step "webapp: lint"
  (cd webapp && pnpm run lint) || fail=1

  step "webapp: vitest"
  (cd webapp && pnpm run test) || fail=1

  step "webapp: build"
  (cd webapp && pnpm run build) || fail=1

  step "webapp: secret-grep on build output"
  if grep -RIlE 'INTERNAL_TOKEN|BOT_TOKEN|DATABASE_URL' webapp/dist 2>/dev/null; then
    echo "ERROR: secret-looking name found in webapp/dist build output." >&2
    fail=1
  fi
fi

if [ $fail -ne 0 ]; then
  echo "VERIFY: FAILED"
  exit 1
fi
echo "VERIFY: OK"
