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

import hashlib
import hmac
import json
import secrets
import time
from dataclasses import dataclass
from datetime import UTC, date, datetime
from functools import lru_cache
from typing import Annotated
from urllib.parse import parse_qsl
from uuid import UUID
from zoneinfo import ZoneInfo

import asyncpg
import httpx
from fastapi import Depends, Header, HTTPException, Request, status

import database
from config import get_settings
from models.enums import Action, Resource, Role
from models.permission import PermissionResponse
from models.user import UserMeResponse, UserResponse
from repositories.account_repo import AccountRepository
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


def get_account_repo(
    conn: Annotated[asyncpg.Connection, Depends(database.get_connection)],
) -> AccountRepository:
    return AccountRepository(conn)


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
        expense_repo,
        budget_plan_repo,
        category_repo,
        tag_repo,
        user_repo,
        notification_service,
        get_settings().family_tz,
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


def verify_internal_token(x_internal_token: str | None) -> None:
    """Reject any request that does not carry the shared bot→backend secret (D1)."""
    expected = get_settings().internal_token
    if x_internal_token is None or not secrets.compare_digest(
        x_internal_token.encode(), expected.encode()
    ):
        raise _unauthorized("Invalid or missing X-Internal-Token")


class InitDataError(Exception):
    """Raised by :func:`validate_init_data` on any invalid/tampered/expired payload."""


def validate_init_data(init_data: str, bot_token: str, max_age_sec: int) -> int:
    """Verify a Telegram Mini App ``initData`` payload and return the tg_id.

    Per Telegram's spec, the HMAC key is ``HMAC_SHA256(key=b"WebAppData",
    msg=bot_token)`` — not the bot token directly — and the data-check string
    is the sorted ``k=v`` pairs (``hash`` removed) joined by ``\\n``.
    """
    try:
        data = dict(parse_qsl(init_data, strict_parsing=True))
    except ValueError:
        raise InitDataError("Malformed init_data") from None

    received_hash = data.pop("hash", None)
    if not received_hash:
        raise InitDataError("Missing hash")

    data_check_string = "\n".join(f"{k}={v}" for k, v in sorted(data.items()))
    secret_key = hmac.new(b"WebAppData", bot_token.encode(), hashlib.sha256).digest()
    computed_hash = hmac.new(secret_key, data_check_string.encode(), hashlib.sha256).hexdigest()
    if not hmac.compare_digest(computed_hash, received_hash):
        raise InitDataError("Invalid hash")

    try:
        auth_date = int(data["auth_date"])
    except (KeyError, ValueError):
        raise InitDataError("Missing or malformed auth_date") from None
    if time.time() - auth_date > max_age_sec:
        raise InitDataError("Expired init_data")

    try:
        tg_id = json.loads(data["user"])["id"]
    except (KeyError, ValueError, TypeError):
        raise InitDataError("Missing or malformed user field") from None
    return int(tg_id)


async def get_current_user(
    user_repo: Annotated[UserRepository, Depends(get_user_repo)],
    x_telegram_init_data: Annotated[str | None, Header(alias="X-Telegram-Init-Data")] = None,
    x_internal_token: Annotated[str | None, Header(alias="X-Internal-Token")] = None,
    x_telegram_user_id: Annotated[str | None, Header(alias="X-Telegram-User-Id")] = None,
) -> UserResponse:
    """Step 1: resolve the caller, else 401.

    Two accepted credentials, resolved in order:
    1. ``X-Telegram-Init-Data`` (Mini App) — validated via
       :func:`validate_init_data`, tg_id derived from the signed payload.
    2. ``X-Internal-Token`` + ``X-Telegram-User-Id`` (bot) — unchanged from
       before this was added. The header is declared ``str`` and parsed by
       hand: letting FastAPI coerce to ``int`` would turn a malformed header
       into a 422 instead of a 401.
    """
    if x_telegram_init_data is not None:
        settings = get_settings()
        try:
            tg_id = validate_init_data(
                x_telegram_init_data, settings.bot_token, settings.initdata_max_age_sec
            )
        except InitDataError:
            raise _unauthorized("Invalid X-Telegram-Init-Data") from None
    else:
        verify_internal_token(x_internal_token)
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


def _family_today(tz: str, now: datetime | None = None) -> date:
    """Today's wall-clock date in `tz` (U3.3) — mirrors
    `services/expense_service.py::_local_today`'s "localize, then take the
    date" rule; not imported from there since that function is private to
    its module (each layer keeps its own copy, same convention
    `services/period.py` and the webapp's date modules already follow).
    `now` is injectable for deterministic tests."""
    return (now or datetime.now(UTC)).astimezone(ZoneInfo(tz)).date()


async def get_current_user_with_currency(
    user: Annotated[UserResponse, Depends(get_current_user)],
    account_repo: Annotated[AccountRepository, Depends(get_account_repo)],
) -> UserMeResponse:
    """``GET /users/me`` only — adds the caller's account currency (D211),
    name (U0.2c) and today's date in `family_tz` (U3.3), all from the same
    account row / settings.

    ``account_id`` is FK-enforced NOT NULL, so the account always resolves.
    """
    account = await account_repo.get(user.account_id)
    assert account is not None
    today = _family_today(get_settings().family_tz)
    return UserMeResponse(
        **user.model_dump(), currency=account.currency, account_name=account.name, today=today
    )


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
