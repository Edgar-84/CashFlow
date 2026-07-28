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


class Currency(StrEnum):
    """ISO 4217 codes for the 15 currencies offered at account creation (D211)."""

    USD = "USD"
    EUR = "EUR"
    GBP = "GBP"
    PLN = "PLN"
    UAH = "UAH"
    CZK = "CZK"
    CHF = "CHF"
    SEK = "SEK"
    NOK = "NOK"
    DKK = "DKK"
    JPY = "JPY"
    CNY = "CNY"
    CAD = "CAD"
    AUD = "AUD"
    TRY = "TRY"
