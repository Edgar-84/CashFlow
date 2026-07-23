from datetime import UTC, datetime
from uuid import uuid4

import pytest

from models.budget_plan import BudgetPlanCreate, BudgetPlanResponse, BudgetPlanUpdate
from models.category import CategoryCreate, CategoryResponse, CategoryUpdate
from models.enums import Action, Resource, Role
from models.errors import (
    DomainError,
    LimitExceededWarning,
    NotFoundError,
    PermissionDeniedError,
)
from models.expense import ExpenseCreate, ExpenseResponse, ExpenseUpdate
from models.permission import PermissionCreate, PermissionResponse, PermissionUpdate
from models.tag import TagCreate, TagResponse, TagUpdate
from models.user import UserCreate, UserResponse, UserUpdate


def test_user_models() -> None:
    account_id = uuid4()
    create = UserCreate(tg_id=123456789, name="Wife", account_id=account_id)
    assert create.role == Role.MEMBER

    update = UserUpdate(role=Role.ADMIN)
    assert update.name is None

    response = UserResponse(
        id=uuid4(),
        tg_id=123456789,
        name="Wife",
        role=Role.MEMBER,
        account_id=account_id,
        created_at=datetime.now(UTC),
    )
    assert response.account_id == account_id


def test_category_models() -> None:
    create = CategoryCreate(name="Groceries")
    update = CategoryUpdate(name="Food")
    response = CategoryResponse(
        id=uuid4(), name="Groceries", account_id=uuid4(), created_at=datetime.now(UTC)
    )
    assert create.name == "Groceries"
    assert update.name == "Food"
    assert response.name == "Groceries"


def test_tag_models() -> None:
    create = TagCreate(name="urgent")
    update = TagUpdate(name="later")
    response = TagResponse(
        id=uuid4(), name="urgent", account_id=uuid4(), created_at=datetime.now(UTC)
    )
    assert create.name == "urgent"
    assert update.name == "later"
    assert response.name == "urgent"


def test_expense_models_require_category_id() -> None:
    category_id = uuid4()
    create = ExpenseCreate(amount=1500, comment="Bread", category_id=category_id)
    assert create.tag_ids == []

    with pytest.raises(ValueError):
        ExpenseCreate.model_validate({"amount": 1500, "comment": "Bread"})

    update = ExpenseUpdate(amount=2000)
    assert update.category_id is None

    response = ExpenseResponse(
        id=uuid4(),
        amount=1500,
        comment="Bread",
        category_id=category_id,
        user_id=uuid4(),
        account_id=uuid4(),
        created_at=datetime.now(UTC),
        updated_at=datetime.now(UTC),
        tags=[
            TagResponse(id=uuid4(), name="urgent", account_id=uuid4(), created_at=datetime.now(UTC))
        ],
    )
    assert response.amount == 1500
    assert len(response.tags) == 1
    assert response.user_name is None

    named = ExpenseResponse.model_validate(
        {
            "id": uuid4(),
            "amount": 1500,
            "comment": "Bread",
            "category_id": category_id,
            "user_id": uuid4(),
            "account_id": uuid4(),
            "created_at": datetime.now(UTC),
            "updated_at": datetime.now(UTC),
            "user_name": "Wife",
        }
    )
    assert named.user_name == "Wife"

    with pytest.raises(ValueError):
        ExpenseResponse.model_validate(
            {
                "id": uuid4(),
                "amount": 1500,
                "category_id": category_id,
                "user_id": uuid4(),
                "account_id": uuid4(),
                "created_at": datetime.now(UTC),
            }
        )


def test_budget_plan_models() -> None:
    category_id = uuid4()
    create = BudgetPlanCreate(category_id=category_id, amount=500_00)
    assert create.period == "monthly"
    assert create.notify_threshold == 80

    update = BudgetPlanUpdate(notify_threshold=90)
    assert update.amount is None

    response = BudgetPlanResponse(
        id=uuid4(),
        category_id=category_id,
        amount=500_00,
        account_id=uuid4(),
        created_at=datetime.now(UTC),
        updated_at=datetime.now(UTC),
    )
    assert response.notify_threshold == 80

    with pytest.raises(ValueError):
        BudgetPlanCreate(category_id=category_id, amount=500_00, notify_threshold=101)

    with pytest.raises(ValueError):
        BudgetPlanCreate(category_id=category_id, amount=0)

    with pytest.raises(ValueError):
        BudgetPlanCreate(category_id=category_id, amount=-100)

    with pytest.raises(ValueError):
        BudgetPlanResponse.model_validate(
            {
                "id": uuid4(),
                "category_id": category_id,
                "amount": 500_00,
                "account_id": uuid4(),
                "created_at": datetime.now(UTC),
            }
        )


def test_permission_models() -> None:
    user_id = uuid4()
    create = PermissionCreate(resource=Resource.EXPENSES, user_id=user_id)
    assert create.own_only is True

    update = PermissionUpdate(can_create=True, own_only=False)
    assert update.can_delete is None

    response = PermissionResponse(id=uuid4(), resource=Resource.EXPENSES, user_id=user_id)
    assert response.resource == Resource.EXPENSES


def test_enums_have_expected_members() -> None:
    assert set(Role) == {Role.ADMIN, Role.MEMBER, Role.VIEWER}
    assert set(Resource) == {
        Resource.EXPENSES,
        Resource.CATEGORIES,
        Resource.TAGS,
        Resource.BUDGET_PLANS,
    }
    assert set(Action) == {Action.CREATE, Action.READ, Action.UPDATE, Action.DELETE}


def test_domain_errors_are_typed_and_distinct() -> None:
    for error_cls in (NotFoundError, PermissionDeniedError, LimitExceededWarning):
        assert issubclass(error_cls, DomainError)
        instance = error_cls("boom")
        assert isinstance(instance, DomainError)

    assert NotFoundError is not PermissionDeniedError
    assert NotFoundError is not LimitExceededWarning
