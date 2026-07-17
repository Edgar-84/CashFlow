class DomainError(Exception):
    """Base class for domain-level errors raised by services."""


class NotFoundError(DomainError):
    """Raised when a requested entity does not exist."""


class PermissionDeniedError(DomainError):
    """Raised when a user attempts an action they are not permitted to perform."""


class ConflictError(DomainError):
    """Raised when an operation would violate a uniqueness constraint."""


class LimitExceededWarning(DomainError):
    """Raised to signal a budget threshold has been crossed.

    Non-fatal by design (D3): must never abort the expense operation that
    triggered it, only the notification flow that reacts to it.
    """
