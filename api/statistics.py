from datetime import date, datetime
from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, Request, status

from api.deps import PermissionChecker, get_statistics_service
from api.period_params import validate_period_params
from models.enums import Action, PeriodUnit, Resource
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


@router.get("/by-period", response_model=PeriodTotal)
async def get_statistics_by_period(
    request: Request,
    user: Annotated[UserResponse, Depends(PermissionChecker(Resource.EXPENSES, Action.READ))],
    service: Annotated[StatisticsService, Depends(get_statistics_service)],
    start: datetime | None = None,
    end: datetime | None = None,
    months_back: Annotated[int | None, Query(ge=0, le=2)] = None,
    period: PeriodUnit | None = None,
    offset: Annotated[int, Query(le=0)] = 0,
    start_date: date | None = None,
    end_date: date | None = None,
    category_id: UUID | None = None,
    tag_id: UUID | None = None,
) -> PeriodTotal:
    validate_period_params(
        start=start,
        end=end,
        months_back=months_back,
        period=period,
        offset=offset,
        start_date=start_date,
        end_date=end_date,
    )
    try:
        return await service.by_period(
            user.account_id,
            user_id=_own_user_id(request, user),
            start=start,
            end=end,
            months_back=months_back,
            period=period,
            offset=offset,
            start_date=start_date,
            end_date=end_date,
            category_id=category_id,
            tag_id=tag_id,
        )
    except ValueError as exc:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT, detail=str(exc)
        ) from exc


@router.get("/by-category", response_model=list[CategoryTotal])
async def get_statistics_by_category(
    request: Request,
    user: Annotated[UserResponse, Depends(PermissionChecker(Resource.EXPENSES, Action.READ))],
    service: Annotated[StatisticsService, Depends(get_statistics_service)],
    start: datetime | None = None,
    end: datetime | None = None,
    months_back: Annotated[int | None, Query(ge=0, le=2)] = None,
    period: PeriodUnit | None = None,
    offset: Annotated[int, Query(le=0)] = 0,
    start_date: date | None = None,
    end_date: date | None = None,
) -> list[CategoryTotal]:
    validate_period_params(
        start=start,
        end=end,
        months_back=months_back,
        period=period,
        offset=offset,
        start_date=start_date,
        end_date=end_date,
    )
    try:
        return await service.by_category(
            user.account_id,
            user_id=_own_user_id(request, user),
            start=start,
            end=end,
            months_back=months_back,
            period=period,
            offset=offset,
            start_date=start_date,
            end_date=end_date,
        )
    except ValueError as exc:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT, detail=str(exc)
        ) from exc


@router.get("/by-tag", response_model=list[TagTotal])
async def get_statistics_by_tag(
    request: Request,
    user: Annotated[UserResponse, Depends(PermissionChecker(Resource.EXPENSES, Action.READ))],
    service: Annotated[StatisticsService, Depends(get_statistics_service)],
    start: datetime | None = None,
    end: datetime | None = None,
    months_back: Annotated[int | None, Query(ge=0, le=2)] = None,
    period: PeriodUnit | None = None,
    offset: Annotated[int, Query(le=0)] = 0,
    start_date: date | None = None,
    end_date: date | None = None,
) -> list[TagTotal]:
    validate_period_params(
        start=start,
        end=end,
        months_back=months_back,
        period=period,
        offset=offset,
        start_date=start_date,
        end_date=end_date,
    )
    try:
        return await service.by_tag(
            user.account_id,
            user_id=_own_user_id(request, user),
            start=start,
            end=end,
            months_back=months_back,
            period=period,
            offset=offset,
            start_date=start_date,
            end_date=end_date,
        )
    except ValueError as exc:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT, detail=str(exc)
        ) from exc
