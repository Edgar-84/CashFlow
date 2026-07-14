---
name: code-review
description: Checklist and output format for reviewing code changes in CashFlow. Use when asked to review a diff, a branch, a PR, or after finishing any non-trivial unit — especially units touching permissions, money math, or notification logic.
---

# Code review protocol (CashFlow)

## Procedure
1. Scope: review `git diff` (or the named branch/unit), never the whole repo.
2. Run `bash scripts/verify.sh` first — do not review code that fails mechanics.
3. Read the unit definition and AC in docs/plans/*.md — review AGAINST the
   plan: scope creep and unmet acceptance criteria are findings too.

## Checklist (priority order)
1. **Layering**: routes → services → repositories only. No asyncpg imports
   outside repositories/. No business logic in routes or repos. bot/ has
   zero DB imports and talks HTTP only.
2. **Money**: BIGINT minor units end to end. Any float/Decimal in amount
   math, any /100 before storage, any float percent used for comparisons
   with money — BLOCKER.
3. **Permissions**: every new route has a PermissionChecker dependency with
   correct (resource, action); own_only paths verified; no route trusts
   client-supplied user/account UUIDs — everything derives from tg_id.
4. **Async safety**: unawaited coroutines, blocking calls (time.sleep,
   sync HTTP, sync file IO) in async paths, connections/clients not closed
   or not pooled, missing transaction where multi-statement writes occur.
5. **SQL**: parametrized queries only ($1, $2 — never f-strings into SQL);
   account_id scoping present in EVERY query (cross-account leak = BLOCKER).
6. **Error handling**: typed domain errors, no bare except, notification
   failures logged and swallowed (never propagate into expense creation).
7. **Contracts**: Base/Create/Update/Response pattern respected; response
   models never leak internal fields; changed contracts = must be reflected
   in the plan Decision log.
8. **Tests**: new logic has tests asserting behavior; unit tests touch no
   network/real DB; permission changes update the U2.1 test grid.

## Output format
- BLOCKER — must fix before commit (bug, security, money, layering breach)
- WARN — should fix, not blocking
- NIT — optional polish
File:line on every finding. Max 15 findings, terse. End with a verdict:
APPROVE or REQUEST_CHANGES.
