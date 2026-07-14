# models/ — Pydantic v2 schemas

<!-- Loaded only when Claude works inside models/. -->

## Purpose
Only Pydantic v2 schemas live here. No SQLAlchemy models, no DB session code,
no business logic. These schemas are the contract at API boundaries and
between layers (repository ↔ service ↔ route).

- Account: DEFERRED — no Pydantic model in V1. Account rows are seeded
  manually via docs/seed.sql and never cross the API boundary (only
  account_id: UUID appears in other schemas). Add AccountResponse when
  a service needs a typed account row; add AccountCreate in V2
  (self-registration / admin panel). Do NOT create models/account.py now.

## Four-schema pattern (every entity)
For an entity `Expense`, define:

- `ExpenseBase` — fields common to input and output (no ids, no timestamps).
- `ExpenseCreate(ExpenseBase)` — payload for POST; may add write-only fields (`tag_ids`).
- `ExpenseUpdate` — **all fields optional** (partial update); does NOT inherit from Base.
- `ExpenseResponse(ExpenseBase)` — adds `id`, foreign keys, timestamps, nested response
  models. `model_config = ConfigDict(from_attributes=True)`.

Example:
```python
class ExpenseBase(BaseModel):
    amount: int          # minor units (kopecks/cents) — NEVER float
    comment: str | None
    category_id: UUID

class ExpenseCreate(ExpenseBase):
    tag_ids: list[UUID] = []

class ExpenseUpdate(BaseModel):
    amount: int | None = None
    comment: str | None = None
    category_id: UUID | None = None
    tag_ids: list[UUID] | None = None

class ExpenseResponse(ExpenseBase):
    id: UUID
    user_id: UUID
    account_id: UUID
    created_at: datetime
    updated_at: datetime
    tags: list[TagResponse] = []
    model_config = ConfigDict(from_attributes=True)
```

## Conventions
- Money fields (`amount`, budget `amount`) are `int` and documented as minor units.
- IDs are `UUID`, timestamps are `datetime` (timezone-aware).
- Use `str | None = None` style (PEP 604), not `Optional[...]`.
- Enum-like string fields (e.g. `role`, `resource`, `period`) — prefer `Literal[...]`
  or a `StrEnum` in the same module.
- One module per entity: `user.py`, `expense.py`, `category.py`, `tag.py`,
  `budget_plan.py`, `permission.py`.
- `updated_at` exists only on `ExpenseResponse` and `BudgetPlanResponse` (the
  only tables with a `set_updated_at()` DB trigger — see `docs/SCHEMA.sql`).
  It never appears on the corresponding `Create`/`Update` schemas: the DB
  trigger is the single source of truth, application code must never set it.

## What does NOT belong here
- SQL queries — `repositories/`.
- Notification/business logic — `services/`.
- Route decorators or `Depends()` — `api/`.
