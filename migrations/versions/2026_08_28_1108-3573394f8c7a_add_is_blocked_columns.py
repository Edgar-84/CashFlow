"""add is_blocked columns

Revision ID: 3573394f8c7a
Revises: be7167499d7d
Create Date: 2026-08-28 11:08:38.600000

"""

from collections.abc import Sequence

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "3573394f8c7a"
down_revision: str | None = "be7167499d7d"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Upgrade schema."""
    op.execute("ALTER TABLE accounts ADD COLUMN is_blocked BOOLEAN NOT NULL DEFAULT false")
    op.execute("ALTER TABLE users ADD COLUMN is_blocked BOOLEAN NOT NULL DEFAULT false")


def downgrade() -> None:
    """Downgrade schema."""
    op.execute("ALTER TABLE users DROP COLUMN is_blocked")
    op.execute("ALTER TABLE accounts DROP COLUMN is_blocked")
