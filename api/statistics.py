from datetime import date, datetime
from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, Request, status

from api.deps import PermissionChecker, get_statistics_service
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


def _validate_period(
    *,
    start: datetime | None,
    end: datetime | None,
    months_back: int | None,
    period: PeriodUnit | None,
    offset: int,
    start_date: date | None,
    end_date: date | None,
) -> None:
    """At most one selector family per request (Contracts, plan Decision log
    D313): `{period + offset}` · `{period=custom + start_date/end_date}` ·
    `{months_back}` · `{start/end}`. Both bounds of `start`/`end` are optional
    independently, but if both are given they must describe a non-empty
    window (plan Decision log D106).

    Range/shape errors specific to `period` — missing `start_date`/`end_date`
    under `period=custom`, `offset` combined with `period=custom`,
    `start_date > end_date` — are left to `resolve_period`; its `ValueError`
    is mapped to 422 by the routes below. This function only rejects
    combinations `resolve_period` never sees: cross-family conflicts, and
    `offset`/`start_date`/`end_date` used without the `period` they require.
    """
    period_selector_used = (
        period is not None or offset != 0 or start_date is not None or end_date is not None
    )
    families_used = sum(
        [period_selector_used, months_back is not None, start is not None or end is not None]
    )
    if families_used > 1:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail="at most one of period/offset, months_back, or start/end may be given",
        )
    if offset != 0 and period is None:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT, detail="offset requires period"
        )
    if (start_date is not None or end_date is not None) and period != PeriodUnit.CUSTOM:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail="start_date/end_date require period=custom",
        )
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
    months_back: Annotated[int | None, Query(ge=0, le=2)] = None,
    period: PeriodUnit | None = None,
    offset: Annotated[int, Query(le=0)] = 0,
    start_date: date | None = None,
    end_date: date | None = None,
    category_id: UUID | None = None,
    tag_id: UUID | None = None,
) -> PeriodTotal:
    _validate_period(
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
    _validate_period(
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
    _validate_period(
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
