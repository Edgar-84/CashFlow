from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, Request

from api.deps import PermissionChecker, PermissionDecision, enforce_ownership, get_expense_service
from models.enums import Action, Resource
from models.expense import ExpenseCreate, ExpenseResponse, ExpenseUpdate
from models.user import UserResponse
from services.expense_service import ExpenseService

router = APIRouter(prefix="/expenses", tags=["expenses"])


@router.get("", response_model=list[ExpenseResponse])
async def list_expenses(
    request: Request,
    user: Annotated[UserResponse, Depends(PermissionChecker(Resource.EXPENSES, Action.READ))],
    service: Annotated[ExpenseService, Depends(get_expense_service)],
) -> list[ExpenseResponse]:
    expenses = await service.list(user.account_id)
    # Default matrix leaves expense read unqualified (D26), but an override
    # permission row can still set own_only=True for read — step 6 has no
    # single "target record" for a list, so it's applied here as a filter
    # rather than via enforce_ownership (which 403s on one owner_id).
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
    return await service.create(data, user)


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
    return await service.update(expense_id, data, user.account_id)


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
