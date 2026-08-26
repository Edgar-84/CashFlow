---
description: Run units from a plan file unattended via scripts/auto-units.sh
---
Launch the unattended unit runner and report on it. This is the batch
counterpart to `/unit`: `/unit` does one unit with you watching, `/units`
drives `scripts/auto-units.sh`, which runs a fresh `claude -p` session per
unit and merges each one after CI.

Arguments: $ARGUMENTS

## 1. Work out what to run
Parse `$ARGUMENTS`. Every part is optional.

- **A unit id** (`U3.12`) → `--only U3.12`, one unit.
- **A milestone prefix** (`U3`, `M3`, `3`) → `--only U3`. Normalise `M3`
  and `3` to `U3`.
- **`all`**, or no target at all → no filter, every remaining unit.
- **A path ending `.md`** → that plan file.
- **Anything starting `--`** → pass through untouched (`--dry-run`,
  `--max`, `--from`, `--until`, `--model`).

If no plan file is given, pick the file in `docs/plans/` that still has
`- [ ] **U…**` lines and was modified most recently. If two or more
qualify, list them and ask which — do not guess.

Echo the resolved command before running it.

## 2. Pre-flight — fix these before launching, they all abort the run
- `git status --porcelain` must be empty and HEAD must be `master`. If
  the tree is dirty, show what is dirty and stop; never stash or discard
  the user's work without asking.
- For every unit about to run, a branch matching `<unit-id>_*` must not
  already exist. A leftover from an earlier failed run makes the unit
  fail at checkout. Show any you find and ask before deleting.
- `jq` and `gh` on PATH; `gh auth status` working.

## 3. Launch it in the background
Run with the Bash tool and **`run_in_background: true`**:

```
bash scripts/auto-units.sh <plan> <flags>
```

Never run it in the foreground — a multi-unit run takes far longer than a
foreground call allows, and a timeout would orphan a session mid-unit.

Report the run directory (`.auto-units/<timestamp>/`) and which units are
queued, then hand control back. Do not poll in a loop and do not block:
the harness re-invokes you when the process exits.

## 4. While it runs
If the user asks for status, read the newest `.auto-units/*/` and report
from the rendered `<unit>.log`: current unit, last few tool lines, whether
the reviewer has run, whether a PR is open, and cost so far from any
`──` result lines. Do not re-launch, and do not run git commands that
change state — the runner owns the working tree until it exits.

## 5. When it finishes
Report per unit: DONE (with PR number) or STOPPED (with the reason), plus
what is on `master` now and which units remain. For a STOPPED unit, give
the `claude --resume <session-id>` line from the log so the user can
reopen that exact session, and say what the next command would be to
retry or continue.
