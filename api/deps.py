"""FastAPI dependencies: auth, permission enforcement, repository factories.

This module is the API layer's composition root — the only place under
``api/`` allowed to import from ``repositories/`` (router modules never do).

Permission enforcement follows the 6-step order from ``api/CLAUDE.md``:
steps 1 (authentication) live in :func:`get_current_user`, steps 2–5 in the
pure :func:`resolve_permission`, and step 6 (``own_only`` vs. the target
record's owner) in :func:`enforce_ownership`, called by whoever has the
target record in hand — the checker itself cannot know it at
dependency-resolution time, so :class:`PermissionChecker` exposes the
resolved decision on ``request.state.permission_decision``.
"""

from __future__ import annotations

import secrets
from dataclasses import dataclass
from functools import lru_cache
from typing import Annotated
from uuid import UUID

import asyncpg
import httpx
from fastapi import Depends, Header, HTTPException, Request, status

import database
from config import get_settings
from models.enums import Action, Resource, Role
from models.permission import PermissionResponse
from models.user import UserResponse
from repositories.budget_plan_repo import BudgetPlanRepository
from repositories.category_repo import CategoryRepository
from repositories.expense_repo import ExpenseRepository
from repositories.permission_repo import PermissionRepository
from repositories.tag_repo import TagRepository
from repositories.user_repo import UserRepository
from services.budget_service import BudgetService
from services.category_service import CategoryService
from services.expense_service import ExpenseService
from services.notification_service import NotificationService
from services.permission_service import PermissionService
from services.statistics_service import StatisticsService
from services.tag_service import TagService
from services.user_service import UserService


def get_user_repo(
    conn: Annotated[asyncpg.Connection, Depends(database.get_connection)],
) -> UserRepository:
    return UserRepository(conn)


def get_permission_repo(
    conn: Annotated[asyncpg.Connection, Depends(database.get_connection)],
) -> PermissionRepository:
    return PermissionRepository(conn)


def get_category_repo(
    conn: Annotated[asyncpg.Connection, Depends(database.get_connection)],
) -> CategoryRepository:
    return CategoryRepository(conn)


def get_tag_repo(
    conn: Annotated[asyncpg.Connection, Depends(database.get_connection)],
) -> TagRepository:
    return TagRepository(conn)


def get_expense_repo(
    conn: Annotated[asyncpg.Connection, Depends(database.get_connection)],
) -> ExpenseRepository:
    return ExpenseRepository(conn)


def get_budget_plan_repo(
    conn: Annotated[asyncpg.Connection, Depends(database.get_connection)],
) -> BudgetPlanRepository:
    return BudgetPlanRepository(conn)


def get_user_service(
    user_repo: Annotated[UserRepository, Depends(get_user_repo)],
) -> UserService:
    return UserService(user_repo)


def get_category_service(
    category_repo: Annotated[CategoryRepository, Depends(get_category_repo)],
) -> CategoryService:
    return CategoryService(category_repo)


def get_permission_service(
    permission_repo: Annotated[PermissionRepository, Depends(get_permission_repo)],
    user_repo: Annotated[UserRepository, Depends(get_user_repo)],
) -> PermissionService:
    return PermissionService(permission_repo, user_repo)


def get_tag_service(
    tag_repo: Annotated[TagRepository, Depends(get_tag_repo)],
) -> TagService:
    return TagService(tag_repo)


@lru_cache
def _http_client() -> httpx.AsyncClient:
    """One shared client for the process lifetime (mirrors config.get_settings'
    lru_cache singleton pattern). Closed via close_http_client() in main.py's
    lifespan, same as database.py's pool."""
    return httpx.AsyncClient()


async def close_http_client() -> None:
    if _http_client.cache_info().currsize:
        await _http_client().aclose()
        _http_client.cache_clear()


def get_notification_service() -> NotificationService:
    return NotificationService(get_settings().bot_token, _http_client())


def get_expense_service(
    expense_repo: Annotated[ExpenseRepository, Depends(get_expense_repo)],
    budget_plan_repo: Annotated[BudgetPlanRepository, Depends(get_budget_plan_repo)],
    category_repo: Annotated[CategoryRepository, Depends(get_category_repo)],
    tag_repo: Annotated[TagRepository, Depends(get_tag_repo)],
    user_repo: Annotated[UserRepository, Depends(get_user_repo)],
    notification_service: Annotated[NotificationService, Depends(get_notification_service)],
) -> ExpenseService:
    return ExpenseService(
        expense_repo, budget_plan_repo, category_repo, tag_repo, user_repo, notification_service
    )


def get_budget_service(
    budget_plan_repo: Annotated[BudgetPlanRepository, Depends(get_budget_plan_repo)],
    expense_repo: Annotated[ExpenseRepository, Depends(get_expense_repo)],
    category_repo: Annotated[CategoryRepository, Depends(get_category_repo)],
) -> BudgetService:
    return BudgetService(budget_plan_repo, expense_repo, category_repo)


