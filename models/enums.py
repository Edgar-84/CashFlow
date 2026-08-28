from enum import StrEnum


class Role(StrEnum):
    SYSTEM_ADMIN = "system_admin"  # cross-account; see D711/D712
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


class PeriodUnit(StrEnum):
    """A period shape resolved server-side by `services/period.py`'s
    `resolve_period` (plan mini-app-v3 Decision log D313) — paired with an
    `offset` (0 = current, negative = back N units) rather than a fixed
    preset name, so the client never computes UTC instants itself."""

    DAY = "day"
    WEEK = "week"  # starts Monday (D315)
    MONTH = "month"
    YEAR = "year"
    CUSTOM = "custom"  # requires start_date AND end_date, forbids offset


class Language(StrEnum):
    """Account UI language (D701, D702). The catalogue key set is EN's;
    every other catalogue is checked against it by a test, not by hand."""

    EN = "en"
    RU = "ru"
    UK = "uk"


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
