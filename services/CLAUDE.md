# services/ — business logic

<!-- Loaded only when Claude works inside services/. -->

## Purpose
All business rules live here. Services orchestrate one or more repositories
and side effects (notifications). Routes MUST NOT contain business logic;
repositories MUST NOT know about other repositories.

## Layering
- `api/` → `services/` → `repositories/`. Never skip a layer.
- Services receive repositories via **constructor DI** (no module-level
  singletons, no globals).
- Cross-repo work belongs here (e.g. "create expense → check budget → notify").

## Modules
- `expense_service.py` — CRUD; **on create, triggers the notification check**.
- `budget_service.py` — progress calculation, plan summaries.
- `statistics_service.py` — aggregation by period / category / tag.
- `notification_service.py` — sends Telegram messages via **Bot API through
  httpx**, NOT through aiogram (services must not depend on aiogram).

## Notification flow (invariant)
On `ExpenseService.create(...)`:
1. Save expense via `expense_repo.create(...)`.
2. `fill_pct = await budget_plan_repo.check_limit(category_id, account_id)`.
3. If `fill_pct >= budget_plan.notify_threshold`:
   `await notification_service.send(user, category, fill_pct)`.
4. Return the created `ExpenseResponse`.

Failure to send a notification must NOT roll back the expense. Log and continue.

## Rules
- Async everywhere (`async def` + `await`).
- No `print()`; use stdlib `logging`, with `extra={...}` for structured fields.
- Raise domain exceptions (`BudgetNotFound`, `PermissionDenied`) — routes map
  them to HTTP status codes in `api/deps.py` or per-router error handlers.
- Money is `int` (minor units). All percentage math uses `float`.

## Background jobs (APScheduler)
- Scheduled jobs (e.g. monthly rollovers, recurring reminders) are defined
  next to the service they belong to, wired in `main.py`'s `lifespan`.
- Jobs MUST be idempotent — the same job may fire twice on restart.

## Testing
- Unit tests mock the repository interfaces (protocols/duck typing).
- Assert behavior (returned model, notifications sent) — not private call order.
