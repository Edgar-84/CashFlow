---
description: Implement one unit from an approved plan file
---
Implement exactly ONE unit from an approved plan.

1. Derive the branch name from the arguments: first token = unit id, as
   given; remaining words up to any file-path-looking token (contains "/"
   or ends in ".md") = short description, lowercased with spaces replaced
   by underscores. Branch name = `<unit-id>_<short_description>`.
   E.g. `/unit U.2.4 add new Transfer model` → `U.2.4_add_new_transfer_model`.
   - If the current branch's name already matches that derived name, stay
     on it — this is resuming work on the same unit (e.g. pushing a CI fix).
   - Otherwise: run `git status`; if the working tree isn't clean, stop and
     ask the user before doing anything else (never discard uncommitted
     work). If clean, `git checkout master && git pull`, then create and
     check out the new branch from master with the derived name.
2. Read the plan file and the task-methodology skill. Identify the unit,
   its acceptance criterion, and the relevant contracts.
3. Confirm scope in 2-3 bullets (files to touch). Contracts are immutable:
   if the unit cannot be done without changing them — stop and report.
4. Implement. Stay inside the unit: no drive-by edits to unrelated code.
5. Ensure the unit has tests matching its acceptance criterion.
6. Run bash scripts/verify.sh and fix failures.
7. Update the plan file: tick the unit checkbox, append to Decision log
   if any decision was made, refresh STATE.
8. Report: files changed, decisions, verify result. Do NOT commit.

Arguments (unit id + plan file): $ARGUMENTS
