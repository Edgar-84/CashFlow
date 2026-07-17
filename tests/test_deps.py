"""Tests for api/deps.py — auth (401s) and the 6-step permission enforcement order.

Hermetic: repositories are replaced with in-memory fakes via
``app.dependency_overrides`` — no DB, no network (tests/CLAUDE.md).
"""

from collections.abc import AsyncIterator
from datetime import UTC, datetime
from typing import Annotated, Any
from uuid import UUID, uuid4

import pytest
from fastapi import Depends, FastAPI, HTTPException, Request
from httpx import ASGITransport, AsyncClient

from api import deps
from api.deps import (
    PermissionChecker,
    PermissionDecision,
    enforce_ownership,
    resolve_permission,
)
from config import get_settings
from models.enums import Action, Resource, Role
from models.permission import PermissionResponse
from models.user import UserResponse

# --- helpers -----------------------------------------------------------------


def make_user(role: Role, tg_id: int = 100) -> UserResponse:
    return UserResponse(
        id=uuid4(),
        tg_id=tg_id,
        name=f"{role.value}-user",
        role=role,
        account_id=uuid4(),
        created_at=datetime.now(UTC),
    )


def make_permission_row(
    user_id: UUID,
    resource: Resource,
    *,
    can_create: bool = False,
    can_read: bool = True,
    can_update: bool = False,
    can_delete: bool = False,
    own_only: bool = True,
) -> PermissionResponse:
    return PermissionResponse(
        id=uuid4(),
        user_id=user_id,
        resource=resource,
        can_create=can_create,
        can_read=can_read,
        can_update=can_update,
        can_delete=can_delete,
        own_only=own_only,
    )


class FakeUserRepo:
    def __init__(self, users: list[UserResponse]) -> None:
        self._users = users

    async def list(self, **filters: Any) -> list[UserResponse]:
        return [u for u in self._users if u.tg_id == filters.get("tg_id")]


class FakePermissionRepo:
    def __init__(self, rows: list[PermissionResponse]) -> None:
        self._rows = {(row.user_id, row.resource): row for row in rows}

    async def get_by_user_and_resource(
        self, user_id: UUID, resource: Resource
    ) -> PermissionResponse | None:
        return self._rows.get((user_id, resource))


# --- steps 2–5: full default matrix (3 roles × 4 resources × 4 actions) ------

