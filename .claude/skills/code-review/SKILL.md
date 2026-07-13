---
name: code-review
description: Checklist and output format for reviewing code changes in this repo. Use when asked to review a diff, a PR, a branch, or after finishing a significant implementation task.
---

# Code review protocol

1. Scope: review `git diff` (or the named branch/PR), not the whole repo.
2. Run scripts/verify.sh first — do not review code that fails mechanics.
3. Checklist: correctness → project conventions (CLAUDE.md) → error handling
   and typed failures → async safety → tests exist and assert behavior →
   security (secrets, injection, unsafe eval) → performance only if obvious.
4. Output: BLOCKER / WARN / NIT findings with file:line, then verdict
   APPROVE or REQUEST_CHANGES. Terse. Max 15 findings.
