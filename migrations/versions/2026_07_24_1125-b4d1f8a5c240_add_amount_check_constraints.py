"""add amount check constraints

Revision ID: b4d1f8a5c240
Revises: 1fd1bea5a842
Create Date: 2026-07-24 11:25:59.752473

"""

from collections.abc import Sequence

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "b4d1f8a5c240"
down_revision: str | None = "1fd1bea5a842"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Upgrade schema."""
    op.execute("ALTER TABLE expenses ADD CONSTRAINT expenses_amount_positive CHECK (amount > 0)")
    op.execute(
        "ALTER TABLE budget_plans ADD CONSTRAINT budget_plans_amount_positive CHECK (amount > 0)"
    )


def downgrade() -> None:
    """Downgrade schema."""
    op.execute("ALTER TABLE budget_plans DROP CONSTRAINT budget_plans_amount_positive")
    op.execute("ALTER TABLE expenses DROP CONSTRAINT expenses_amount_positive")
