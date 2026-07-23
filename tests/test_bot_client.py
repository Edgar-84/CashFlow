"""Unit tests for bot/client.py — BackendClient, mocked httpx transport, no
real network (tests/CLAUDE.md, U4.1 AC)."""

import json
from datetime import UTC, datetime
from uuid import uuid4

import httpx
import pytest

from bot.client import BackendClient
from models.budget_plan import BudgetPlanCreate, BudgetPlanUpdate
from models.category import CategoryCreate, CategoryUpdate
from models.expense import ExpenseCreate, ExpenseUpdate
from models.tag import TagCreate, TagUpdate


@pytest.fixture
def make_expense_json() -> dict[str, object]:
    return {
        "id": str(uuid4()),
        "user_id": str(uuid4()),
        "account_id": str(uuid4()),
        "created_at": "2026-07-01T12:00:00Z",
        "updated_at": "2026-07-01T12:00:00Z",
        "amount": 1000,
        "comment": None,
        "category_id": str(uuid4()),
        "tags": [],
    }


@pytest.fixture
def make_category_json() -> dict[str, object]:
    return {
        "id": str(uuid4()),
        "account_id": str(uuid4()),
        "created_at": "2026-07-01T12:00:00Z",
        "name": "Groceries",
    }


@pytest.fixture
def make_tag_json() -> dict[str, object]:
    return {
        "id": str(uuid4()),
        "account_id": str(uuid4()),
        "created_at": "2026-07-01T12:00:00Z",
        "name": "urgent",
    }


@pytest.fixture
def make_budget_plan_json() -> dict[str, object]:
    return {
        "id": str(uuid4()),
        "account_id": str(uuid4()),
        "category_id": str(uuid4()),
        "created_at": "2026-07-01T12:00:00Z",
        "updated_at": "2026-07-01T12:00:00Z",
        "amount": 10000,
        "period": "monthly",
        "notify_threshold": 80,
    }


def make_client(handler: httpx.MockTransport, *, tg_id: int = 555) -> BackendClient:
    http_client = httpx.AsyncClient(transport=handler, base_url="http://test")
    return BackendClient(http_client, tg_id, "test-internal-token")


def _echo(json_body: object, status_code: int = 200) -> httpx.MockTransport:
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(status_code, json=json_body)

    return httpx.MockTransport(handler)


async def test_every_request_carries_tg_id_and_internal_token_headers() -> None:
    captured: list[httpx.Request] = []

    def handler(request: httpx.Request) -> httpx.Response:
        captured.append(request)
        return httpx.Response(200, json=[])

    client = make_client(httpx.MockTransport(handler), tg_id=42)
    await client.list_expenses()

    assert len(captured) == 1
    assert captured[0].headers["X-Telegram-User-Id"] == "42"
    assert captured[0].headers["X-Internal-Token"] == "test-internal-token"


async def test_list_expenses_parses_response_into_models(
    make_expense_json: dict[str, object],
) -> None:
    client = make_client(_echo([make_expense_json]))
    expenses = await client.list_expenses()

    assert len(expenses) == 1
    assert str(expenses[0].id) == make_expense_json["id"]


async def test_create_expense_sends_json_body_and_returns_parsed_model(
    make_expense_json: dict[str, object],
) -> None:
    captured: list[httpx.Request] = []

    def handler(request: httpx.Request) -> httpx.Response:
        captured.append(request)
        return httpx.Response(201, json=make_expense_json)

    client = make_client(httpx.MockTransport(handler))
    data = ExpenseCreate(amount=1000, category_id=make_expense_json["category_id"])  # type: ignore[arg-type]
    expense = await client.create_expense(data)

    assert expense.amount == make_expense_json["amount"]
    sent_body = json.loads(captured[0].content)
    assert sent_body["amount"] == 1000


async def test_update_expense_excludes_unset_fields(
    make_expense_json: dict[str, object],
) -> None:
    captured: list[httpx.Request] = []

    def handler(request: httpx.Request) -> httpx.Response:
        captured.append(request)
        return httpx.Response(200, json=make_expense_json)

    client = make_client(httpx.MockTransport(handler))
    await client.update_expense(uuid4(), ExpenseUpdate(amount=500))

    sent_body = json.loads(captured[0].content)
    assert sent_body == {"amount": 500}


async def test_delete_expense_returns_none_on_204() -> None:
    client = make_client(_echo(None, status_code=204))
    await client.delete_expense(uuid4())  # must not raise


async def test_non_2xx_response_raises_http_status_error() -> None:
    client = make_client(_echo({"detail": "Not allowed"}, status_code=403))
    with pytest.raises(httpx.HTTPStatusError):
        await client.list_expenses()


async def test_list_categories_and_create_category(
    make_category_json: dict[str, object],
) -> None:
    client = make_client(_echo([make_category_json]))
    categories = await client.list_categories()
    assert categories[0].name == make_category_json["name"]

    client2 = make_client(_echo(make_category_json, status_code=201))
    category = await client2.create_category(CategoryCreate(name="Groceries"))
    assert str(category.id) == make_category_json["id"]


