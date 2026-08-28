"""Tests for api/deps.py — auth (401s) and the 6-step permission enforcement order.

Hermetic: repositories are replaced with in-memory fakes via
``app.dependency_overrides`` — no DB, no network (tests/CLAUDE.md).
"""

import hashlib
import hmac
import json
import time
from collections.abc import AsyncIterator
from datetime import UTC, date, datetime
from typing import Annotated, Any
from urllib.parse import parse_qsl, urlencode
from uuid import UUID, uuid4

import pytest
from fastapi import Depends, FastAPI, HTTPException, Request
from httpx import ASGITransport, AsyncClient

from api import deps
from api.deps import (
    InitDataError,
    PermissionChecker,
    PermissionDecision,
    _family_today,
    enforce_ownership,
    require_admin,
    require_system_admin,
    resolve_permission,
    validate_init_data,
)
from config import get_settings
from models.account import AccountResponse
from models.enums import Action, Currency, Language, Resource, Role
from models.permission import PermissionResponse
from models.user import UserResponse

# --- _family_today (U3.3) -----------------------------------------------------


def test_family_today_resolves_in_the_given_timezone_not_utc() -> None:
    # 23:30 UTC on 2026-08-03 is already 2026-08-04 in Europe/Belgrade
    # (UTC+2 in August) — the exact D120 bug class this helper exists to
    # avoid: a naive UTC date would answer "today" wrong for `UserMeResponse`.
    now = datetime(2026, 8, 3, 23, 30, tzinfo=UTC)
    assert _family_today("Europe/Belgrade", now) == date(2026, 8, 4)
    assert _family_today("UTC", now) == date(2026, 8, 3)


# --- helpers -----------------------------------------------------------------


def make_user(role: Role, tg_id: int = 100, *, is_blocked: bool = False) -> UserResponse:
    return UserResponse(
        id=uuid4(),
        tg_id=tg_id,
        name=f"{role.value}-user",
        role=role,
        is_blocked=is_blocked,
        account_id=uuid4(),
        created_at=datetime.now(UTC),
    )