# Every cell written out explicitly (plan: "do not hand-wave any cell").
# (role, resource, action, expected_allowed, expected_own_only)
DEFAULT_MATRIX = [
    # admin: full CRUD everywhere, never own_only-restricted (step 2)
    (Role.ADMIN, Resource.EXPENSES, Action.CREATE, True, False),
    (Role.ADMIN, Resource.EXPENSES, Action.READ, True, False),
    (Role.ADMIN, Resource.EXPENSES, Action.UPDATE, True, False),
    (Role.ADMIN, Resource.EXPENSES, Action.DELETE, True, False),
    (Role.ADMIN, Resource.CATEGORIES, Action.CREATE, True, False),
    (Role.ADMIN, Resource.CATEGORIES, Action.READ, True, False),
    (Role.ADMIN, Resource.CATEGORIES, Action.UPDATE, True, False),
    (Role.ADMIN, Resource.CATEGORIES, Action.DELETE, True, False),
    (Role.ADMIN, Resource.TAGS, Action.CREATE, True, False),
    (Role.ADMIN, Resource.TAGS, Action.READ, True, False),
    (Role.ADMIN, Resource.TAGS, Action.UPDATE, True, False),
    (Role.ADMIN, Resource.TAGS, Action.DELETE, True, False),
    (Role.ADMIN, Resource.BUDGET_PLANS, Action.CREATE, True, False),
    (Role.ADMIN, Resource.BUDGET_PLANS, Action.READ, True, False),
    (Role.ADMIN, Resource.BUDGET_PLANS, Action.UPDATE, True, False),
    (Role.ADMIN, Resource.BUDGET_PLANS, Action.DELETE, True, False),
    # member on expenses: C · R · U(own) · D(own)
    (Role.MEMBER, Resource.EXPENSES, Action.CREATE, True, False),
    (Role.MEMBER, Resource.EXPENSES, Action.READ, True, False),
    (Role.MEMBER, Resource.EXPENSES, Action.UPDATE, True, True),
    (Role.MEMBER, Resource.EXPENSES, Action.DELETE, True, True),
    # member on categories/tags/budget_plans: read-only
    (Role.MEMBER, Resource.CATEGORIES, Action.CREATE, False, False),
    (Role.MEMBER, Resource.CATEGORIES, Action.READ, True, False),
    (Role.MEMBER, Resource.CATEGORIES, Action.UPDATE, False, False),
    (Role.MEMBER, Resource.CATEGORIES, Action.DELETE, False, False),
    (Role.MEMBER, Resource.TAGS, Action.CREATE, False, False),
    (Role.MEMBER, Resource.TAGS, Action.READ, True, False),
    (Role.MEMBER, Resource.TAGS, Action.UPDATE, False, False),
    (Role.MEMBER, Resource.TAGS, Action.DELETE, False, False),
    (Role.MEMBER, Resource.BUDGET_PLANS, Action.CREATE, False, False),
    (Role.MEMBER, Resource.BUDGET_PLANS, Action.READ, True, False),
    (Role.MEMBER, Resource.BUDGET_PLANS, Action.UPDATE, False, False),
    (Role.MEMBER, Resource.BUDGET_PLANS, Action.DELETE, False, False),
    # viewer: read-only everywhere (step 3)
    (Role.VIEWER, Resource.EXPENSES, Action.CREATE, False, False),
    (Role.VIEWER, Resource.EXPENSES, Action.READ, True, False),
    (Role.VIEWER, Resource.EXPENSES, Action.UPDATE, False, False),
    (Role.VIEWER, Resource.EXPENSES, Action.DELETE, False, False),
    (Role.VIEWER, Resource.CATEGORIES, Action.CREATE, False, False),
    (Role.VIEWER, Resource.CATEGORIES, Action.READ, True, False),
    (Role.VIEWER, Resource.CATEGORIES, Action.UPDATE, False, False),
    (Role.VIEWER, Resource.CATEGORIES, Action.DELETE, False, False),
    (Role.VIEWER, Resource.TAGS, Action.CREATE, False, False),
    (Role.VIEWER, Resource.TAGS, Action.READ, True, False),
    (Role.VIEWER, Resource.TAGS, Action.UPDATE, False, False),
    (Role.VIEWER, Resource.TAGS, Action.DELETE, False, False),
    (Role.VIEWER, Resource.BUDGET_PLANS, Action.CREATE, False, False),
    (Role.VIEWER, Resource.BUDGET_PLANS, Action.READ, True, False),
    (Role.VIEWER, Resource.BUDGET_PLANS, Action.UPDATE, False, False),
    (Role.VIEWER, Resource.BUDGET_PLANS, Action.DELETE, False, False),
]


@pytest.mark.parametrize(
    ("role", "resource", "action", "expected_allowed", "expected_own_only"),
    DEFAULT_MATRIX,
    ids=[f"{r.value}-{res.value}-{a.value}" for r, res, a, _, _ in DEFAULT_MATRIX],
)
def test_default_matrix(
    role: Role,
    resource: Resource,
    action: Action,
    expected_allowed: bool,
    expected_own_only: bool,
) -> None:
    decision = resolve_permission(role, resource, action, permission=None)

    assert decision.allowed is expected_allowed
    assert decision.own_only is expected_own_only


# --- step 4: override rows ----------------------------------------------------


def test_override_row_widens_member_defaults() -> None:
    user = make_user(Role.MEMBER)
    row = make_permission_row(
        user.id,
        Resource.CATEGORIES,
        can_create=True,
        can_update=True,
        can_delete=True,
        own_only=False,
    )

    for action in (Action.CREATE, Action.READ, Action.UPDATE, Action.DELETE):
        decision = resolve_permission(Role.MEMBER, Resource.CATEGORIES, action, row)
        assert decision == PermissionDecision(allowed=True, own_only=False)


