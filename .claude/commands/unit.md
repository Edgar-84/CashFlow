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
8. Review loop: launch the `reviewer` subagent (Agent tool, run in the
   foreground — its verdict gates the next step) with a clear,
   self-contained prompt. It has no memory of this session, so give it
   everything it needs: the unit id, the plan file path, and an
   instruction to run `git diff master...HEAD` (or the equivalent for the
   unit's base) plus `bash scripts/verify.sh`, then review per the
   code-review skill.
   - If it returns any BLOCKER, or a WARN that is safe and in-scope to fix
     now, fix it directly (stay inside the unit's boundaries — no
     drive-by edits) and re-run `bash scripts/verify.sh`, then launch a
     fresh reviewer subagent on the updated diff.
   - Repeat until the reviewer returns APPROVE with no unresolved
     BLOCKERs.
   - A WARN/NIT that is legitimate but genuinely out of scope for this
     unit (e.g. a pre-existing issue elsewhere) may be left — note it in
     the report instead of fixing it.
9. Report: files changed, decisions, verify result, a one-line summary of
   the review loop (rounds run, what was found and fixed, anything
   knowingly deferred), plus a drafted commit message (task-methodology
   skill's commit message format) and a drafted PR body (task-methodology
   skill's PR body template). Do NOT commit and do NOT open the PR yet —
   the human reviews the diff first.
10. Ask: "Prepare PR for this unit?" If the human confirms, stage exactly
   the files touched by this unit (never `git add -A`), commit with the
   drafted message, push the branch (`-u origin <branch>` if not already
   tracking), and open the PR with the drafted body — run commit/push/PR
   as one uninterrupted sequence without pausing for approval between
   them (git commit/push are pre-approved for this project in
   .claude/settings.local.json). If the human declines, wants edits, or
   doesn't respond with a clear yes, do nothing further.
11. If the PR was opened, watch its CI status: `gh pr checks <PR> --watch`
   (this blocks until the CI workflow finishes; the Deploy workflow is
   separate and only fires after a merge to master, so don't watch for it
   here).
   - **`no checks reported` is a race, not a green.** Run straight after
     `gh pr create`, `gh pr checks` often returns before the workflow
     registers, and `--watch` then exits 0 with nothing listed — no
     failures, success exit code, and CI has not started. Never read
     that as passing. Treat it as "not yet": retry every 15s, up to 5
     times, then confirm with `gh run list --branch <branch> --limit 3`
     before concluding there is genuinely no CI for this PR.
   - If checks fail, report which ones and stop — do not ask about
     merging a red PR.
   - If checks pass, ask: "CI is green — do you have an approve and want
     to merge this PR?" If the human confirms, merge with
     `gh pr merge <PR> --merge` (merge commit, matching this repo's
     history and branch-protection settings — not squash/rebase) and
     report the result. Merging into master triggers CI on master, which
     on success triggers the Deploy workflow automatically
     (`.github/workflows/deploy.yml`, `workflow_run` on CI) — no
     additional action needed to start the deploy. If the human declines
     or doesn't respond with a clear yes, do nothing further.

Arguments (unit id + plan file): $ARGUMENTS
