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
| `test_expense_models_require_category_id` | `ExpenseCreate.category_id` is required (rejects a payload missing it); `ExpenseResponse` carries nested `tags`; `user_name` defaults `None` and round-trips when supplied | [`models/expense.py`](../models/expense.py) |
| `test_budget_plan_models` | Defaults (`period="monthly"`, `notify_threshold=80`); `notify_threshold` rejects >100; `amount<=0` (zero and negative) rejected on `Create`; `updated_at` required on `Response` | [`models/budget_plan.py`](../models/budget_plan.py) |
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

## Service tests (`test_user_service.py`) → [`services/user_service.py`](../services/user_service.py)
Hermetic — `UserRepositoryProtocol` replaced with an in-memory `FakeUserRepo`. No DB.

| Test | Checks |
|---|---|
| `test_list_scopes_by_account` | `list()` excludes another account's users |
| `test_get_returns_user_in_account` | `get()` returns a user belonging to the given account |
| `test_get_missing_raises_not_found` | `get()` on an unknown id raises `NotFoundError` |
| `test_get_foreign_account_raises_not_found` | `get()` on a user from another account raises `NotFoundError` (no cross-account leak) |
| `test_create_forces_account_id_from_caller` | `create()` ignores `UserCreate.account_id` and uses the caller's `account_id` instead (root CLAUDE.md: never trust client-supplied UUIDs) |
| `test_create_duplicate_tg_id_raises_conflict` | A duplicate `tg_id` (`asyncpg.UniqueViolationError` from the repo) is translated to `ConflictError` |
| `test_update_changes_fields` | `update()` applies a partial `UserUpdate` |
| `test_update_explicit_null_fields_are_ignored_not_nulled` | An explicit `{"name": null, "role": null}` is ignored, not sent to the repo as `SET ... = NULL` against a `NOT NULL` column (review fix) |
| `test_update_mixes_real_value_with_ignored_null` | A real value alongside an explicit null updates only the real field |
| `test_update_missing_raises_not_found` | `update()` on an unknown id raises `NotFoundError` |
| `test_delete_removes_user` | `delete()` removes the row via the repo |
| `test_delete_missing_raises_not_found` | `delete()` on an unknown id raises `NotFoundError` |

## Service tests (`test_category_service.py`) → [`services/category_service.py`](../services/category_service.py)
Hermetic — `CategoryRepositoryProtocol` replaced with an in-memory `FakeCategoryRepo`. No DB.

| Test | Checks |
|---|---|
| `test_list_scopes_by_account` | `list()` excludes another account's categories |
| `test_get_returns_category_in_account` | `get()` returns a category belonging to the given account |
| `test_get_missing_raises_not_found` | `get()` on an unknown id raises `NotFoundError` |
| `test_get_foreign_account_raises_not_found` | `get()` on a category from another account raises `NotFoundError` |
| `test_create_forces_account_id_from_caller` | `create()` stamps the caller's `account_id` |
| `test_update_changes_fields` | `update()` applies a partial `CategoryUpdate` |
| `test_update_explicit_null_is_ignored_not_nulled` | An explicit `{"name": null}` is ignored, not sent to the repo as `SET name = NULL` (same D30 precedent as users) |
| `test_update_missing_raises_not_found` | `update()` on an unknown id raises `NotFoundError` |
| `test_delete_removes_category` | `delete()` removes the row via the repo |
| `test_delete_missing_raises_not_found` | `delete()` on an unknown id raises `NotFoundError` |
| `test_delete_referenced_category_raises_conflict` | A `RESTRICT`-violating delete (`asyncpg.ForeignKeyViolationError` from the repo) is translated to `ConflictError` (plan Decision log D5) |

## Service tests (`test_tag_service.py`) → [`services/tag_service.py`](../services/tag_service.py)
Hermetic — `TagRepositoryProtocol` replaced with an in-memory `FakeTagRepo`. No DB.

| Test | Checks |
|---|---|
| `test_list_scopes_by_account` | `list()` excludes another account's tags |
| `test_get_returns_tag_in_account` | `get()` returns a tag belonging to the given account |
| `test_get_missing_raises_not_found` | `get()` on an unknown id raises `NotFoundError` |
| `test_get_foreign_account_raises_not_found` | `get()` on a tag from another account raises `NotFoundError` |
| `test_create_forces_account_id_from_caller` | `create()` stamps the caller's `account_id` |
| `test_update_changes_fields` | `update()` applies a partial `TagUpdate` |
| `test_update_explicit_null_is_ignored_not_nulled` | An explicit `{"name": null}` is ignored, same D30 precedent |
| `test_update_missing_raises_not_found` | `update()` on an unknown id raises `NotFoundError` |
| `test_delete_removes_tag` | `delete()` removes the row via the repo |
| `test_delete_missing_raises_not_found` | `delete()` on an unknown id raises `NotFoundError` |

## Service tests (`test_period.py`) → [`services/period.py`](../services/period.py)
Pure logic, no DB. `month_bounds()` is the single shared helper replacing the
three previously-duplicated `_current_month_bounds` (plan Decision log D107).

| Test | Checks |
|---|---|
| `test_month_bounds_default_utc` | Parametrized: mid-year `now` and a December→January year rollover, default `tz="UTC"` |
| `test_month_bounds_family_tz_evening_of_31st_rolls_to_next_month` | A UTC instant still on the 31st already reads as the 1st of the next month in `Europe/Moscow` (UTC+3) — the returned bounds follow the family timezone, not raw UTC |
| `test_month_bounds_naive_now_rejected` | A naive `now` raises `ValueError` instead of silently assuming a timezone |

## Service tests (`test_expense_service.py`) → [`services/expense_service.py`](../services/expense_service.py)
Hermetic — `ExpenseRepositoryProtocol` replaced with an in-memory `FakeExpenseRepo`. No DB.
The service has no notion of permissions/`own_only` — that's enforced by the route
(see `test_expenses_api.py` below).

