"""Unit tests for services/notification_service.py — fake httpx transport, no
real network (tests/CLAUDE.md, U3.1 AC)."""

import json
import logging
from datetime import UTC, datetime
from uuid import uuid4

import httpx
import pytest

from models.category import CategoryResponse
from models.enums import Role
from models.user import UserResponse
from services.notification_service import NotificationService


def make_user(tg_id: int = 12345) -> UserResponse:
    return UserResponse(
        id=uuid4(),
        tg_id=tg_id,
        name="Member",
        role=Role.MEMBER,
        account_id=uuid4(),
        created_at=datetime.now(UTC),
    )


def make_category(name: str = "Groceries") -> CategoryResponse:
    return CategoryResponse(id=uuid4(), name=name, account_id=uuid4(), created_at=datetime.now(UTC))


async def test_send_posts_to_telegram_bot_api_with_chat_id_and_text() -> None:
    requests: list[httpx.Request] = []

    def handler(request: httpx.Request) -> httpx.Response:
        requests.append(request)
        return httpx.Response(200, json={"ok": True})

    client = httpx.AsyncClient(transport=httpx.MockTransport(handler))
    service = NotificationService("test-token", client)
    user = make_user(tg_id=555)
    category = make_category("Groceries")

    await service.send(user, category, 85.0)

    assert len(requests) == 1
    assert requests[0].url.path == "/bottest-token/sendMessage"
    payload = json.loads(requests[0].content)
    assert payload["chat_id"] == 555
    assert "Groceries" in payload["text"]
    assert "85" in payload["text"]


async def test_send_swallows_connection_error_without_raising() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        raise httpx.ConnectError("boom", request=request)

    client = httpx.AsyncClient(transport=httpx.MockTransport(handler))
    service = NotificationService("test-token", client)

    await service.send(make_user(), make_category(), 90.0)  # must not raise


async def test_send_swallows_http_status_error_without_raising() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(500, json={"ok": False})

    client = httpx.AsyncClient(transport=httpx.MockTransport(handler))
    service = NotificationService("test-token", client)

    await service.send(make_user(), make_category(), 90.0)  # must not raise


async def test_send_on_http_status_error_never_logs_the_bot_token(
    caplog: pytest.LogCaptureFixture,
) -> None:
    # Regression: httpx.HTTPStatusError's own message embeds the full request
    # URL (which contains the live bot token, /bot{token}/sendMessage) —
    # logging `exc`/`str(exc)` directly would leak it. Only structured,
    # token-free fields may reach the log.
    secret_token = "123456:super-secret-token"

    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(500, json={"ok": False})

    client = httpx.AsyncClient(transport=httpx.MockTransport(handler))
    service = NotificationService(secret_token, client)

    with caplog.at_level(logging.ERROR, logger="services.notification_service"):
        await service.send(make_user(), make_category(), 90.0)

    for record in caplog.records:
        assert secret_token not in record.getMessage()
        assert secret_token not in str(record.exc_info)


async def test_send_logs_on_failure(caplog: pytest.LogCaptureFixture) -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        raise httpx.ConnectError("boom", request=request)

    client = httpx.AsyncClient(transport=httpx.MockTransport(handler))
    service = NotificationService("test-token", client)

    with caplog.at_level(logging.ERROR, logger="services.notification_service"):
        await service.send(make_user(), make_category(), 90.0)

    assert any(r.levelno == logging.ERROR for r in caplog.records)
