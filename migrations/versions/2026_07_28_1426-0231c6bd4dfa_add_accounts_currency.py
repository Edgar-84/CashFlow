"""add accounts currency

Revision ID: 0231c6bd4dfa
Revises: b4d1f8a5c240
Create Date: 2026-07-28 14:26:38.544853

"""

from collections.abc import Sequence

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "0231c6bd4dfa"
down_revision: str | None = "b4d1f8a5c240"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Upgrade schema."""
    op.execute("ALTER TABLE accounts ADD COLUMN currency TEXT NOT NULL DEFAULT 'USD'")


def downgrade() -> None:
    """Downgrade schema."""
    op.execute("ALTER TABLE accounts DROP COLUMN currency")
