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
8. Report: files changed, decisions, verify result, plus a drafted commit
   message (task-methodology skill's commit message format) and a drafted
   PR body (task-methodology skill's PR body template). Do NOT commit and
   do NOT open the PR yet — the human reviews the diff first.
9. Ask: "Prepare PR for this unit?" If the human confirms, stage exactly
   the files touched by this unit (never `git add -A`), commit with the
   drafted message, push the branch (`-u origin <branch>` if not already
   tracking), and open the PR with the drafted body — run commit/push/PR
   as one uninterrupted sequence without pausing for approval between
   them (git commit/push are pre-approved for this project in
   .claude/settings.local.json). If the human declines, wants edits, or
   doesn't respond with a clear yes, do nothing further.

Arguments (unit id + plan file): $ARGUMENTS