def test_override_row_narrows_member_defaults() -> None:
    # A row replaces the defaults entirely: member loses default expense create.
    user = make_user(Role.MEMBER)
    row = make_permission_row(
        user.id, Resource.EXPENSES, can_create=False, can_update=True, own_only=False
    )

    assert resolve_permission(Role.MEMBER, Resource.EXPENSES, Action.CREATE, row).allowed is False
    assert resolve_permission(Role.MEMBER, Resource.EXPENSES, Action.UPDATE, row) == (
        PermissionDecision(allowed=True, own_only=False)
    )


def test_override_row_own_only_flag_carries_into_decision() -> None:
    user = make_user(Role.MEMBER)
    row = make_permission_row(user.id, Resource.EXPENSES, can_update=True, own_only=True)

    decision = resolve_permission(Role.MEMBER, Resource.EXPENSES, Action.UPDATE, row)

    assert decision == PermissionDecision(allowed=True, own_only=True)


def test_admin_ignores_override_row() -> None:
    # Step 2 precedes step 4: even an all-False row cannot restrict an admin.
    user = make_user(Role.ADMIN)
    row = make_permission_row(
        user.id, Resource.EXPENSES, can_create=False, can_read=False, own_only=True
    )

    for action in (Action.CREATE, Action.READ, Action.UPDATE, Action.DELETE):
        # Full-decision equality: the row's own_only=True must not leak through
        # either, or admins would become ownership-restricted at step 6.
        assert resolve_permission(Role.ADMIN, Resource.EXPENSES, action, row) == (
            PermissionDecision(allowed=True, own_only=False)
        )


def test_viewer_cannot_be_overridden_to_write() -> None:
    # Step 3 precedes step 4: an all-True row never grants a viewer writes.
    user = make_user(Role.VIEWER)
    row = make_permission_row(
        user.id,
        Resource.EXPENSES,
        can_create=True,
        can_update=True,
        can_delete=True,
        own_only=False,
    )

    for action in (Action.CREATE, Action.UPDATE, Action.DELETE):
        assert resolve_permission(Role.VIEWER, Resource.EXPENSES, action, row).allowed is False
    assert resolve_permission(Role.VIEWER, Resource.EXPENSES, Action.READ, row).allowed is True


def test_viewer_read_can_be_restricted_by_row() -> None:
    # Step 3 only blocks writes; a row's flags still apply to a viewer's reads.
    user = make_user(Role.VIEWER)
    row = make_permission_row(user.id, Resource.EXPENSES, can_read=False)

    assert resolve_permission(Role.VIEWER, Resource.EXPENSES, Action.READ, row).allowed is False


# --- step 6: own_only vs. target-record owner ---------------------------------


def test_enforce_ownership_denies_foreign_record_when_own_only() -> None:
    user = make_user(Role.MEMBER)
    decision = PermissionDecision(allowed=True, own_only=True)

    with pytest.raises(HTTPException) as exc_info:
        enforce_ownership(decision, user, owner_id=uuid4())
    assert exc_info.value.status_code == 403


def test_enforce_ownership_allows_own_record_when_own_only() -> None:
    user = make_user(Role.MEMBER)
    decision = PermissionDecision(allowed=True, own_only=True)

    enforce_ownership(decision, user, owner_id=user.id)  # must not raise


def test_enforce_ownership_allows_foreign_record_when_not_own_only() -> None:
    user = make_user(Role.MEMBER)
    decision = PermissionDecision(allowed=True, own_only=False)

    enforce_ownership(decision, user, owner_id=uuid4())  # must not raise


# --- HTTP surface: token + header 401s, checker wiring ------------------------


def build_app(users: list[UserResponse], rows: list[PermissionResponse]) -> FastAPI:
    app = FastAPI()

    read_checker = PermissionChecker(Resource.EXPENSES, Action.READ)
    # String form — the documented route-pattern contract (api/CLAUDE.md).
    create_checker = PermissionChecker("expenses", "create")
    update_checker = PermissionChecker(Resource.EXPENSES, Action.UPDATE)

    @app.get("/expenses")
    async def read_expenses(
        user: Annotated[UserResponse, Depends(read_checker)],
    ) -> dict[str, str]:
        return {"user_id": str(user.id)}

    @app.post("/expenses")
    async def create_expense(
        user: Annotated[UserResponse, Depends(create_checker)],
    ) -> dict[str, str]:
        return {"user_id": str(user.id)}

    @app.put("/expenses/some-id")
    async def update_expense(
        request: Request,
        user: Annotated[UserResponse, Depends(update_checker)],
    ) -> dict[str, bool]:
        decision: PermissionDecision = request.state.permission_decision
        return {"own_only": decision.own_only}

    app.dependency_overrides[deps.get_user_repo] = lambda: FakeUserRepo(users)
    app.dependency_overrides[deps.get_permission_repo] = lambda: FakePermissionRepo(rows)
    return app


