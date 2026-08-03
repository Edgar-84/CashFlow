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


class PeriodPreset(StrEnum):
    """Named period selectors resolved server-side by `services/period.py`'s
    `resolve_period` (plan mini-app-v3 Decision log D300) — the client names
    a period, it never computes UTC instants itself."""

    TODAY = "today"
    YESTERDAY = "yesterday"
    THIS_MONTH = "this_month"
    LAST_MONTH = "last_month"
    LAST_3_MONTHS = "last_3_months"
    CUSTOM = "custom"  # requires start_date AND end_date


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
