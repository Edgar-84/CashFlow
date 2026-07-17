# Test inventory

Living index of the test suite, grouped by what's under test. Every new test
file/case gets an entry here in the same commit that adds it — see
`tests/CLAUDE.md` → Documentation.

## Model tests (`test_models.py`)
Pydantic v2 contract tests — instantiate Base/Create/Update/Response and
check defaults/validation. No DB, no network.

| Test | Checks | Target |
|---|---|---|
| `test_user_models` | `UserCreate` defaults `role` to `MEMBER`; `UserUpdate` fields optional; `UserResponse` round-trips `account_id` | [`models/user.py`](../models/user.py) |
| `test_category_models` | Create/Update/Response basic field round-trip | [`models/category.py`](../models/category.py) |
| `test_tag_models` | Create/Update/Response basic field round-trip | [`models/tag.py`](../models/tag.py) |
| `test_expense_models_require_category_id` | `ExpenseCreate.category_id` is required (rejects a payload missing it); `ExpenseResponse` carries nested `tags` | [`models/expense.py`](../models/expense.py) |
| `test_budget_plan_models` | Defaults (`period="monthly"`, `notify_threshold=80`); `notify_threshold` rejects >100; `updated_at` required on `Response` | [`models/budget_plan.py`](../models/budget_plan.py) |
| `test_permission_models` | `PermissionCreate.own_only` defaults `True`; `PermissionUpdate` fields optional | [`models/permission.py`](../models/permission.py) |
| `test_enums_have_expected_members` | `Role`/`Resource`/`Action` enum membership matches spec | [`models/enums.py`](../models/enums.py) |
| `test_domain_errors_are_typed_and_distinct` | `NotFoundError`/`PermissionDeniedError`/`LimitExceededWarning` are distinct `DomainError` subclasses | [`models/errors.py`](../models/errors.py) |

## App / health tests (`test_health.py`)
Hermetic — FastAPI app via `ASGITransport`, DB pool mocked (see `conftest.py`'s
`client` fixture).

| Test | Checks | Target |
|---|---|---|
| `test_health_returns_ok` | `GET /health` → 200 `{"status": "ok"}` | [`main.py`](../main.py) |

## Repository tests
`@pytest.mark.integration` — real Postgres via the `db_conn` fixture
(per-test transaction, rolled back after).

### `test_user_repo.py` → [`repositories/user_repo.py`](../repositories/user_repo.py)
| Test | Checks |
|---|---|
| `test_create_get_update_delete` | Full CRUD round trip |
| `test_get_missing_returns_none` | `get()` on a missing id returns `None`, not an error |
| `test_delete_missing_returns_false` | `delete()` on a missing id returns `False` |
| `test_list_filters_by_account` | `list(account_id=...)` scopes results to one account |

### `test_category_repo.py` → [`repositories/category_repo.py`](../repositories/category_repo.py)
| Test | Checks |
|---|---|
| `test_create_get_update_delete` | Full CRUD round trip |
| `test_get_missing_returns_none` | `get()` on a missing id returns `None` |
| `test_delete_missing_returns_false` | `delete()` on a missing id returns `False` |
| `test_list_filters_by_account` | `list(account_id=...)` scopes results to one account |
| `test_duplicate_name_per_account_is_currently_allowed` | Documents that `docs/SCHEMA.sql` has no `UNIQUE(account_id, name)` — duplicate names within an account currently succeed (plan Decision log D19) |

### `test_tag_repo.py` → [`repositories/tag_repo.py`](../repositories/tag_repo.py)
| Test | Checks |
|---|---|
| `test_create_get_update_delete` | Full CRUD round trip |
| `test_get_missing_returns_none` | `get()` on a missing id returns `None` |
| `test_delete_missing_returns_false` | `delete()` on a missing id returns `False` |
| `test_list_filters_by_account` | `list(account_id=...)` scopes results to one account |
| `test_duplicate_name_per_account_is_currently_allowed` | Same unenforced-uniqueness behavior as categories (D19) |

### `test_expense_repo.py` → [`repositories/expense_repo.py`](../repositories/expense_repo.py)
| Test | Checks |
|---|---|
| `test_create_get_update_delete` | Full CRUD round trip |
| `test_get_missing_returns_none` | `get()` on a missing id returns `None` |
| `test_delete_missing_returns_false` | `delete()` on a missing id returns `False` |
| `test_create_with_tag_ids_attaches_tags` | `create(tag_ids=[...])` inserts `expense_tags` rows and returns them attached on the response |
| `test_update_tag_ids_replaces_existing_tags` | `update(tag_ids=[...])` replaces (not merges) the tag set |
| `test_delete_expense_cascades_expense_tags` | Deleting an expense removes its `expense_tags` rows (`ON DELETE CASCADE`) |
| `test_get_by_category_filters_by_account_and_category` | `get_by_category()` scopes to one account + category |
| `test_get_by_period_respects_month_boundaries_across_timezones` | `get_by_period()` bounds are instant-based (`>=`/`<`), correct regardless of the caller's UTC offset (D20) |
| `test_sum_by_category_month_known_sums` | `sum_by_category_month()` sums match hand-computed totals; result values are `int`, not `Decimal` |
| `test_get_by_period_scopes_by_account` | `get_by_period()` excludes another account's expenses |
| `test_sum_by_category_month_scopes_by_account` | `sum_by_category_month()` excludes another account's expenses |
| `test_create_with_duplicate_tag_ids_rolls_back_whole_expense` | A PK violation on duplicate `tag_ids` rolls back the whole `create()` — no partial expense left behind (D21) |

