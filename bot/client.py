"""BackendClient: the bot's only channel to the FastAPI backend (bot/CLAUDE.md).

One method per endpoint the bot milestone (M4) actually drives — expenses,
categories, tags, budgets, statistics. User management is admin-panel/V2
scope (project CLAUDE.md "Out of scope") and has no bot handler planned, so
it's not wrapped here.

Every request carries X-Telegram-User-Id + X-Internal-Token (D1); the caller
supplies both once at construction so handlers never touch headers directly.
Non-2xx responses raise httpx.HTTPStatusError — handlers (U4.3+) translate
that into a human-readable Telegram message, never a raw traceback.
"""

from typing import Any
from uuid import UUID

import httpx

from models.budget_plan import (
    BudgetPlanCreate,
    BudgetPlanResponse,
    BudgetPlanUpdate,
    BudgetProgress,
)
from models.category import CategoryCreate, CategoryResponse, CategoryUpdate
from models.expense import ExpenseCreate, ExpenseResponse, ExpenseUpdate
from models.statistics import CategoryTotal, PeriodTotal, TagTotal
from models.tag import TagCreate, TagResponse, TagUpdate


class BackendClient:
    def __init__(self, client: httpx.AsyncClient, tg_id: int, internal_token: str) -> None:
        self._client = client
        self._headers = {
            "X-Telegram-User-Id": str(tg_id),
            "X-Internal-Token": internal_token,
        }

    async def _request(self, method: str, path: str, **kwargs: Any) -> httpx.Response:
        # Callers catching httpx.HTTPStatusError from this call must never log
        # exc.request/exc.request.headers — httpx only auto-redacts the
        # Authorization/Proxy-Authorization headers, not our custom
        # X-Internal-Token, so doing so would leak the shared secret (same
        # class of bug as the bot-token leak fixed in notification_service.py).
        response = await self._client.request(method, path, headers=self._headers, **kwargs)
        response.raise_for_status()
        return response

    # -- expenses --------------------------------------------------------

    async def list_expenses(self) -> list[ExpenseResponse]:
        response = await self._request("GET", "/expenses")
        return [ExpenseResponse.model_validate(item) for item in response.json()]

    async def get_expense(self, expense_id: UUID) -> ExpenseResponse:
        response = await self._request("GET", f"/expenses/{expense_id}")
        return ExpenseResponse.model_validate(response.json())

    async def create_expense(self, data: ExpenseCreate) -> ExpenseResponse:
        response = await self._request("POST", "/expenses", json=data.model_dump(mode="json"))
        return ExpenseResponse.model_validate(response.json())

    async def update_expense(self, expense_id: UUID, data: ExpenseUpdate) -> ExpenseResponse:
        response = await self._request(
            "PATCH",
            f"/expenses/{expense_id}",
            json=data.model_dump(mode="json", exclude_unset=True),
        )
        return ExpenseResponse.model_validate(response.json())

    async def delete_expense(self, expense_id: UUID) -> None:
        await self._request("DELETE", f"/expenses/{expense_id}")

    # -- categories --------------------------------------------------------

    async def list_categories(self) -> list[CategoryResponse]:
        response = await self._request("GET", "/categories")
        return [CategoryResponse.model_validate(item) for item in response.json()]

    async def get_category(self, category_id: UUID) -> CategoryResponse:
        response = await self._request("GET", f"/categories/{category_id}")
        return CategoryResponse.model_validate(response.json())

    async def create_category(self, data: CategoryCreate) -> CategoryResponse:
        response = await self._request("POST", "/categories", json=data.model_dump(mode="json"))
        return CategoryResponse.model_validate(response.json())

    async def update_category(self, category_id: UUID, data: CategoryUpdate) -> CategoryResponse:
        response = await self._request(
            "PATCH",
            f"/categories/{category_id}",
            json=data.model_dump(mode="json", exclude_unset=True),
        )
        return CategoryResponse.model_validate(response.json())

    async def delete_category(self, category_id: UUID) -> None:
        await self._request("DELETE", f"/categories/{category_id}")

    # -- tags --------------------------------------------------------

    async def list_tags(self) -> list[TagResponse]:
        response = await self._request("GET", "/tags")
        return [TagResponse.model_validate(item) for item in response.json()]

    async def get_tag(self, tag_id: UUID) -> TagResponse:
        response = await self._request("GET", f"/tags/{tag_id}")
        return TagResponse.model_validate(response.json())

    async def create_tag(self, data: TagCreate) -> TagResponse:
        response = await self._request("POST", "/tags", json=data.model_dump(mode="json"))
        return TagResponse.model_validate(response.json())

    async def update_tag(self, tag_id: UUID, data: TagUpdate) -> TagResponse:
        response = await self._request(
            "PATCH", f"/tags/{tag_id}", json=data.model_dump(mode="json", exclude_unset=True)
        )
        return TagResponse.model_validate(response.json())

    async def delete_tag(self, tag_id: UUID) -> None:
        await self._request("DELETE", f"/tags/{tag_id}")

    # -- budget plans --------------------------------------------------------

    async def list_budget_plans(self) -> list[BudgetPlanResponse]:
        response = await self._request("GET", "/budgets")
        return [BudgetPlanResponse.model_validate(item) for item in response.json()]

    async def get_budget_plan(self, budget_plan_id: UUID) -> BudgetPlanResponse:
        response = await self._request("GET", f"/budgets/{budget_plan_id}")
        return BudgetPlanResponse.model_validate(response.json())

    async def get_budget_plan_progress(self, budget_plan_id: UUID) -> BudgetProgress:
        response = await self._request("GET", f"/budgets/{budget_plan_id}/progress")
        return BudgetProgress.model_validate(response.json())

    async def create_budget_plan(self, data: BudgetPlanCreate) -> BudgetPlanResponse:
        response = await self._request("POST", "/budgets", json=data.model_dump(mode="json"))
        return BudgetPlanResponse.model_validate(response.json())

    async def update_budget_plan(
        self, budget_plan_id: UUID, data: BudgetPlanUpdate
    ) -> BudgetPlanResponse:
        response = await self._request(
            "PATCH",
            f"/budgets/{budget_plan_id}",
            json=data.model_dump(mode="json", exclude_unset=True),
        )
        return BudgetPlanResponse.model_validate(response.json())

    async def delete_budget_plan(self, budget_plan_id: UUID) -> None:
        await self._request("DELETE", f"/budgets/{budget_plan_id}")

    # -- statistics --------------------------------------------------------

    async def statistics_by_period(self) -> PeriodTotal:
        response = await self._request("GET", "/statistics/by-period")
        return PeriodTotal.model_validate(response.json())

    async def statistics_by_category(self) -> list[CategoryTotal]:
        response = await self._request("GET", "/statistics/by-category")
        return [CategoryTotal.model_validate(item) for item in response.json()]

    async def statistics_by_tag(self) -> list[TagTotal]:
        response = await self._request("GET", "/statistics/by-tag")
        return [TagTotal.model_validate(item) for item in response.json()]