async def test_update_category_and_delete_category(
    make_category_json: dict[str, object],
) -> None:
    client = make_client(_echo(make_category_json))
    category = await client.update_category(uuid4(), CategoryUpdate(name="Renamed"))
    assert str(category.id) == make_category_json["id"]

    client2 = make_client(_echo(None, status_code=204))
    await client2.delete_category(uuid4())  # must not raise


async def test_tags_crud(make_tag_json: dict[str, object]) -> None:
    client = make_client(_echo([make_tag_json]))
    assert (await client.list_tags())[0].name == make_tag_json["name"]

    client2 = make_client(_echo(make_tag_json))
    assert str((await client2.get_tag(uuid4())).id) == make_tag_json["id"]

    client3 = make_client(_echo(make_tag_json, status_code=201))
    assert str((await client3.create_tag(TagCreate(name="urgent"))).id) == make_tag_json["id"]

    client4 = make_client(_echo(make_tag_json))
    assert (
        str((await client4.update_tag(uuid4(), TagUpdate(name="renamed"))).id)
        == make_tag_json["id"]
    )

    client5 = make_client(_echo(None, status_code=204))
    await client5.delete_tag(uuid4())  # must not raise


async def test_budget_plans_crud_and_progress(
    make_budget_plan_json: dict[str, object],
) -> None:
    client = make_client(_echo([make_budget_plan_json]))
    assert str((await client.list_budget_plans())[0].id) == make_budget_plan_json["id"]

    client2 = make_client(_echo(make_budget_plan_json))
    assert str((await client2.get_budget_plan(uuid4())).id) == make_budget_plan_json["id"]

    progress_json = {
        "budget_plan_id": make_budget_plan_json["id"],
        "category_id": make_budget_plan_json["category_id"],
        "amount": 10000,
        "spent": 8000,
        "remaining": 2000,
        "fill_pct": 80.0,
        "notify_threshold": 80,
        "is_over_threshold": True,
        "is_exceeded": False,
    }
    client3 = make_client(_echo(progress_json))
    progress = await client3.get_budget_plan_progress(uuid4())
    assert progress.fill_pct == 80.0

    client4 = make_client(_echo(make_budget_plan_json, status_code=201))
    created = await client4.create_budget_plan(
        BudgetPlanCreate(
            category_id=make_budget_plan_json["category_id"],  # type: ignore[arg-type]
            amount=10000,
        )
    )
    assert str(created.id) == make_budget_plan_json["id"]

    client5 = make_client(_echo(make_budget_plan_json))
    updated = await client5.update_budget_plan(uuid4(), BudgetPlanUpdate(notify_threshold=90))
    assert str(updated.id) == make_budget_plan_json["id"]

    client6 = make_client(_echo(None, status_code=204))
    await client6.delete_budget_plan(uuid4())  # must not raise


async def test_statistics_endpoints(make_expense_json: dict[str, object]) -> None:
    period_json = {"start": "2026-07-01T00:00:00Z", "end": "2026-08-01T00:00:00Z", "total": 5000}
    client = make_client(_echo(period_json))
    period = await client.statistics_by_period()
    assert period.total == 5000

    by_category_json = [{"category_id": str(uuid4()), "total": 3000}]
    client2 = make_client(_echo(by_category_json))
    by_category = await client2.statistics_by_category()
    assert by_category[0].total == 3000

    by_tag_json = [{"tag_id": str(uuid4()), "total": 1500}]
    client3 = make_client(_echo(by_tag_json))
    by_tag = await client3.statistics_by_tag()
    assert by_tag[0].total == 1500


async def test_statistics_by_period_sends_optional_params_as_query_string(
    make_expense_json: dict[str, object],
) -> None:
    captured: list[httpx.Request] = []

    def handler(request: httpx.Request) -> httpx.Response:
        captured.append(request)
        return httpx.Response(
            200, json={"start": "2026-01-01T00:00:00Z", "end": "2026-02-01T00:00:00Z", "total": 0}
        )

    client = make_client(httpx.MockTransport(handler))
    category_id = uuid4()
    tag_id = uuid4()
    await client.statistics_by_period(
        start=datetime(2026, 1, 1, tzinfo=UTC),
        end=datetime(2026, 2, 1, tzinfo=UTC),
        category_id=category_id,
        tag_id=tag_id,
    )

    query = captured[0].url.params
    assert query["start"] == "2026-01-01T00:00:00+00:00"
    assert query["end"] == "2026-02-01T00:00:00+00:00"
    assert query["category_id"] == str(category_id)
    assert query["tag_id"] == str(tag_id)


async def test_statistics_by_period_omits_params_when_not_given() -> None:
    captured: list[httpx.Request] = []

    def handler(request: httpx.Request) -> httpx.Response:
        captured.append(request)
        return httpx.Response(
            200, json={"start": "2026-01-01T00:00:00Z", "end": "2026-02-01T00:00:00Z", "total": 0}
        )

    client = make_client(httpx.MockTransport(handler))
    await client.statistics_by_period()

    assert captured[0].url.params == httpx.QueryParams()
