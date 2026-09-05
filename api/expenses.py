from datetime import date
from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, Request, status

from api.deps import PermissionChecker, PermissionDecision, enforce_ownership, get_expense_service
from api.period_params import resolve_period_params
from models.enums import Action, PeriodUnit, Resource
from models.expense import ExpenseCreate, ExpenseResponse, ExpenseUpdate
from models.user import UserResponse
from services.expense_service import ExpenseService

router = APIRouter(prefix="/expenses", tags=["expenses"])


@router.get("", response_model=list[ExpenseResponse])
async def list_expenses(
    request: Request,
    user: Annotated[UserResponse, Depends(PermissionChecker(Resource.EXPENSES, Action.READ))],
    service: Annotated[ExpenseService, Depends(get_expense_service)],
    limit: Annotated[int, Query(ge=1, le=200)] = 50,
    offset: Annotated[int, Query(ge=0)] = 0,
    category_id: UUID | None = None,
    tag_id: UUID | None = None,
    period: PeriodUnit | None = None,
    period_offset: Annotated[int, Query(le=0)] = 0,
    start_date: date | None = None,
    end_date: date | None = None,
) -> list[ExpenseResponse]:
    # `period_offset`, not `offset` — `offset` already paginates and the bot
    # depends on that spelling (plan Decision log D402).
    try:
        bounds = resolve_period_params(
            period=period,
            offset=period_offset,
            start_date=start_date,
            end_date=end_date,
            offset_param_name="period_offset",
            tz=service.family_tz,
        )
    except ValueError as exc:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT, detail=str(exc)
        ) from exc
    expenses = await service.list(
        user.account_id,
        limit=limit,
        offset=offset,
        category_id=category_id,
        tag_id=tag_id,
        bounds=bounds,
    )
    # Default matrix leaves expense read unqualified (D26), but an override
    # permission row can still set own_only=True for read — step 6 has no
    # single "target record" for a list, so it's applied here as a filter
    # rather than via enforce_ownership (which 403s on one owner_id). This
    # means own_only can return a short page — filtered client-side, after
    # the DB already applied limit/offset (plan Risks: "Pagination vs
    # own_only").
    decision: PermissionDecision = request.state.permission_decision
    if decision.own_only:
        expenses = [e for e in expenses if e.user_id == user.id]
    return expenses


@router.get("/{expense_id}", response_model=ExpenseResponse)
async def get_expense(
    expense_id: UUID,
    request: Request,
    user: Annotated[UserResponse, Depends(PermissionChecker(Resource.EXPENSES, Action.READ))],
    service: Annotated[ExpenseService, Depends(get_expense_service)],
) -> ExpenseResponse:
    expense = await service.get(expense_id, user.account_id)
    enforce_ownership(request.state.permission_decision, user, expense.user_id)
    return expense


@router.post("", response_model=ExpenseResponse, status_code=201)
async def create_expense(
    data: ExpenseCreate,
    user: Annotated[UserResponse, Depends(PermissionChecker(Resource.EXPENSES, Action.CREATE))],
    service: Annotated[ExpenseService, Depends(get_expense_service)],
) -> ExpenseResponse:
    try:
        return await service.create(data, user)
    except ValueError as exc:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT, detail=str(exc)
        ) from exc


@router.patch("/{expense_id}", response_model=ExpenseResponse)
async def update_expense(
    expense_id: UUID,
    data: ExpenseUpdate,
    request: Request,
    user: Annotated[UserResponse, Depends(PermissionChecker(Resource.EXPENSES, Action.UPDATE))],
    service: Annotated[ExpenseService, Depends(get_expense_service)],
) -> ExpenseResponse:
    expense = await service.get(expense_id, user.account_id)
    enforce_ownership(request.state.permission_decision, user, expense.user_id)
    try:
        return await service.update(expense_id, data, user.account_id)
    except ValueError as exc:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT, detail=str(exc)
        ) from exc


@router.delete("/{expense_id}", status_code=204)
async def delete_expense(
    expense_id: UUID,
    request: Request,
    user: Annotated[UserResponse, Depends(PermissionChecker(Resource.EXPENSES, Action.DELETE))],
    service: Annotated[ExpenseService, Depends(get_expense_service)],
) -> None:
    expense = await service.get(expense_id, user.account_id)
    enforce_ownership(request.state.permission_decision, user, expense.user_id)
    await service.delete(expense_id, user.account_id)
