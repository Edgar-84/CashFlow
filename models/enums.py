from enum import StrEnum


class Role(StrEnum):
    ADMIN = "admin"
    MEMBER = "member"
    VIEWER = "viewer"


class Resource(StrEnum):
    EXPENSES = "expenses"
    CATEGORIES = "categories"
    TAGS = "tags"
    BUDGET_PLANS = "budget_plans"


class Action(StrEnum):
    CREATE = "create"
    READ = "read"
    UPDATE = "update"
    DELETE = "delete"