def get_statistics_service(
    expense_repo: Annotated[ExpenseRepository, Depends(get_expense_repo)],
) -> StatisticsService:
    return StatisticsService(expense_repo, get_settings().family_tz)


def _unauthorized(detail: str) -> HTTPException:
    return HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail=detail)


async def verify_internal_token(
    x_internal_token: Annotated[str | None, Header(alias="X-Internal-Token")] = None,
) -> None:
    """Reject any request that does not carry the shared bot→backend secret (D1)."""
    expected = get_settings().internal_token
    if x_internal_token is None or not secrets.compare_digest(
        x_internal_token.encode(), expected.encode()
    ):
        raise _unauthorized("Invalid or missing X-Internal-Token")


async def get_current_user(
    _token: Annotated[None, Depends(verify_internal_token)],
    user_repo: Annotated[UserRepository, Depends(get_user_repo)],
    x_telegram_user_id: Annotated[str | None, Header(alias="X-Telegram-User-Id")] = None,
) -> UserResponse:
    """Step 1: resolve the caller from ``X-Telegram-User-Id``, else 401.

    The header is declared ``str`` and parsed by hand: letting FastAPI coerce
    to ``int`` would turn a malformed header into a 422 instead of a 401.
    """
    if x_telegram_user_id is None:
        raise _unauthorized("Missing X-Telegram-User-Id")
    try:
        tg_id = int(x_telegram_user_id)
    except ValueError:
        raise _unauthorized("Malformed X-Telegram-User-Id") from None
    users = await user_repo.list(tg_id=tg_id)
    if not users:
        raise _unauthorized("Unknown user")
    return users[0]


async def require_admin(
    user: Annotated[UserResponse, Depends(get_current_user)],
) -> UserResponse:
    """Admin-only gate for the ``users``/``permissions`` resources (D27).

    Those two resources have no override-row semantics in the matrix (admin:
    CRUD, everyone else: none) and aren't in the ``Resource`` enum, so
    :class:`PermissionChecker` doesn't apply here — this is a plain role
    check instead of extending that contract.
    """
    if user.role is not Role.ADMIN:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Admin role required")
    return user


@dataclass(frozen=True, slots=True)
class PermissionDecision:
    allowed: bool
    own_only: bool = False


def resolve_permission(
    role: Role,
    resource: Resource,
    action: Action,
    permission: PermissionResponse | None,
) -> PermissionDecision:
    """Steps 2–5 of the enforcement order.

    ``permission`` is the (user, resource) override row, if any. Step 3 comes
    before step 4 by design: a viewer can never be granted writes by an
    override row (though a row may still *restrict* a viewer's reads).
    """
    if role is Role.ADMIN:
        return PermissionDecision(allowed=True)
    if role is Role.VIEWER and action is not Action.READ:
        return PermissionDecision(allowed=False)
    if permission is not None:
        allowed = {
            Action.CREATE: permission.can_create,
            Action.READ: permission.can_read,
            Action.UPDATE: permission.can_update,
            Action.DELETE: permission.can_delete,
        }[action]
        return PermissionDecision(allowed=allowed, own_only=permission.own_only)
    if role is Role.MEMBER:
        if resource is Resource.EXPENSES:
            # Default matrix: C · R · U(own) · D(own) — create/read unrestricted.
            return PermissionDecision(
                allowed=True, own_only=action in (Action.UPDATE, Action.DELETE)
            )
        return PermissionDecision(allowed=action is Action.READ)
    if role is Role.VIEWER:
        return PermissionDecision(allowed=True)  # read — writes were denied at step 3
    # Fail closed: users.role has no DB CHECK constraint, so a role value this
    # function doesn't recognize must be denied, not allowed.
    return PermissionDecision(allowed=False)


def enforce_ownership(decision: PermissionDecision, user: UserResponse, owner_id: UUID) -> None:
    """Step 6: an ``own_only`` grant does not extend to another user's record."""
    if decision.own_only and owner_id != user.id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Not allowed to act on another user's record",
        )


class PermissionChecker:
    """Route dependency enforcing the permission matrix for one (resource, action).

    Usage: ``user: UserResponse = Depends(PermissionChecker("expenses", "create"))``.
    Returns the authenticated user on allow, raises 403 on deny, and stores the
    :class:`PermissionDecision` on ``request.state.permission_decision`` so the
    route/service can apply step 6 once the target record is known.
    """

    def __init__(self, resource: Resource | str, action: Action | str) -> None:
        self.resource = Resource(resource)
        self.action = Action(action)

    async def __call__(
        self,
        request: Request,
        user: Annotated[UserResponse, Depends(get_current_user)],
        permission_repo: Annotated[PermissionRepository, Depends(get_permission_repo)],
    ) -> UserResponse:
        permission = await permission_repo.get_by_user_and_resource(user.id, self.resource)
        decision = resolve_permission(user.role, self.resource, self.action, permission)
        if not decision.allowed:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=f"Not allowed to {self.action.value} {self.resource.value}",
            )
        request.state.permission_decision = decision
        return user
