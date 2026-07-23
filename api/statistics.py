from datetime import datetime
from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Request, status

from api.deps import PermissionChecker, get_statistics_service
from models.enums import Action, Resource
from models.statistics import CategoryTotal, PeriodTotal, TagTotal
from models.user import UserResponse
from services.statistics_service import StatisticsService

router = APIRouter(prefix="/statistics", tags=["statistics"])


def _own_user_id(request: Request, user: UserResponse) -> UUID | None:
    """Statistics has no Resource enum entry of its own — gated by
    PermissionChecker(Resource.EXPENSES, Action.READ) since it's a derived view
    over expense data (plan Decision log D35). Mirrors D33's `list_expenses`:
    restrict to the caller's own expenses when the resolved decision has
    `own_only` set (an override permission row can set this on expense reads,
    not just the default matrix)."""
    decision = request.state.permission_decision
    return user.id if decision.own_only else None


def _validate_period(start: datetime | None, end: datetime | None) -> None:
    """Both bounds are optional independently (Contracts), but if both are
    given they must describe a non-empty window (plan Decision log D106)."""
    if start is not None and end is not None and start >= end:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT, detail="start must be before end"
        )


@router.get("/by-period", response_model=PeriodTotal)
async def get_statistics_by_period(
    request: Request,
    user: Annotated[UserResponse, Depends(PermissionChecker(Resource.EXPENSES, Action.READ))],
    service: Annotated[StatisticsService, Depends(get_statistics_service)],
    start: datetime | None = None,
    end: datetime | None = None,
    category_id: UUID | None = None,
    tag_id: UUID | None = None,
) -> PeriodTotal:
    _validate_period(start, end)
    return await service.by_period(
        user.account_id,
        user_id=_own_user_id(request, user),
        start=start,
        end=end,
        category_id=category_id,
        tag_id=tag_id,
    )


@router.get("/by-category", response_model=list[CategoryTotal])
async def get_statistics_by_category(
    request: Request,
    user: Annotated[UserResponse, Depends(PermissionChecker(Resource.EXPENSES, Action.READ))],
    service: Annotated[StatisticsService, Depends(get_statistics_service)],
    start: datetime | None = None,
    end: datetime | None = None,
) -> list[CategoryTotal]:
    _validate_period(start, end)
    return await service.by_category(
        user.account_id, user_id=_own_user_id(request, user), start=start, end=end
    )


@router.get("/by-tag", response_model=list[TagTotal])
async def get_statistics_by_tag(
    request: Request,
    user: Annotated[UserResponse, Depends(PermissionChecker(Resource.EXPENSES, Action.READ))],
    service: Annotated[StatisticsService, Depends(get_statistics_service)],
    start: datetime | None = None,
    end: datetime | None = None,
) -> list[TagTotal]:
    _validate_period(start, end)
    return await service.by_tag(
        user.account_id, user_id=_own_user_id(request, user), start=start, end=end
    )