@pytest.fixture
def member() -> UserResponse:
    return make_user(Role.MEMBER, tg_id=100)


@pytest.fixture
def viewer() -> UserResponse:
    return make_user(Role.VIEWER, tg_id=200)


@pytest.fixture
async def http_client(member: UserResponse, viewer: UserResponse) -> AsyncIterator[AsyncClient]:
    app = build_app(
        users=[member, viewer],
        rows=[make_permission_row(viewer.id, Resource.CATEGORIES)],
    )
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        yield client


def auth_headers(tg_id: int) -> dict[str, str]:
    # Token read from settings, not hardcoded: CI may export a real INTERNAL_TOKEN
    # that the conftest env fixture deliberately does not override (D13).
    return {
        "X-Internal-Token": get_settings().internal_token,
        "X-Telegram-User-Id": str(tg_id),
    }


async def test_missing_internal_token_is_401(http_client: AsyncClient) -> None:
    response = await http_client.get("/expenses", headers={"X-Telegram-User-Id": "100"})

    assert response.status_code == 401


async def test_wrong_internal_token_is_401(http_client: AsyncClient) -> None:
    headers = auth_headers(100) | {"X-Internal-Token": "wrong-token"}

    response = await http_client.get("/expenses", headers=headers)

    assert response.status_code == 401


async def test_missing_tg_id_header_is_401(http_client: AsyncClient) -> None:
    response = await http_client.get(
        "/expenses", headers={"X-Internal-Token": get_settings().internal_token}
    )

    assert response.status_code == 401


async def test_malformed_tg_id_header_is_401(http_client: AsyncClient) -> None:
    headers = auth_headers(100) | {"X-Telegram-User-Id": "not-a-number"}

    response = await http_client.get("/expenses", headers=headers)

    assert response.status_code == 401


async def test_unknown_tg_id_is_401(http_client: AsyncClient) -> None:
    response = await http_client.get("/expenses", headers=auth_headers(999))

    assert response.status_code == 401


async def test_member_can_read_expenses(http_client: AsyncClient, member: UserResponse) -> None:
    response = await http_client.get("/expenses", headers=auth_headers(100))

    assert response.status_code == 200
    assert response.json() == {"user_id": str(member.id)}


async def test_viewer_create_is_403(http_client: AsyncClient) -> None:
    response = await http_client.post("/expenses", headers=auth_headers(200))

    assert response.status_code == 403


async def test_checker_exposes_own_only_decision_on_request_state(
    http_client: AsyncClient,
) -> None:
    # Member updating an expense: allowed, but own_only per the default matrix —
    # the route (U2.4) reads the decision off request.state for step 6.
    response = await http_client.put("/expenses/some-id", headers=auth_headers(100))

    assert response.status_code == 200
    assert response.json() == {"own_only": True}


async def test_checker_consults_permission_row(member: UserResponse, viewer: UserResponse) -> None:
    # A row denying reads on expenses turns the member's default allow into a 403.
    app = build_app(
        users=[member, viewer],
        rows=[make_permission_row(member.id, Resource.EXPENSES, can_read=False)],
    )
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        response = await client.get("/expenses", headers=auth_headers(100))

    assert response.status_code == 403


def test_permission_checker_accepts_enum_and_string_forms() -> None:
    from_strings = PermissionChecker("expenses", "create")
    from_enums = PermissionChecker(Resource.EXPENSES, Action.CREATE)

    assert from_strings.resource is from_enums.resource is Resource.EXPENSES
    assert from_strings.action is from_enums.action is Action.CREATE