### `test_budget_plan_repo.py` → [`repositories/budget_plan_repo.py`](../repositories/budget_plan_repo.py)
| Test | Checks |
|---|---|
| `test_create_get_update_delete` | Full CRUD round trip |
| `test_duplicate_plan_raises_unique_violation` | `UNIQUE(category_id, account_id, period)` violation propagates as a raw `asyncpg.UniqueViolationError` — untranslated, unlike categories/tags which have no such constraint (D19) |
| `test_get_missing_returns_none` | `get()` on a missing id returns `None` |
| `test_delete_missing_returns_false` | `delete()` on a missing id returns `False` |
| `test_check_limit_no_plan_returns_none` | `check_limit()` returns `None` when no plan exists for the (account, category) pair |
| `test_check_limit_fill_percentage` | Parametrized: 0% spent, exactly at `notify_threshold` (80%), over 100% — fill percentage computed from `BIGINT` sums, no `Decimal`/float leak into the sum itself |
| `test_check_limit_zero_amount_plan_returns_none` | A plan with `amount=0` returns `None` instead of raising `ZeroDivisionError` |
| `test_check_limit_ignores_expenses_outside_period` | Expenses outside `[start, end)` are excluded from the fill percentage |
| `test_check_limit_scopes_by_account` | `check_limit()` excludes another account's expenses and plans |

### `test_permission_repo.py` → [`repositories/permission_repo.py`](../repositories/permission_repo.py)
| Test | Checks |
|---|---|
| `test_create_get_update_delete` | Full CRUD round trip |
| `test_get_missing_returns_none` | `get()` on a missing id returns `None` |
| `test_delete_missing_returns_false` | `delete()` on a missing id returns `False` |
| `test_duplicate_user_resource_raises_unique_violation` | `UNIQUE(user_id, resource)` violation propagates as a raw `asyncpg.UniqueViolationError` — untranslated, same gap as `budget_plans` (D23) |
| `test_get_by_user_and_resource_returns_row` | `get_by_user_and_resource()` returns the matching row |
| `test_get_by_user_and_resource_returns_none_when_no_row` | Returns `None` when no permission row exists for that (user, resource) |
| `test_get_by_user_and_resource_scopes_by_user` | Excludes another user's permission row for the same resource |

## API dependency tests (`test_deps.py`) → [`api/deps.py`](../api/deps.py)
Hermetic — repositories replaced with in-memory fakes via
`app.dependency_overrides`; HTTP cases go through `ASGITransport`. No DB.

| Test | Checks |
|---|---|
| `test_default_matrix` | Parametrized over all 48 cells (3 roles × 4 resources × 4 actions) of the default permission matrix — every cell written out explicitly, incl. `own_only` on member's expense update/delete |
| `test_override_row_widens_member_defaults` | A permission row can grant a member CRUD beyond the defaults (step 4) |
| `test_override_row_narrows_member_defaults` | A row replaces defaults entirely — member can lose default expense create |
| `test_override_row_own_only_flag_carries_into_decision` | Row's `own_only=True` lands on the `PermissionDecision` |
| `test_admin_ignores_override_row` | Step 2 precedes step 4 — an all-False row cannot restrict an admin |
| `test_viewer_cannot_be_overridden_to_write` | Step 3 precedes step 4 — an all-True row never grants a viewer writes; reads stay allowed |
| `test_viewer_read_can_be_restricted_by_row` | A row's `can_read=False` still applies to a viewer (step 3 only blocks writes) |
| `test_enforce_ownership_denies_foreign_record_when_own_only` | Step 6: `own_only` decision + foreign `owner_id` → 403 |
| `test_enforce_ownership_allows_own_record_when_own_only` | Step 6: own record passes |
| `test_enforce_ownership_allows_foreign_record_when_not_own_only` | Step 6: no `own_only` restriction → foreign record passes |
| `test_missing_internal_token_is_401` | No `X-Internal-Token` → 401 (D1) |
| `test_wrong_internal_token_is_401` | Wrong `X-Internal-Token` → 401 (D1) |
| `test_missing_tg_id_header_is_401` | No `X-Telegram-User-Id` → 401 |
| `test_malformed_tg_id_header_is_401` | Non-numeric `X-Telegram-User-Id` → 401 (not 422) |
| `test_unknown_tg_id_is_401` | tg_id not in `users` → 401 |
| `test_member_can_read_expenses` | Full dependency chain allows a member's default read, returns the resolved user |
| `test_viewer_create_is_403` | Full dependency chain denies a viewer's write with 403 |
| `test_checker_exposes_own_only_decision_on_request_state` | `PermissionChecker` stores the `PermissionDecision` on `request.state` for step-6 consumers (U2.4) |
| `test_checker_consults_permission_row` | `PermissionChecker` fetches the (user, resource) row and applies its flags (step 4) |
| `test_permission_checker_accepts_enum_and_string_forms` | `PermissionChecker("expenses", "create")` (route-pattern contract) equals the enum form |

## DB round-trip / integration smoke (`test_db_roundtrip.py`)
| Test | Checks | Target |
|---|---|---|
| `test_expense_round_trip` | A raw insert via `factories.make_expense` reads back with the same fields — proves the schema/fixtures/test-DB wiring itself, independent of any repository | [`docs/SCHEMA.sql`](../docs/SCHEMA.sql), [`factories.py`](factories.py) |

---

Sections not yet populated — add as the corresponding units land:
- Service tests (M2: users/categories/tags/expenses/budgets/statistics services)
- API/route tests (M2)
- Notification service tests (M3)
- Bot tests (M4: client, middlewares, handlers)
- e2e smoke (M5, `test.mark.integration`, excluded from default `verify.sh`)
