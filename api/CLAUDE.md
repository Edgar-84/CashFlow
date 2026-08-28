# api/ — FastAPI routes, auth, permissions

<!-- Loaded only when Claude works inside api/. -->

## Purpose
HTTP surface. Routes are thin: parse input → call service → return response
model. Business logic and DB access are forbidden here.

## Structure
- `deps.py` — `get_current_user`, `PermissionChecker`, `require_admin`,
  `require_system_admin`, DB pool / service factories.
- One router module per resource: `expenses.py`, `categories.py`, `tags.py`,
  `budgets.py`, `statistics.py`, `users.py`.
- `admin.py` — the system-admin panel's cross-account surface (D711),
  gated by `require_system_admin`. See "Choosing an auth dependency" below.

## Auth (bot → backend contract)
- Bot sends `X-Telegram-User-Id: <tg_id>` + `X-Internal-Token` on every request.
- `get_current_user` accepts a second credential, `X-Telegram-Init-Data` (the
  Mini App, U0.1) — validated via `validate_init_data`, tg_id derived from the
  signed payload. If present, it takes priority; otherwise the header pair
  above resolves the caller, unchanged.
- Either path resolves via `user_repo` to a `User` (with `account_id`) and
  injects it into the route.
- **Neither client ever sends `account_id` or user UUIDs.** Backend derives
  everything from `tg_id`. Trusting client-supplied identifiers is a bug.

## Route pattern
```python
@router.post("/expenses", response_model=ExpenseResponse)
async def create_expense(
    data: ExpenseCreate,
    user: User = Depends(PermissionChecker(Resource.EXPENSES, Action.CREATE)),
    service: ExpenseService = Depends(),
):
    return await service.create(data, user)
```
Prefer the `Resource`/`Action` enum members (`models/enums.py`) over raw strings
at call sites — `PermissionChecker` accepts both (`Resource | str`, `Action | str`,
D26), but the enum form gets typo-checking from mypy instead of a runtime
`ValueError`. String literals still work and existing tests cover both forms;
this is a style default for new call sites, not a contract change.

## Choosing an auth dependency
Three tiers, pick the narrowest that fits the route:

| Dependency | Who gets through | Use for |
|---|---|---|
| `Depends(get_current_user)` | Any authenticated, unblocked user (any row in `users`, any role) | Endpoints with no role/resource restriction — auth only |
| `Depends(PermissionChecker(resource, action))` | Role defaults + per-user `permissions` override, per the matrix below | The 4 data resources: `expenses`, `categories`, `tags`, `budget_plans` |
| `Depends(require_admin)` | `role in (admin, system_admin)`, 403 otherwise | `users`, `permissions` — no override-row/own_only concept, not in the `Resource` enum, so `PermissionChecker` doesn't apply to them |
| `Depends(require_system_admin)` | `role == system_admin` only, 403 otherwise (even for a plain `admin`) | `admin.py`'s cross-account routes — the one surface not scoped to the caller's own `account_id` (D711) |

"Authenticated" always means: valid `X-Internal-Token` **and** an `X-Telegram-User-Id`
that resolves to a row in `users`, **or** a validly signed `X-Telegram-Init-Data`
that resolves the same way — there is no public/unauthenticated route.

`get_current_user` also gates on **block status** (D713), so every dependency
above inherits it: a blocked user, or a user whose account is blocked, gets a
**403** with a distinguishable detail — never the 401 an unknown/malformed
credential gets. Checked once, in one place, for both credential paths.

## Permissions — two-level model
Level 1 (**role**): coarse-grained system access.
Level 2 (**permission row**): per-resource CRUD flags that override role defaults.

### Roles
| Role           | Meaning |
|----------------|---------|
| `system_admin` | Cross-account. Behaves as `admin` inside its own account (D712) — this matrix has no cross-account concept; that lives entirely in `api/admin.py` (D711, starting at U4.3). |
| `admin`        | Full access. Can manage users and permissions. |
| `member`       | Default. CRUD on own expenses; read-only on categories/tags/plans. Overridable via `permissions`. |
| `viewer`       | Read-only across all resources. Cannot be overridden to write. |

### Default matrix
| Resource      | system_admin | admin | member (default)                | viewer |
|---------------|--------------|-------|---------------------------------|--------|
| expenses      | CRUD         | CRUD  | C · R · U(own) · D(own)         | R      |
| categories    | CRUD         | CRUD  | R                               | R      |
| tags          | CRUD         | CRUD  | R                               | R      |
| budget_plans  | CRUD         | CRUD  | R                               | R      |
| users         | CRUD         | CRUD  | —                               | —      |
| permissions   | CRUD         | CRUD  | —                               | —      |

`users`/`permissions` rows are enforced by `require_admin`, not `PermissionChecker`
— see "Choosing an auth dependency" above.

### PermissionChecker enforcement order
1. User authenticated, linked to an account, and neither blocked (D713)? No → **401** (not authenticated) or **403** (blocked — see "Choosing an auth dependency" above).
2. Role = `admin` or `system_admin` → allow.
3. Role = `viewer` and action ≠ `read` → **403**.
4. Row exists in `permissions` for (user, resource) → use its flags.
5. No row → apply role defaults from the matrix above.
6. `own_only = true` and target record belongs to another user → **403**.

## Adding users manually (no self-registration yet)
```sql
-- Create an account (once per family), choosing its currency (D211) from
-- models.enums.Currency: USD | EUR | GBP | PLN | UAH | CZK | CHF | SEK |
-- NOK | DKK | JPY | CNY | CAD | AUD | TRY. Omit the column to get 'USD'.
INSERT INTO accounts (name, currency) VALUES ('Smith Family', 'PLN') RETURNING id;

INSERT INTO users (tg_id, name, role, account_id)
VALUES (123456789, 'Wife', 'member', '<account-uuid>');

-- Optional override: full expense CRUD on any record, not just own
INSERT INTO permissions (user_id, resource, can_create, can_read, can_update, can_delete, own_only)
VALUES ('<user-uuid>', 'expenses', true, true, true, false, false);
```

When self-registration lands (V2), only the caller of these INSERTs changes —
the permission logic stays identical.

## Rules
- Routes return Pydantic response models — never raw dicts.
- Never `await asyncpg` here. Never import from `repositories/` in router
  modules — `deps.py` is the composition root and the one exception (it holds
  the repo/service factories, per Structure above).
- Domain exceptions from services map to HTTP status via router error handlers
  (or a global handler in `main.py`).