def make_account(account_id: UUID, *, is_blocked: bool = False) -> AccountResponse:
    return AccountResponse(
        id=account_id,
        name="Test Account",
        currency=Currency.USD,
        language=Language.EN,
        owner_id=None,
        is_blocked=is_blocked,
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


def build_init_data(bot_token: str, user_id: int, *, auth_date: int | None = None) -> str:
    """A validly signed ``initData`` query string, per Telegram's spec."""
    fields = {
        "auth_date": str(auth_date if auth_date is not None else int(time.time())),
        "query_id": "AAHtest",
        "user": json.dumps({"id": user_id}),
    }
    data_check_string = "\n".join(f"{k}={v}" for k, v in sorted(fields.items()))
    secret_key = hmac.new(b"WebAppData", bot_token.encode(), hashlib.sha256).digest()
    fields["hash"] = hmac.new(secret_key, data_check_string.encode(), hashlib.sha256).hexdigest()
    return urlencode(fields)


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


class FakeAccountRepo:
    def __init__(self, accounts: list[AccountResponse]) -> None:
        self._accounts = {a.id: a for a in accounts}

    async def get(self, account_id: UUID) -> AccountResponse | None:
        return self._accounts.get(account_id)


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
    # system_admin: full CRUD everywhere too, inside its own account (D712) —
    # same shape as admin, never own_only-restricted (step 2).
    (Role.SYSTEM_ADMIN, Resource.EXPENSES, Action.CREATE, True, False),
    (Role.SYSTEM_ADMIN, Resource.EXPENSES, Action.READ, True, False),
    (Role.SYSTEM_ADMIN, Resource.EXPENSES, Action.UPDATE, True, False),
    (Role.SYSTEM_ADMIN, Resource.EXPENSES, Action.DELETE, True, False),
    (Role.SYSTEM_ADMIN, Resource.CATEGORIES, Action.CREATE, True, False),
    (Role.SYSTEM_ADMIN, Resource.CATEGORIES, Action.READ, True, False),
    (Role.SYSTEM_ADMIN, Resource.CATEGORIES, Action.UPDATE, True, False),
    (Role.SYSTEM_ADMIN, Resource.CATEGORIES, Action.DELETE, True, False),
    (Role.SYSTEM_ADMIN, Resource.TAGS, Action.CREATE, True, False),
    (Role.SYSTEM_ADMIN, Resource.TAGS, Action.READ, True, False),
    (Role.SYSTEM_ADMIN, Resource.TAGS, Action.UPDATE, True, False),
    (Role.SYSTEM_ADMIN, Resource.TAGS, Action.DELETE, True, False),
    (Role.SYSTEM_ADMIN, Resource.BUDGET_PLANS, Action.CREATE, True, False),
    (Role.SYSTEM_ADMIN, Resource.BUDGET_PLANS, Action.READ, True, False),
    (Role.SYSTEM_ADMIN, Resource.BUDGET_PLANS, Action.UPDATE, True, False),
    (Role.SYSTEM_ADMIN, Resource.BUDGET_PLANS, Action.DELETE, True, False),
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


def test_system_admin_ignores_override_row() -> None:
    # Same step-2 shape as admin: a system admin behaves as admin inside its
    # own account (D712) — this resource matrix has no cross-account concept.
    user = make_user(Role.SYSTEM_ADMIN)
    row = make_permission_row(
        user.id, Resource.EXPENSES, can_create=False, can_read=False, own_only=True
    )

    for action in (Action.CREATE, Action.READ, Action.UPDATE, Action.DELETE):
        assert resolve_permission(Role.SYSTEM_ADMIN, Resource.EXPENSES, action, row) == (
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


# --- validate_init_data: HMAC per Telegram's initData spec --------------------


def test_validate_init_data_returns_tg_id_for_valid_payload() -> None:
    init_data = build_init_data("test-bot-token", user_id=555)

    assert validate_init_data(init_data, "test-bot-token", max_age_sec=86400) == 555


def test_validate_init_data_rejects_tampered_hash() -> None:
    init_data = build_init_data("test-bot-token", user_id=555)
    tampered = dict(parse_qsl(init_data))
    tampered["user"] = json.dumps({"id": 999})  # change payload, keep the original hash

    with pytest.raises(InitDataError):
        validate_init_data(urlencode(tampered), "test-bot-token", max_age_sec=86400)


def test_validate_init_data_rejects_expired_auth_date() -> None:
    stale_auth_date = int(time.time()) - 86400 - 60
    init_data = build_init_data("test-bot-token", user_id=555, auth_date=stale_auth_date)

    with pytest.raises(InitDataError):
        validate_init_data(init_data, "test-bot-token", max_age_sec=86400)


def test_validate_init_data_matches_independently_computed_vector() -> None:
    # Hardcoded, not built via build_init_data: the hash below was computed
    # out-of-band with `openssl dgst -sha256 -hmac` (two commands, not this
    # Python HMAC code path) against auth_date=1700000000, query_id=AAHtest,
    # user={"id": 42}. Catches a systematic error (e.g. swapped key/msg
    # order) that a self-consistent test built from the same code could not.
    bot_token = "123456:ABC-DEF1234ghIkl-zyx57W2v1u123ew11"
    init_data = (
        "auth_date=1700000000&query_id=AAHtest&user=%7B%22id%22%3A+42%7D"
        "&hash=6723e02845344c82bab96703f65c66351ad46ef62eb038229909e62603c605b9"
    )

    assert validate_init_data(init_data, bot_token, max_age_sec=10_000_000_000) == 42


def test_validate_init_data_rejects_wrong_bot_token() -> None:
    init_data = build_init_data("test-bot-token", user_id=555)

    with pytest.raises(InitDataError):
        validate_init_data(init_data, "some-other-bot-token", max_age_sec=86400)


# --- HTTP surface: token + header 401s, checker wiring ------------------------


def build_app(
    users: list[UserResponse],
    rows: list[PermissionResponse],
    accounts: list[AccountResponse],
) -> FastAPI:
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
    app.dependency_overrides[deps.get_account_repo] = lambda: FakeAccountRepo(accounts)
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
        accounts=[make_account(member.account_id), make_account(viewer.account_id)],
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


# --- block gate (D713): blocked user / blocked account ------------------------


async def test_blocked_user_is_403_not_401_via_header_pair() -> None:
    blocked = make_user(Role.MEMBER, tg_id=300, is_blocked=True)
    app = build_app(users=[blocked], rows=[], accounts=[make_account(blocked.account_id)])
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        response = await client.get("/expenses", headers=auth_headers(300))

    assert response.status_code == 403
    assert response.json()["detail"] == "User is suspended"


async def test_blocked_user_is_403_via_init_data() -> None:
    blocked = make_user(Role.MEMBER, tg_id=300, is_blocked=True)
    app = build_app(users=[blocked], rows=[], accounts=[make_account(blocked.account_id)])
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        response = await client.get("/expenses", headers=init_data_headers(300))

    assert response.status_code == 403
    assert response.json()["detail"] == "User is suspended"


async def test_user_in_blocked_account_is_403_even_though_user_is_not() -> None:
    user = make_user(Role.MEMBER, tg_id=400, is_blocked=False)
    app = build_app(
        users=[user], rows=[], accounts=[make_account(user.account_id, is_blocked=True)]
    )
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        response = await client.get("/expenses", headers=auth_headers(400))

    assert response.status_code == 403
    assert response.json()["detail"] == "Account is suspended"


async def test_user_in_blocked_account_is_403_via_init_data() -> None:
    user = make_user(Role.MEMBER, tg_id=400, is_blocked=False)
    app = build_app(
        users=[user], rows=[], accounts=[make_account(user.account_id, is_blocked=True)]
    )
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        response = await client.get("/expenses", headers=init_data_headers(400))

    assert response.status_code == 403
    assert response.json()["detail"] == "Account is suspended"


async def test_unblocked_user_in_unblocked_account_is_unaffected(
    http_client: AsyncClient, member: UserResponse
) -> None:
    # member/viewer fixtures and their accounts are both unblocked by default.
    response = await http_client.get("/expenses", headers=auth_headers(100))

    assert response.status_code == 200


# --- require_admin: system_admin admitted (U4.2) ------------------------------


async def test_require_admin_allows_admin() -> None:
    user = make_user(Role.ADMIN)

    assert await require_admin(user) is user


async def test_require_admin_allows_system_admin() -> None:
    user = make_user(Role.SYSTEM_ADMIN)

    assert await require_admin(user) is user


async def test_require_admin_denies_member() -> None:
    user = make_user(Role.MEMBER)

    with pytest.raises(HTTPException) as exc_info:
        await require_admin(user)
    assert exc_info.value.status_code == 403


# --- require_system_admin: system_admin only, not even a plain admin (U4.3) ---


async def test_require_system_admin_allows_system_admin() -> None:
    user = make_user(Role.SYSTEM_ADMIN)

    assert await require_system_admin(user) is user


async def test_require_system_admin_denies_admin() -> None:
    user = make_user(Role.ADMIN)

    with pytest.raises(HTTPException) as exc_info:
        await require_system_admin(user)
    assert exc_info.value.status_code == 403


async def test_require_system_admin_denies_member() -> None:
    user = make_user(Role.MEMBER)

    with pytest.raises(HTTPException) as exc_info:
        await require_system_admin(user)
    assert exc_info.value.status_code == 403


async def test_require_system_admin_denies_viewer() -> None:
    user = make_user(Role.VIEWER)

    with pytest.raises(HTTPException) as exc_info:
        await require_system_admin(user)
    assert exc_info.value.status_code == 403


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
        accounts=[make_account(member.account_id), make_account(viewer.account_id)],
    )
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        response = await client.get("/expenses", headers=auth_headers(100))

    assert response.status_code == 403


def init_data_headers(tg_id: int, **kwargs: Any) -> dict[str, str]:
    return {"X-Telegram-Init-Data": build_init_data(get_settings().bot_token, tg_id, **kwargs)}


async def test_init_data_valid_payload_resolves_user(
    http_client: AsyncClient, member: UserResponse
) -> None:
    # No X-Internal-Token sent at all: the initData path is a full substitute,
    # not an addition to the bot's header pair.
    response = await http_client.get("/expenses", headers=init_data_headers(100))

    assert response.status_code == 200
    assert response.json() == {"user_id": str(member.id)}


async def test_init_data_tampered_hash_is_401(http_client: AsyncClient) -> None:
    tampered = dict(parse_qsl(build_init_data(get_settings().bot_token, 100)))
    tampered["user"] = json.dumps({"id": 999})

    response = await http_client.get(
        "/expenses", headers={"X-Telegram-Init-Data": urlencode(tampered)}
    )

    assert response.status_code == 401


async def test_init_data_expired_is_401(http_client: AsyncClient) -> None:
    stale_auth_date = int(time.time()) - get_settings().initdata_max_age_sec - 60

    response = await http_client.get(
        "/expenses", headers=init_data_headers(100, auth_date=stale_auth_date)
    )

    assert response.status_code == 401


async def test_init_data_well_formed_but_unknown_tg_id_is_401(http_client: AsyncClient) -> None:
    response = await http_client.get("/expenses", headers=init_data_headers(999999))

    assert response.status_code == 401


async def test_init_data_produces_same_permission_decision_as_header_pair(
    http_client: AsyncClient,
) -> None:
    # Member updating an expense is allowed but own_only per the default matrix
    # (same case as test_checker_exposes_own_only_decision_on_request_state) —
    # both credential paths must resolve to the identical PermissionDecision.
    via_header = await http_client.put("/expenses/some-id", headers=auth_headers(100))
    via_init_data = await http_client.put("/expenses/some-id", headers=init_data_headers(100))

    assert via_header.status_code == via_init_data.status_code == 200
    assert via_header.json() == via_init_data.json() == {"own_only": True}


def test_permission_checker_accepts_enum_and_string_forms() -> None:
    from_strings = PermissionChecker("expenses", "create")
    from_enums = PermissionChecker(Resource.EXPENSES, Action.CREATE)

    assert from_strings.resource is from_enums.resource is Resource.EXPENSES
    assert from_strings.action is from_enums.action is Action.CREATE
