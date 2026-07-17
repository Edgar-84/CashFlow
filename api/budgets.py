from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends

from api.deps import PermissionChecker, get_budget_service
from models.budget_plan import (
    BudgetPlanCreate,
    BudgetPlanResponse,
    BudgetPlanUpdate,
    BudgetProgress,
)
from models.enums import Action, Resource
from models.user import UserResponse
from services.budget_service import BudgetService

router = APIRouter(prefix="/budgets", tags=["budgets"])


@router.get("", response_model=list[BudgetPlanResponse])
async def list_budget_plans(
    user: Annotated[UserResponse, Depends(PermissionChecker(Resource.BUDGET_PLANS, Action.READ))],
    service: Annotated[BudgetService, Depends(get_budget_service)],
) -> list[BudgetPlanResponse]:
    return await service.list(user.account_id)


@router.get("/{budget_plan_id}", response_model=BudgetPlanResponse)
async def get_budget_plan(
    budget_plan_id: UUID,
    user: Annotated[UserResponse, Depends(PermissionChecker(Resource.BUDGET_PLANS, Action.READ))],
    service: Annotated[BudgetService, Depends(get_budget_service)],
) -> BudgetPlanResponse:
    return await service.get(budget_plan_id, user.account_id)


@router.get("/{budget_plan_id}/progress", response_model=BudgetProgress)
async def get_budget_plan_progress(
    budget_plan_id: UUID,
    user: Annotated[UserResponse, Depends(PermissionChecker(Resource.BUDGET_PLANS, Action.READ))],
    service: Annotated[BudgetService, Depends(get_budget_service)],
) -> BudgetProgress:
    return await service.get_progress(budget_plan_id, user.account_id)


@router.post("", response_model=BudgetPlanResponse, status_code=201)
async def create_budget_plan(
    data: BudgetPlanCreate,
    user: Annotated[UserResponse, Depends(PermissionChecker(Resource.BUDGET_PLANS, Action.CREATE))],
    service: Annotated[BudgetService, Depends(get_budget_service)],
) -> BudgetPlanResponse:
    return await service.create(data, user.account_id)


@router.patch("/{budget_plan_id}", response_model=BudgetPlanResponse)
async def update_budget_plan(
    budget_plan_id: UUID,
    data: BudgetPlanUpdate,
    user: Annotated[UserResponse, Depends(PermissionChecker(Resource.BUDGET_PLANS, Action.UPDATE))],
    service: Annotated[BudgetService, Depends(get_budget_service)],
) -> BudgetPlanResponse:
    return await service.update(budget_plan_id, data, user.account_id)


@router.delete("/{budget_plan_id}", status_code=204)
async def delete_budget_plan(
    budget_plan_id: UUID,
    user: Annotated[UserResponse, Depends(PermissionChecker(Resource.BUDGET_PLANS, Action.DELETE))],
    service: Annotated[BudgetService, Depends(get_budget_service)],
) -> None:
    await service.delete(budget_plan_id, user.account_id)
