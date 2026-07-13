# api/ — FastAPI routes, auth, permissions

<!-- Loaded only when Claude works inside api/. -->

## Purpose
HTTP surface. Routes are thin: parse input → call service → return response
model. Business logic and DB access are forbidden here.

## Structure
- `deps.py` — `get_current_user`, `PermissionChecker`, DB pool / service factories.
- One router module per resource: `expenses.py`, `categories.py`, `tags.py`,
  `budgets.py`, `statistics.py`, `users.py`.

## Auth (bot → backend contract)
- Bot sends `X-Telegram-User-Id: <tg_id>` on every request.
- `get_current_user` reads that header, resolves it via `user_repo` to a `User`
  (with `account_id`), and injects it into the route.
- **The bot never sends `account_id` or user UUIDs.** Backend derives everything
  from `tg_id`. Trusting client-supplied identifiers is a bug.

## Route pattern
```python
@router.post("/expenses", response_model=ExpenseResponse)
async def create_expense(
    data: ExpenseCreate,
    user: User = Depends(PermissionChecker("expenses", "create")),
    service: ExpenseService = Depends(),
):
    return await service.create(data, user)
```

## Permissions — two-level model
Level 1 (**role**): coarse-grained system access.
Level 2 (**permission row**): per-resource CRUD flags that override role defaults.

### Roles
| Role     | Meaning |
|----------|---------|
| `admin`  | Full access. Can manage users and permissions. |
| `member` | Default. CRUD on own expenses; read-only on categories/tags/plans. Overridable via `permissions`. |
| `viewer` | Read-only across all resources. Cannot be overridden to write. |

### Default matrix
| Resource      | admin | member (default)                | viewer |
|---------------|-------|---------------------------------|--------|
| expenses      | CRUD  | C · R · U(own) · D(own)         | R      |
| categories    | CRUD  | R                               | R      |
| tags          | CRUD  | R                               | R      |
| budget_plans  | CRUD  | R                               | R      |
| users         | CRUD  | —                               | —      |
| permissions   | CRUD  | —                               | —      |

### PermissionChecker enforcement order
1. User authenticated and linked to an account? No → **401**.
2. Role = `admin` → allow.
3. Role = `viewer` and action ≠ `read` → **403**.
4. Row exists in `permissions` for (user, resource) → use its flags.
5. No row → apply role defaults from the matrix above.
6. `own_only = true` and target record belongs to another user → **403**.

## Adding users manually (no self-registration yet)
```sql
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
- Never `await asyncpg` here. Never import from `repositories/` here.
- Domain exceptions from services map to HTTP status via router error handlers
  (or a global handler in `main.py`).
