---
description: Implement one unit from an approved plan file
---
Implement exactly ONE unit from an approved plan.

1. Read the plan file and the task-methodology skill. Identify the unit,
   its acceptance criterion, and the relevant contracts.
2. Confirm scope in 2-3 bullets (files to touch). Contracts are immutable:
   if the unit cannot be done without changing them — stop and report.
3. Implement. Stay inside the unit: no drive-by edits to unrelated code.
4. Ensure the unit has tests matching its acceptance criterion.
5. Run bash scripts/verify.sh and fix failures.
6. Update the plan file: tick the unit checkbox, append to Decision log
   if any decision was made, refresh STATE.
7. Report: files changed, decisions, verify result. Do NOT commit.

Arguments (unit id + plan file): $ARGUMENTS
