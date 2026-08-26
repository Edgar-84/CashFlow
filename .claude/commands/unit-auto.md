---
description: Implement one unit from an approved plan end-to-end, unattended (no human gates)
---
Autonomous variant of `/unit`. Same work, but the two human gates
(step 10 "Prepare PR?" and step 11 "want to merge?") are pre-approved by
the operator who launched this run. **You never ask a question — you
either finish the unit or stop with a reason.** There is nobody at the
keyboard.

Arguments (unit id + plan file): $ARGUMENTS

## Hard stops — check these FIRST, before touching anything
Stop immediately, print `AUTO_UNIT_RESULT: STOPPED <one-line reason>` and
do nothing else if any of these is true:
- The unit's text in the plan says to ask/confirm with the human
  (e.g. "**Ask the human before writing the migration file.**").
- The unit requires touching `migrations/versions/`, `.env*`, `uv.lock`
  or `webapp/pnpm-lock.yaml` (CLAUDE.md's "Do not edit without asking").
- The unit cannot be done without changing a Contract in the plan file.
- `git status` is not clean, or HEAD is not `master`, at start.
- The unit id is not in the plan, or its checkbox is already `[x]`.

## Steps
1. Branch. Read the unit's line in the plan and derive a short slug of
   3–6 words from it — lowercase, words joined by `_`, **letters, digits
   and underscores only** (no `+`, `.`, `/`, quotes or other symbols).
   Branch name = `<unit-id>_<slug>`.
   `git checkout master && git pull`, then create the branch from master.
2. Read the plan file and the task-methodology skill. Identify the unit,
   its acceptance criterion, and the relevant contracts.
3. State scope in 2-3 bullets (files to touch). Contracts are immutable.
4. Implement. Stay inside the unit: no drive-by edits to unrelated code.
5. Ensure the unit has tests matching its acceptance criterion.
6. Run `bash scripts/verify.sh` and fix failures.
7. Update the plan file: tick the unit checkbox, append to the Decision
   log if a decision was made, refresh STATE.
8. Review loop: launch the `reviewer` subagent (Agent tool, foreground)
   with a self-contained prompt — unit id, plan file path, an instruction
   to run `git diff master...HEAD` and `bash scripts/verify.sh`, then
   review per the code-review skill.
   - Fix any BLOCKER, and any WARN that is safe and in-scope, then re-run
     `bash scripts/verify.sh` and launch a fresh reviewer on the new diff.
   - **Cap the loop at 3 rounds.** If round 3 still returns an unresolved
     BLOCKER, stop: commit nothing, print
     `AUTO_UNIT_RESULT: STOPPED reviewer BLOCKER unresolved after 3 rounds`
     and leave the branch in place for the human.
   - An out-of-scope WARN/NIT may be left; note it in the report.
9. Commit + PR, as one uninterrupted sequence, no approval pause:
   stage exactly the files this unit touched (**never `git add -A`**),
   commit with the task-methodology commit-message format, push
   (`-u origin <branch>`), and open the PR with the task-methodology PR
   body template.
10. CI: `gh pr checks <PR> --watch` (blocks until the CI workflow ends;
   Deploy is a separate workflow that only fires after a merge — do not
   wait for it).
   - **`no checks reported` is a race, not an answer.** `gh pr checks`
     run straight after `gh pr create` often returns before the workflow
     registers, and `--watch` then exits instantly. Treat that string as
     "not yet": retry every 15s, up to 5 times. If it still says it,
     confirm with `gh run list --branch <branch> --limit 3` before
     concluding there is genuinely no CI — and never read it as green.
   - **Red:** you get exactly ONE fix attempt. Fix the cause, re-run
     `bash scripts/verify.sh`, push to the same branch, watch again. If
     it is still red, stop: print
     `AUTO_UNIT_RESULT: STOPPED CI red on PR #<n> — <failing job>`.
     Never merge a red PR.
   - **Green:** merge with `gh pr merge <PR> --merge` (merge commit — not
     squash, not rebase; it matches this repo's history).
11. Return to a clean base for the next unit:
   `git checkout master && git pull`. Confirm `git status` is clean and
   the unit's checkbox reads `[x]` on master.
12. Final line of your output, exactly one of:
   - `AUTO_UNIT_RESULT: DONE <unit-id> PR #<n> merged`
   - `AUTO_UNIT_RESULT: STOPPED <one-line reason>`
   Above that line, a short report: files changed, decisions, verify
   result, review rounds, anything knowingly deferred.
