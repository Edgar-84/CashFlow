---
name: task-methodology
description: Protocol for decomposing features into units of work, choosing the right model tier, and managing context across sessions. Use whenever starting a new feature, planning multi-step work, deciding how to split a task, resuming work on an existing plan, or when a task feels too big for one session.
---

# Task methodology (operational protocol)

Full rationale, analogies and a worked example: references/methodology.md.
Read it when designing a decomposition for an unfamiliar kind of feature.

## Unit of work — hard criteria
A unit is the smallest behavior change that is independently verifiable
and revertible. Every unit must satisfy ALL of:
1. verify.sh green after the unit (repo never left red between units)
2. Acceptance criterion written in the plan file BEFORE work starts
3. One unit = one commit; `git revert` of it breaks nothing else
4. Context budget: diff ≤ ~300 lines, ≤ 5 changed files, ≤ 7 files to
   keep in mind, ≤ 1 new design decision. Exceeding → split further.

## Decomposition order
U0 contracts (models, signatures, typed errors) → pure business logic →
persistence/IO → wiring (handlers/routes) → integration smoke.
Contracts are IMMUTABLE for units: if implementation hits a contract
limitation — stop, record the change in the plan Decision log, then continue.

## Plan file = persistent memory
One file per feature: docs/plans/<feature>.md (template: docs/plans/_template.md).
Sections: Goal / Non-goals, Contracts, Units checklist (each with an
acceptance criterion), Decision log, STATE (handoff note).
Everything not written in the plan does not exist for the next session.

## Model routing
- Architecture, decomposition, gnarly debugging → opus (opusplan + Plan Mode);
  on Pro without Opus: Sonnet + Plan Mode + /effort high
- Implementing an approved unit, writing tests → sonnet (default)
- Review → subagent (fresh context matters more than tier); risky diffs → opus
- Boilerplate, fixtures, renames, docstrings → haiku
Rule: expensive tokens where decisions branch; cheap tokens where the
plan already decided.

## Context rules
- /clear between units is the NORM. A unit starts from the plan file,
  never from chat history.
- Keep the session: iterative debugging of one problem; fixing review
  findings on a live diff.
- Before /clear or ending a session: run the /handoff protocol
  (checkboxes + STATE + Decision log).
- Contamination signs → /handoff then /clear: re-proposing rejected
  solutions, forgetting CLAUDE.md/plan constraints, touching unrelated
  files, stale file state, auto-compact fired mid-unit, sloppier edits.

## Git
One unit = one commit (Conventional Commits, mention the unit id).
Long units: WIP checkpoints after each green verify.sh, squash before
finishing. The plan file is committed and updated with every unit commit.
Never commit unless the user explicitly asks.

### Commit message format
```
U<milestone>.<unit>: <summary>
U<milestone>.<unit>: <type>(<scope>): <summary>
```
- Always prefix with the unit id: `U<milestone>.<unit>: `.
- Bare imperative summary for "build the unit" commits, e.g.
  `U0.3: add initial Alembic migration`.
- Conventional Commits `type(scope):` after the prefix for narrower fixes/
  refactors within a unit, e.g.
  `U0.4: fix(ci): treat zero collected integration tests as a pass`.

### PR body template
Use when opening a PR that bundles one or more U0.** units:
```markdown
## Summary
- U<id>: <what the unit implements, one line>
- Decisions: <Dn ids from the plan's Decision log, one-line each>

## Test plan
- [x] `bash scripts/verify.sh` green
- [ ] <any CI-only check not run locally, e.g. integration job against live DB>
- [x] Plan file updated: checkbox ticked, Decision log, STATE refreshed
```
