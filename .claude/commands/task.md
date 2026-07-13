---
description: Standard workflow for implementing a task end-to-end
---
Implement the following task using this exact workflow:

1. PLAN: restate the task in 2-3 bullets, list files you expect to touch,
   flag anything ambiguous. If ambiguity is significant — stop and ask.
2. IMPLEMENT: follow CLAUDE.md conventions (root + subdirectory).
3. TEST: add/extend tests for the new logic (see testing skill).
4. VERIFY: run `bash scripts/verify.sh`; fix failures.
5. REVIEW: launch the reviewer subagent on the diff; fix all BLOCKERs.
6. REPORT: files changed, key decisions, verify.sh result, open questions.
   Do NOT commit — the user merges and deploys manually.

Task: $ARGUMENTS