| Test | Checks |
|---|---|
| `test_list_scopes_by_account` | `list()` excludes another account's expenses |
| `test_get_returns_expense_in_account` | `get()` returns an expense belonging to the given account |
| `test_get_missing_raises_not_found` | `get()` on an unknown id raises `NotFoundError` |
| `test_get_foreign_account_raises_not_found` | `get()` on an expense from another account raises `NotFoundError` |
| `test_create_sets_account_and_user_id_from_caller` | `create()` stamps the caller's `account_id`/`user_id`, never client-supplied |
| `test_create_attaches_tags` | `create()` with `tag_ids` returns the expense with tags attached |
| `test_update_changes_amount` | `update()` applies a partial `ExpenseUpdate` |
| `test_update_explicit_null_amount_is_ignored_not_nulled` | An explicit `{"amount": null}` is ignored — `amount` is `NOT NULL` (D30/D32 pattern) |
| `test_update_explicit_null_category_id_is_ignored_not_nulled` | Same, for `category_id` (`NOT NULL`) |
| `test_update_explicit_null_comment_clears_it` | An explicit `{"comment": null}` DOES clear it — `comment` is nullable (`docs/SCHEMA.sql`), unlike `amount`/`category_id` |
| `test_update_tag_ids_replaces_tags` | `update()` with `tag_ids` replaces the attached tags |
| `test_update_tag_ids_empty_list_clears_tags` | `update()` with `tag_ids=[]` clears all tags |
| `test_update_missing_raises_not_found` | `update()` on an unknown id raises `NotFoundError` |
| `test_update_foreign_account_raises_not_found` | `update()` on an expense from another account raises `NotFoundError` |
| `test_delete_removes_expense` | `delete()` removes the row via the repo |
| `test_delete_missing_raises_not_found` | `delete()` on an unknown id raises `NotFoundError` |
| `test_delete_foreign_account_raises_not_found` | `delete()` on an expense from another account raises `NotFoundError` |
| `test_create_notifies_when_threshold_crossed` | U3.1 notification-flow invariant: `fill_pct >= notify_threshold` → `notification_service.send(user, category, fill_pct)` called exactly once with the right args |
| `test_create_notifies_exactly_once_at_threshold` | `fill_pct == notify_threshold` (boundary) still notifies (`>=`, not `>`) |
| `test_create_does_not_notify_below_threshold` | `fill_pct < notify_threshold` → no notification |
| `test_create_does_not_notify_when_no_budget_plan` | `check_limit()` returns `None` (no plan for the category) → no notification, no crash |
| `test_create_still_succeeds_when_notification_send_raises` | `notification_service.send()` raising is swallowed — expense creation still returns the created expense (root CLAUDE.md D3, second line of defense beyond `NotificationService`'s own try/except) |
| `test_create_still_succeeds_when_budget_check_raises` | A `budget_plan_repo` error (DB hiccup) during the notification check doesn't fail expense creation |
| `test_create_passes_account_scoped_bounds_to_check_limit` | `check_limit()` is called with the caller's `account_id`/the expense's `category_id` |
| `test_create_foreign_category_raises_not_found` | U1.1: `create()` with a `category_id` belonging to another account → `NotFoundError` (404, not 403 — closes MVP D33/D23) |
| `test_create_nonexistent_category_raises_not_found` | `create()` with an unknown `category_id` → `NotFoundError` |
| `test_create_foreign_tag_raises_not_found` | `create()` with a `tag_ids` entry belonging to another account → `NotFoundError` |
| `test_create_mixed_own_and_foreign_tags_raises_not_found` | `create()` with one own + one foreign tag → `NotFoundError` (no partial success) |
| `test_create_own_category_and_tags_pass` | `create()` with a `category_id`/`tag_ids` all belonging to the caller's account succeeds |
| `test_update_foreign_category_raises_not_found` | `update()` with a foreign `category_id` → `NotFoundError` |
| `test_update_foreign_tag_raises_not_found` | `update()` with a foreign `tag_ids` entry → `NotFoundError` |
| `test_update_own_category_and_tags_pass` | `update()` with an own `category_id`/`tag_ids` succeeds |

## Service tests (`test_notification_service.py`) → [`services/notification_service.py`](../services/notification_service.py)
Hermetic — `httpx.AsyncClient` given a fake `httpx.MockTransport`. No real network (U3.1 AC).

| Test | Checks |
|---|---|
| `test_send_posts_to_telegram_bot_api_with_chat_id_and_text` | `send()` POSTs to `/bot{token}/sendMessage` with `chat_id=user.tg_id` and a text body containing the category name and fill percentage |
| `test_send_swallows_connection_error_without_raising` | A transport-level error (e.g. `httpx.ConnectError`) is caught, not raised (D3) |
| `test_send_swallows_http_status_error_without_raising` | A non-2xx response (`raise_for_status()`) is caught, not raised (D3) |
| `test_send_logs_on_failure` | A failed send logs an `ERROR`-level record |
| `test_send_on_http_status_error_never_logs_the_bot_token` | Regression: `httpx.HTTPStatusError`'s message embeds the full request URL (bot token included) — the log record must never contain the token (review fix) |

## Service tests (`test_budget_service.py`) → [`services/budget_service.py`](../services/budget_service.py)
Hermetic — `BudgetPlanRepositoryProtocol`/`ExpenseSumRepositoryProtocol` replaced
with in-memory fakes. No DB. `calculate_progress` is pure (no fakes needed).

| Test | Checks |
|---|---|
| `test_calculate_progress_parametrized` | Parametrized: 0% spent, exactly at `notify_threshold`, mid-range, >100%, exactly 100% — `fill_pct`/`is_over_threshold`/`is_exceeded`/`remaining` (asserted `int`, not `Decimal`/float) |
| `test_calculate_progress_zero_limit_returns_none_pct` | `limit=0` → `fill_pct=None`, not `ZeroDivisionError` (mirrors `check_limit`'s D23 guard) |
| `test_calculate_progress_negative_limit_returns_none_pct` | Same guard for a negative `limit` |
| `test_list_scopes_by_account` | `list()` excludes another account's plans |
| `test_get_returns_plan_in_account` | `get()` returns a plan belonging to the given account |
| `test_get_missing_raises_not_found` | `get()` on an unknown id raises `NotFoundError` |
| `test_get_foreign_account_raises_not_found` | `get()` on a plan from another account raises `NotFoundError` |
| `test_create_forces_account_id_from_caller` | `create()` stamps the caller's `account_id` |
| `test_create_duplicate_raises_conflict` | `UNIQUE(category_id, account_id, period)` violation (`asyncpg.UniqueViolationError` from the repo) is translated to `ConflictError` (closes the D23/D24-flagged gap) |
| `test_update_changes_fields` | `update()` applies a partial `BudgetPlanUpdate` |
| `test_update_explicit_null_amount_is_ignored_not_nulled` | An explicit `{"amount": null}` is ignored, same D30/D32 precedent (`amount`/`period`/`notify_threshold` all `NOT NULL`) |
| `test_update_explicit_null_period_is_ignored_not_nulled` | Same, for `period` |
| `test_update_explicit_null_notify_threshold_is_ignored_not_nulled` | Same, for `notify_threshold` |
| `test_update_missing_raises_not_found` | `update()` on an unknown id raises `NotFoundError` |
| `test_delete_removes_plan` | `delete()` removes the row via the repo |
| `test_delete_missing_raises_not_found` | `delete()` on an unknown id raises `NotFoundError` |
| `test_get_progress_combines_plan_and_spent` | `get_progress()` combines `budget_plan_repo.get()` + `expense_repo.sum_by_category_month()` into a `BudgetProgress` with real `int` spent/remaining; also asserts the exact `[start, end)` month bounds passed to the repo match `services.period.month_bounds()` (review fix — the fake previously ignored these args) |
| `test_get_progress_no_expenses_this_month_is_zero_spent` | No matching sum → `spent=0`, not a `KeyError` |
| `test_get_progress_missing_plan_raises_not_found` | `get_progress()` on an unknown plan id raises `NotFoundError` |
| `test_create_foreign_category_raises_not_found` | U1.1: `create()` with a `category_id` belonging to another account → `NotFoundError` (404, not 403 — closes MVP D33/D23); `BudgetPlanUpdate` has no `category_id` field, so `update()` has nothing to validate here |
| `test_create_nonexistent_category_raises_not_found` | `create()` with an unknown `category_id` → `NotFoundError` |
| `test_create_own_category_passes` | `create()` with a `category_id` belonging to the caller's account succeeds |

## API/route tests (`test_expenses_api.py`) → [`api/expenses.py`](../api/expenses.py)
Hermetic — the real app with `ExpenseRepository`/`UserRepository`/`PermissionRepository`
replaced by in-memory fakes via `app.dependency_overrides`. No DB. First resource with
real `own_only` semantics: the route fetches the record, then calls `api.deps.enforce_ownership`
with `request.state.permission_decision` before mutating (U2.1's step 6, wired here for the
first time — plan Decision log handoff note).

| Test | Checks |
|---|---|
| `test_list_expenses_as_member_returns_account_expenses` | Member `GET /expenses` returns ALL account expenses, including other users' (default matrix: read is unqualified, not `own_only`) |
| `test_list_expenses_with_own_only_override_filters_to_own` | An override permission row with `own_only=True` on `read` filters `GET /expenses` down to the caller's own expenses (review fix — the default matrix never sets `own_only` on read, but an override row can) |
| `test_get_expense_as_viewer` | Viewer `GET /expenses/{id}` returns the expense |
| `test_get_missing_expense_is_404` | Unknown id → 404 |
| `test_create_expense_as_member` | Member `POST /expenses` → 201; response `account_id`/`user_id` are server-derived |
| `test_create_expense_with_tags` | `POST /expenses` with `tag_ids` returns the expense with tags attached |
| `test_create_expense_as_viewer_is_403` | Viewer `POST /expenses` → 403 |
| `test_create_expense_triggers_notification_when_threshold_crossed` | End-to-end U3.1 wiring through the real `get_expense_service` factory: crossing the threshold on `POST /expenses` calls the (faked) `notification_service.send()` exactly once |
| `test_update_own_expense_as_member` | Member `PATCH /expenses/{id}` on their own expense → 200 |
| `test_update_other_members_expense_is_403` | Member `PATCH /expenses/{id}` on another user's expense → 403 (`own_only`) |
| `test_update_any_expense_as_admin` | Admin `PATCH /expenses/{id}` on another user's expense → 200 (admin is never `own_only`-restricted) |
| `test_update_expense_tags_replaces_them` | `PATCH /expenses/{id}` with `tag_ids` replaces attached tags |
| `test_delete_own_expense_as_member` | Member `DELETE /expenses/{id}` on their own expense → 204, row removed |
| `test_delete_other_members_expense_is_403` | Member `DELETE /expenses/{id}` on another user's expense → 403 (`own_only`) |
| `test_delete_expense_as_viewer_is_403` | Viewer `DELETE /expenses/{id}` → 403 |
| `test_create_expense_with_foreign_category_is_404` | U1.1 end-to-end: `POST /expenses` with a `category_id` the fake `category_repo` doesn't have → 404 |
| `test_create_expense_with_foreign_tag_is_404` | `POST /expenses` with a `tag_ids` entry the fake `tag_repo` doesn't have → 404 |
| `test_update_expense_with_foreign_category_is_404` | `PATCH /expenses/{id}` with an unknown `category_id` → 404 |

## API/route tests (`test_categories_api.py`) → [`api/categories.py`](../api/categories.py)
Hermetic — the real app with `CategoryRepository`/`UserRepository`/`PermissionRepository`
replaced by in-memory fakes via `app.dependency_overrides`. No DB.

| Test | Checks |
|---|---|
| `test_list_categories_as_member_returns_account_categories` | Member `GET /categories` returns the account's categories (default matrix: read-only) |
| `test_get_category_as_viewer` | Viewer `GET /categories/{id}` returns the category |
| `test_get_missing_category_is_404` | Unknown id → 404 |
| `test_create_category_as_admin` | Admin `POST /categories` → 201 |
| `test_create_category_as_member_is_403` | Member `POST /categories` → 403 (default matrix: no create) |
| `test_create_category_as_viewer_is_403` | Viewer `POST /categories` → 403 |
| `test_update_category_as_admin` | Admin `PATCH /categories/{id}` applies a partial update |
| `test_update_category_as_member_is_403` | Member `PATCH /categories/{id}` → 403 |
| `test_delete_category_as_admin` | Admin `DELETE /categories/{id}` → 204, row removed |
| `test_delete_category_as_member_is_403` | Member `DELETE /categories/{id}` → 403 |
| `test_delete_referenced_category_as_admin_is_409` | `RESTRICT`-violating delete → 409 (`ConflictError` mapped by `main.py`'s handler) |

## API/route tests (`test_tags_api.py`) → [`api/tags.py`](../api/tags.py)
Hermetic — the real app with `TagRepository`/`UserRepository`/`PermissionRepository`
replaced by in-memory fakes via `app.dependency_overrides`. No DB.

| Test | Checks |
|---|---|
| `test_list_tags_as_member_returns_account_tags` | Member `GET /tags` returns the account's tags (default matrix: read-only) |
| `test_get_tag_as_viewer` | Viewer `GET /tags/{id}` returns the tag |
| `test_get_missing_tag_is_404` | Unknown id → 404 |
| `test_create_tag_as_admin` | Admin `POST /tags` → 201 |
| `test_create_tag_as_member_is_403` | Member `POST /tags` → 403 |
| `test_create_tag_as_viewer_is_403` | Viewer `POST /tags` → 403 |
| `test_update_tag_as_admin` | Admin `PATCH /tags/{id}` applies a partial update |
| `test_update_tag_as_member_is_403` | Member `PATCH /tags/{id}` → 403 |
| `test_delete_tag_as_admin` | Admin `DELETE /tags/{id}` → 204, row removed |
| `test_delete_tag_as_member_is_403` | Member `DELETE /tags/{id}` → 403 |

## API/route tests (`test_budgets_api.py`) → [`api/budgets.py`](../api/budgets.py)
Hermetic — the real app with `BudgetPlanRepository`/`ExpenseRepository`/`UserRepository`/
`PermissionRepository` replaced by in-memory fakes via `app.dependency_overrides`. No DB.

| Test | Checks |
|---|---|
| `test_list_budget_plans_as_member` | Member `GET /budgets` returns the account's plans (default matrix: read-only) |
| `test_get_budget_plan_as_viewer` | Viewer `GET /budgets/{id}` returns the plan |
| `test_get_missing_budget_plan_is_404` | Unknown id → 404 |
| `test_get_budget_plan_progress` | `GET /budgets/{id}/progress` returns `spent`/`amount`/`remaining`/`fill_pct`/`is_over_threshold` computed from the fake `expense_repo`'s monthly sums |
| `test_create_budget_plan_as_admin` | Admin `POST /budgets` → 201 |
| `test_create_budget_plan_as_member_is_403` | Member `POST /budgets` → 403 (default matrix: no create) |
| `test_create_duplicate_budget_plan_as_admin_is_409` | Duplicate `(category_id, account_id, period)` → 409 (`ConflictError` mapped by `main.py`'s handler) |
| `test_update_budget_plan_as_admin` | Admin `PATCH /budgets/{id}` applies a partial update |
| `test_update_budget_plan_as_member_is_403` | Member `PATCH /budgets/{id}` → 403 |
| `test_delete_budget_plan_as_admin` | Admin `DELETE /budgets/{id}` → 204, row removed |
| `test_delete_budget_plan_as_member_is_403` | Member `DELETE /budgets/{id}` → 403 |
| `test_create_budget_plan_with_foreign_category_is_404` | U1.1 end-to-end: `POST /budgets` with a `category_id` the fake `category_repo` doesn't have → 404 |

## API/route tests (`test_users_api.py`) → [`api/users.py`](../api/users.py)
Hermetic — the real app (`client`/`app` fixtures) with `UserRepository` replaced by
`TgLookupFakeUserRepo` via `app.dependency_overrides`. No DB.

| Test | Checks |
|---|---|
| `test_list_users_as_admin_returns_account_users` | Admin `GET /users` returns the account's users |
| `test_list_users_as_member_is_403` | Member `GET /users` → 403 (`require_admin` gate, D27) |
| `test_list_users_as_viewer_is_403` | Viewer `GET /users` → 403 |
| `test_get_user_as_admin` | Admin `GET /users/{id}` returns the user |
| `test_get_missing_user_as_admin_is_404` | Unknown id → 404 (`NotFoundError` mapped by `main.py`'s handler) |
| `test_get_user_as_member_is_403` | Member `GET /users/{id}` → 403 |
| `test_create_user_as_admin` | `POST /users` → 201; response `account_id` is the admin's own, not the (spoofed) body value |
| `test_create_user_duplicate_tg_id_is_409` | Duplicate `tg_id` → 409 (`ConflictError` mapped by `main.py`'s handler) |
| `test_create_user_as_member_is_403` | Member `POST /users` → 403 |
| `test_update_user_as_admin` | `PATCH /users/{id}` applies a partial update |
| `test_update_user_explicit_null_is_ignored_not_500` | `PATCH` with `{"name": null}` returns 200 unchanged, not a 500 from an uncaught `NotNullViolationError` (review fix) |
| `test_update_user_as_viewer_is_403` | Viewer `PATCH /users/{id}` → 403 |
| `test_delete_user_as_admin` | `DELETE /users/{id}` → 204, row removed |
| `test_delete_user_as_member_is_403` | Member `DELETE /users/{id}` → 403 |

## Service tests (`test_statistics_service.py`) → [`services/statistics_service.py`](../services/statistics_service.py)
Hermetic — `ExpensePeriodRepositoryProtocol` replaced with an in-memory `FakeExpensePeriodRepo`. No DB.

| Test | Checks |
|---|---|
| `test_by_period_sums_current_month_expenses` | `by_period()` sums all expenses in the current month; `total` is `int` |
| `test_by_period_excludes_expenses_outside_current_month` | Expenses outside `[start, end)` are excluded |
| `test_by_period_no_expenses_is_zero` | No expenses → `total=0`, not an error |
| `test_by_period_own_user_id_filters_to_own_expenses` | `user_id` filter restricts the sum to that user's expenses |
| `test_by_period_scopes_by_account` | Excludes another account's expenses |
| `test_by_period_custom_window_overrides_current_month` | Explicit `start`/`end` replace the default current-month window |
| `test_by_period_last_month_window` | Explicit `start`/`end` covering the prior month works the same as any custom window |
| `test_by_period_default_uses_family_tz_not_utc` | No `start`/`end` → default bounds computed from the constructor's `family_tz`, not hardcoded UTC (U1.2 wiring) |
| `test_by_period_category_filter` | `category_id` restricts the sum to that category, applied before aggregation |
| `test_by_period_tag_filter` | `tag_id` restricts the sum to expenses carrying that tag, applied before aggregation |
| `test_by_category_groups_totals_by_category` | `by_category()` groups totals per `category_id`; each `total` is `int` |
| `test_by_category_own_user_id_filters_to_own_expenses` | `user_id` filter applies before aggregation |
| `test_by_tag_groups_totals_by_tag` | `by_tag()` groups totals per `tag_id`, incl. an expense tagged with two tags contributing to both |
| `test_by_tag_expense_with_no_tags_is_excluded` | An untagged expense contributes to no `TagTotal` row |
| `test_by_tag_own_user_id_filters_to_own_expenses` | `user_id` filter applies before aggregation |

## API/route tests (`test_statistics_api.py`) → [`api/statistics.py`](../api/statistics.py)
Hermetic — the real app with `ExpenseRepository`/`UserRepository`/`PermissionRepository`
replaced by in-memory fakes via `app.dependency_overrides`. No DB. `PermissionChecker(Resource.EXPENSES,
Action.READ)`-gated — statistics has no `Resource` enum entry of its own (plan Decision log D35).

| Test | Checks |
|---|---|
| `test_by_period_as_member` | Member `GET /statistics/by-period` returns the account's total |
| `test_by_period_as_viewer` | Viewer `GET /statistics/by-period` returns the total |
| `test_by_period_default_matrix_is_not_own_only` | Default matrix: expense read is unqualified — a member's total includes another user's expenses |
| `test_by_period_own_only_override_filters_to_own` | An override permission row with `own_only=True` on read restricts the aggregate to the caller's own expenses (D35) |
| `test_by_category_as_member` | `GET /statistics/by-category` groups totals by category |
| `test_by_tag_as_member` | `GET /statistics/by-tag` groups totals by tag |
| `test_statistics_without_auth_is_401` | Missing auth headers → 401 |
| `test_by_period_custom_window` | `start`/`end` query params (ISO-8601) restrict the aggregate to that window |
| `test_by_period_category_and_tag_filter` | `category_id`/`tag_id` query params on `by-period` restrict the aggregate |
| `test_by_period_start_after_end_is_422` | `start >= end` → 422 |

## DB round-trip / integration smoke (`test_db_roundtrip.py`)
| Test | Checks | Target |
|---|---|---|
| `test_expense_round_trip` | A raw insert via `factories.make_expense` reads back with the same fields — proves the schema/fixtures/test-DB wiring itself, independent of any repository | [`docs/SCHEMA.sql`](../docs/SCHEMA.sql), [`factories.py`](factories.py) |

---

## Bot tests (`test_bot_client.py`) → [`bot/client.py`](../bot/client.py)
Hermetic — `httpx.AsyncClient` given a fake `httpx.MockTransport`, no real network
(respx isn't a project dependency; `httpx.MockTransport` matches the
`test_notification_service.py` precedent, U4.1 AC/D37).

| Test | Checks |
|---|---|
| `test_every_request_carries_tg_id_and_internal_token_headers` | Every request carries `X-Telegram-User-Id`/`X-Internal-Token` from construction, not from call-site args |
| `test_list_expenses_parses_response_into_models` | `GET /expenses` response JSON parses into `ExpenseResponse` objects |
| `test_create_expense_sends_json_body_and_returns_parsed_model` | `POST /expenses` sends the `ExpenseCreate` body as JSON and returns the parsed `ExpenseResponse` |
| `test_update_expense_excludes_unset_fields` | `PATCH /expenses/{id}` body only includes fields explicitly set on `ExpenseUpdate` (`exclude_unset`) |
| `test_delete_expense_returns_none_on_204` | `DELETE /expenses/{id}` succeeds on 204, no return value |
| `test_non_2xx_response_raises_http_status_error` | A non-2xx response raises `httpx.HTTPStatusError` (`raise_for_status`), not swallowed |
| `test_list_categories_and_create_category` | Categories list/create round trip |
| `test_update_category_and_delete_category` | Categories update/delete round trip |
| `test_tags_crud` | Tags list/get/create/update/delete round trip |
| `test_budget_plans_crud_and_progress` | Budget plans list/get/create/update/delete plus `get_budget_plan_progress` round trip |
| `test_statistics_endpoints` | `statistics_by_period`/`statistics_by_category`/`statistics_by_tag` parse into their respective models |
| `test_statistics_by_period_sends_optional_params_as_query_string` | `start`/`end`/`category_id`/`tag_id` are sent as ISO-8601/string query params when given |
| `test_statistics_by_period_omits_params_when_not_given` | No query params are sent when all optional args are omitted |

## Bot tests (`test_bot_middlewares.py`) → [`bot/middlewares.py`](../bot/middlewares.py)
Hermetic — no real Telegram/network; middleware called directly with a fake
`handler`/`data` dict (U4.1 AC).

| Test | Checks |
|---|---|
| `test_non_allowlisted_tg_id_is_dropped_before_any_api_call` | A tg_id outside the allowlist never reaches the handler (AC) |
| `test_missing_event_from_user_is_dropped` | No `event_from_user` in middleware data → dropped, not a crash |
| `test_allowlisted_tg_id_calls_handler_with_injected_client` | An allowlisted tg_id's handler runs and receives a `BackendClient` via `data["client"]` |
| `test_injected_client_carries_headers_for_the_calling_tg_id` | The injected `BackendClient`'s requests carry that tg_id's `X-Telegram-User-Id` and the configured `X-Internal-Token` |
| `test_dropped_update_is_logged` | Dropping a non-allowlisted update logs a `WARNING` record naming the tg_id |

## Bot tests (`test_bot_bot.py`) → [`bot/bot.py`](../bot/bot.py)
Hermetic — no real Telegram/network; updates fed through the full dispatcher
stack via `dp.feed_update` with a `MockTransport`-backed http client (U4.2 AC:
dispatcher builds).

| Test | Checks |
|---|---|
| `test_dispatcher_builds` | `create_dispatcher()` returns a `Dispatcher` (AC) |
| `test_allowlist_registered_as_outer_update_middleware_after_user_context` | `AllowlistMiddleware` sits on `dp.update.outer_middleware` after aiogram's built-in `UserContextMiddleware` (the registration-order requirement from `bot/middlewares.py`'s docstring) |
| `test_allowlisted_update_reaches_handler_with_injected_client` | A real `Update` from an allowlisted tg_id, fed through `dp.feed_update`, reaches a message handler with `client: BackendClient` injected |
| `test_non_allowlisted_update_never_reaches_handler` | A real `Update` from a non-allowlisted tg_id is dropped by the full dispatcher stack — the handler never runs |

## Bot tests (`test_bot_keyboards.py`) → [`bot/keyboards.py`](../bot/keyboards.py)
Pure functions — no fakes needed (U4.2 AC: keyboards render expected
callback_data; these tests lock the callback wire formats handler filters
match on).

| Test | Checks |
|---|---|
| `test_categories_keyboard_renders_one_button_per_category_with_packed_id` | One button per category, text = name, callback_data = `category:<uuid hex>` (AC) |
| `test_category_callback_round_trips_the_uuid` | `CategoryCallback.pack()`/`unpack()` round-trips the UUID |
| `test_tags_keyboard_renders_toggle_buttons_and_done` | One toggle button per tag (`tag:<uuid hex>`) plus a final "Done" button (`tags:done`) |
| `test_tags_keyboard_marks_selected_tags` | Selected tags get the ✅ label prefix; callback_data stays stable so tapping toggles |
| `test_tag_callback_round_trips_the_uuid` | `TagCallback.pack()`/`unpack()` round-trips the UUID |
| `test_budgets_keyboard_renders_one_button_per_plan_with_category_name` | One button per plan, text = its category's name, callback_data = `budget:<uuid hex>` (U2.2 AC) |
| `test_budgets_keyboard_unknown_category_falls_back_to_placeholder` | A plan whose category isn't in the passed-in name map renders "Unknown" instead of a blank/crashing label |
| `test_budget_callback_round_trips_the_uuid` | `BudgetCallback.pack()`/`unpack()` round-trips the UUID |
| `test_confirm_keyboard_renders_confirm_and_cancel` | Confirm/cancel buttons carry `expense:confirm`/`expense:cancel` |

## Bot tests (`test_bot_handlers_expenses.py`) → [`bot/handlers/expenses.py`](../bot/handlers/expenses.py)
Hermetic — a `FakeBackendClient` stands in for `bot/client.py`'s `BackendClient`
(no real backend HTTP); most handlers are called directly with mock
Message/CallbackQuery objects and a real `FSMContext` over aiogram's
`MemoryStorage`. A second group dispatches through a real `Dispatcher` +
`create_router()` (Telegram network mocked via `Message.answer` patched to an
`AsyncMock`) specifically to catch router-registration-order bugs that direct
handler calls can't see (U4.3 AC: FSM walkthrough — happy path, cancel
mid-flow, invalid amount input re-prompts; amount parsed to minor units in one
helper with its own tests). Also covers the `/expenses` list view (U4.3b) —
a plain command handler, no FSM/real-dispatch tests needed.

| Test | Checks |
|---|---|
| `test_parse_amount_to_minor_units_valid` | `"12.50"`/`"12,50"`/`"1 234,56"`/`"1\xa0234.00"`/plain-integer/whitespace inputs all parse to the correct minor-units `int` (AC) |
| `test_parse_amount_to_minor_units_invalid` | Non-numeric, negative, zero, multi-separator, empty/blank input all raise `ValueError` |
| `test_happy_path_full_flow_creates_expense` | Full walkthrough (category → amount → comment → tags → confirm) ends in a `create_expense` call with the right `ExpenseCreate` and state cleared (AC) |
| `test_no_categories_never_starts_flow` | `/add` with no categories shows a message and never enters the FSM |
| `test_no_tags_skips_tag_step_straight_to_confirm` | No tags on the account → flow goes straight from comment to confirm |
| `test_invalid_amount_reprompts_and_stays_in_amount_state` | Unparseable amount text re-prompts and stays in `AddExpense.amount` (AC) |
| `test_cancel_command_clears_state_mid_flow` | `on_cancel_command` clears FSM state and data |
| `test_cancel_callback_clears_state_from_confirm` | The Cancel button's callback clears FSM state from the confirm step |
| `test_create_expense_failure_clears_state_and_shows_friendly_message` | A `create_expense` HTTP failure clears state and shows a human message, never a traceback |
| `test_add_expense_backend_error_shows_friendly_message` | A `list_categories` transport failure shows a human message instead of raising |
| `test_prompt_tags_backend_error_shows_friendly_message_and_keeps_state` | A `list_tags` transport failure shows a human message and leaves state in place (retryable) |
| `test_cancel_command_reaches_cancel_handler_not_amount_catchall` | Through a real `Dispatcher`: `/cancel` while in `AddExpense.amount` reaches `on_cancel_command`, not the catch-all `on_amount_entered` (AC: cancel mid-flow) |
| `test_cancel_command_reaches_cancel_handler_not_comment_catchall` | Same, for `AddExpense.comment` — regression test for a router-registration-order bug found in review |
| `test_list_expenses_renders_non_empty_list` | `/expenses` with data shows each expense's date and minor-units-formatted amount (AC) |
| `test_list_expenses_renders_empty_list` | `/expenses` with no expenses shows "No expenses yet." instead of an empty message (AC) |
| `test_list_expenses_shows_comment_when_present` | Comment is rendered for expenses that have one, omitted for those that don't (AC) |
| `test_list_expenses_backend_error_shows_friendly_message` | A `list_expenses` transport failure shows a human message instead of raising |
| `test_list_expenses_truncates_long_list_and_long_comments` | Long lists/comments are truncated so the rendered message stays under Telegram's 4096-char limit (review fix) |
| `test_expenses_command_reaches_list_handler_not_amount_catchall` | Through a real `Dispatcher`: `/expenses` while in `AddExpense.amount` reaches `cmd_list_expenses`, not the catch-all `on_amount_entered` (review fix, D39-precedent registration-order regression test) |

## Bot tests (`test_bot_handlers_categories.py`) → [`bot/handlers/categories.py`](../bot/handlers/categories.py)
Hermetic — a `FakeCategoryBackendClient` stands in for `bot/client.py`'s
`BackendClient`; handlers are called directly with mock Message/CallbackQuery
objects and a real `FSMContext` over aiogram's `MemoryStorage`. One real-
`Dispatcher` test guards the same registration-order class of bug as
`test_bot_handlers_expenses.py` (D39/D40 precedent). U4.4 AC: CRUD flows
against a fake API; permission-denied (403) and in-use (409, category still
referenced by expenses/budget plans, plan D5) rendered as human messages, not
a stack trace.

| Test | Checks |
|---|---|
| `test_list_categories_renders_non_empty_list` | `/categories` with data lists each category's name |
| `test_list_categories_renders_empty_list` | `/categories` with none shows "No categories yet." |
| `test_list_categories_backend_error_shows_friendly_message` | A `list_categories` transport failure shows a human message instead of raising |
| `test_add_category_happy_path` | `/addcategory` → name reply ends in a `create_category` call and cleared state (AC) |
| `test_add_category_empty_name_reprompts` | Blank/whitespace-only name re-prompts and stays in `CategoryManage.add_name` |
| `test_add_category_permission_denied_shows_friendly_message` | A 403 from `create_category` shows a permission message, not a traceback (AC) |
| `test_add_category_backend_error_shows_friendly_message` | A `create_category` transport failure shows a human message |
| `test_rename_category_happy_path` | `/renamecategory` → select → new name ends in an `update_category` call for the selected id (AC) |
| `test_rename_category_no_categories` | `/renamecategory` with none shows a message and never enters the FSM |
| `test_rename_category_permission_denied_shows_friendly_message` | A 403 from `update_category` shows a permission message, not a traceback (AC) |
| `test_delete_category_happy_path` | `/deletecategory` → select ends in a `delete_category` call for the selected id (AC) |
| `test_delete_category_no_categories` | `/deletecategory` with none shows a message and never enters the FSM |
| `test_delete_category_conflict_shows_friendly_message` | A 409 from `delete_category` (still referenced by expenses/budget plans) shows a human message, not a traceback (AC) |
| `test_cancel_command_clears_state` | `on_cancel_command` clears FSM state |
| `test_cancel_command_reaches_cancel_handler_not_add_name_catchall` | Through a real `Dispatcher`: `/cancel` while in `CategoryManage.add_name` reaches `on_cancel_command`, not the catch-all `on_add_category_name_entered` |

## Bot tests (`test_bot_handlers_tags.py`) → [`bot/handlers/tags.py`](../bot/handlers/tags.py)
Hermetic — a `FakeTagBackendClient` stands in for `bot/client.py`'s
`BackendClient`; handlers are called directly with mock Message/CallbackQuery
objects and a real `FSMContext` over aiogram's `MemoryStorage`. One real-
`Dispatcher` test guards the same registration-order class of bug as
`test_bot_handlers_categories.py` (D39/D40 precedent). U4.4b AC: mechanical
mirror of U4.4 for tags — CRUD flows against a fake API; permission-denied
(403) rendered as a human message, not a stack trace. Unlike categories,
there is no 409 case: tag deletion is `ON DELETE CASCADE`, not `RESTRICT`,
and tag names have no per-account unique constraint (D19), so the backend
never returns 409 for tags.

| Test | Checks |
|---|---|
| `test_list_tags_renders_non_empty_list` | `/tags` with data lists each tag's name |
| `test_list_tags_renders_empty_list` | `/tags` with none shows "No tags yet." |
| `test_list_tags_backend_error_shows_friendly_message` | A `list_tags` transport failure shows a human message instead of raising |
| `test_add_tag_happy_path` | `/addtag` → name reply ends in a `create_tag` call and cleared state (AC) |
| `test_add_tag_empty_name_reprompts` | Blank/whitespace-only name re-prompts and stays in `TagManage.add_name` |
| `test_add_tag_permission_denied_shows_friendly_message` | A 403 from `create_tag` shows a permission message, not a traceback (AC) |
| `test_add_tag_backend_error_shows_friendly_message` | A `create_tag` transport failure shows a human message |
| `test_rename_tag_happy_path` | `/renametag` → select → new name ends in an `update_tag` call for the selected id (AC) |
| `test_rename_tag_no_tags` | `/renametag` with none shows a message and never enters the FSM |
| `test_rename_tag_permission_denied_shows_friendly_message` | A 403 from `update_tag` shows a permission message, not a traceback (AC) |
| `test_delete_tag_happy_path` | `/deletetag` → select ends in a `delete_tag` call for the selected id (AC) |
| `test_delete_tag_no_tags` | `/deletetag` with none shows a message and never enters the FSM |
| `test_delete_tag_permission_denied_shows_friendly_message` | A 403 from `delete_tag` shows a permission message, not a traceback (AC) |
| `test_cancel_command_clears_state` | `on_cancel_command` clears FSM state |
| `test_cancel_command_reaches_cancel_handler_not_add_name_catchall` | Through a real `Dispatcher`: `/cancel` while in `TagManage.add_name` reaches `on_cancel_command`, not the catch-all `on_add_tag_name_entered` |

## Bot tests (`test_bot_handlers_budgets.py`) → [`bot/handlers/budgets.py`](../bot/handlers/budgets.py)
Hermetic — a `FakeBudgetBackendClient` stands in for `bot/client.py`'s
`BackendClient`; handlers are called directly with mock Message/CallbackQuery
objects and a real `FSMContext` over aiogram's `MemoryStorage`. `/budgets`
itself has no FSM (U4.5 AC: read-only rendering) — `/budgets` lists each plan
with a progress bar built from `GET /budgets/{id}/progress`. Add/update/
delete (U2.2, superseding MVP D45's API-only-for-V1 scope) use the
`BudgetManage` FSM; one real-`Dispatcher` test guards the same
registration-order class of bug as `test_bot_handlers_categories.py`
(D39/D40 precedent).

| Test | Checks |
|---|---|
| `test_render_progress_bar_at_zero` | 0% renders an all-empty bar |
| `test_render_progress_bar_at_half` | 50% renders a half-filled bar |
| `test_render_progress_bar_over_100_caps_at_full_bar` | >100% still renders a fully-filled bar, not an overflow/crash (AC) |
| `test_render_progress_bar_none_shows_no_limit` | `fill_pct=None` (zero/negative limit, D34) renders "no limit set" instead of dividing by zero |
| `test_list_budgets_renders_progress_and_amounts_from_minor_units` | `/budgets` renders the category name, spent/limit formatted from minor units, and the matching bar (AC) |
| `test_list_budgets_flags_exceeded_budget` | `is_exceeded=True` adds a "Budget exceeded" warning line |
| `test_list_budgets_renders_empty_list` | `/budgets` with none shows "No budget plans yet." |
| `test_list_budgets_backend_error_on_list_shows_friendly_message` | A `list_budget_plans` transport failure shows a human message instead of raising |
| `test_list_budgets_unknown_category_falls_back_to_placeholder` | A plan whose category isn't in the fetched category list still renders, as "Unknown" |
| `test_list_budgets_progress_fetch_error_shows_inline_message_and_continues` | A `get_budget_plan_progress` failure for one plan shows an inline error for that plan without failing the whole list |
| `test_add_budget_happy_path_with_explicit_threshold` | `/addbudget` → category → amount → threshold ends in a `create_budget_plan` call with the right `BudgetPlanCreate` and cleared state (U2.2 AC) |
| `test_add_budget_threshold_skip_uses_default` | `/skip` at the threshold step creates the plan with the default 80% threshold |
| `test_add_budget_no_categories` | `/addbudget` with no categories shows a message and never enters the FSM |
| `test_add_budget_invalid_amount_reprompts` | Unparseable amount text re-prompts and stays in `BudgetManage.add_amount` (AC) |
| `test_add_budget_invalid_threshold_reprompts` | Out-of-range threshold text re-prompts and stays in `BudgetManage.add_threshold`, no create call (AC) |
| `test_add_budget_duplicate_shows_friendly_message` | A 409 from `create_budget_plan` (`UNIQUE(category_id, account_id, period)`) shows an "already exists" message, not a traceback (AC) |
| `test_add_budget_permission_denied_shows_friendly_message` | A 403 from `create_budget_plan` shows a permission message, not a traceback (AC) |
| `test_update_budget_happy_path_amount_and_threshold` | `/updatebudget` → select → new amount → new threshold ends in an `update_budget_plan` call with both fields set (AC) |
| `test_update_budget_skip_both_keeps_values_unchanged` | Skipping both amount and threshold sends no update call at all ("Nothing changed.") |
| `test_update_budget_no_plans` | `/updatebudget` with none shows a message and never enters the FSM |
| `test_update_budget_invalid_amount_reprompts` | Unparseable amount text re-prompts and stays in `BudgetManage.update_amount` (AC) |
| `test_update_budget_invalid_threshold_reprompts` | Out-of-range threshold text re-prompts and stays in `BudgetManage.update_threshold`, no update call (AC) |
| `test_update_budget_permission_denied_shows_friendly_message` | A 403 from `update_budget_plan` shows a permission message, not a traceback (AC) |
| `test_delete_budget_happy_path` | `/deletebudget` → select ends in a `delete_budget_plan` call for the selected plan (AC) |
| `test_delete_budget_no_plans` | `/deletebudget` with none shows a message and never enters the FSM |
| `test_delete_budget_permission_denied_shows_friendly_message` | A 403 from `delete_budget_plan` shows a permission message, not a traceback (AC) |
| `test_cancel_command_clears_state` | `on_cancel_command` clears FSM state |
| `test_cancel_command_reaches_cancel_handler_not_add_amount_catchall` | Through a real `Dispatcher`: `/cancel` while in `BudgetManage.add_amount` reaches `on_cancel_command`, not the catch-all `on_add_budget_amount_entered` |

## Bot tests (`test_bot_handlers_statistics.py`) → [`bot/handlers/statistics.py`](../bot/handlers/statistics.py)
Hermetic — a `FakeStatisticsBackendClient` stands in for `bot/client.py`'s
`BackendClient`; handlers are called directly with mock `Message` objects. No
FSM, no input: `/statistics` is a single command rendering the current-month
period total plus category/tag breakdowns (U4.5 AC).

| Test | Checks |
|---|---|
| `test_statistics_renders_period_total_from_minor_units` | `/statistics` renders the period bounds and total formatted from minor units (AC) |
| `test_statistics_renders_category_breakdown_sorted_by_total_desc` | Category breakdown is sorted highest-spend first, amounts formatted from minor units |
| `test_statistics_renders_tag_breakdown` | Tag breakdown renders name + amount formatted from minor units |
| `test_statistics_omits_breakdown_sections_when_empty` | No "By category:"/"By tag:" headers when either list is empty |
| `test_statistics_unknown_category_falls_back_to_placeholder` | A category id absent from the fetched category list still renders, as "Unknown" |
| `test_statistics_backend_error_shows_friendly_message` | A transport failure on any of the three statistics calls shows a human message instead of raising |

---

## E2e smoke (`test_e2e_smoke.py`) — U5.1, `@pytest.mark.integration`, excluded from default `verify.sh`
Real FastAPI app on a real Postgres pool (`main.lifespan`) driven through
`bot.client.BackendClient` — no fakes for expenses/budgets/DB. Only the
outbound Telegram call inside `NotificationService` is swapped for a
`httpx.MockTransport` (same pattern as `test_notification_service.py`), so
the test needs neither a live bot token nor network access.

| Test | Checks |
|---|---|
| `test_add_expense_appears_in_list_and_fires_budget_notification` | Bot client creates an expense against the real API/DB, the expense appears in `list_expenses`, and crossing the budget's `notify_threshold` fires exactly one Telegram notification with the category name and fill percentage (U5.1 AC) |
