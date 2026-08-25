"""add accounts language

Revision ID: be7167499d7d
Revises: a1d5976f1ce0
Create Date: 2026-08-25 19:06:44.929466

"""

from collections.abc import Sequence

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "be7167499d7d"
down_revision: str | None = "a1d5976f1ce0"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Upgrade schema."""
    op.execute("ALTER TABLE accounts ADD COLUMN language TEXT NOT NULL DEFAULT 'en'")


def downgrade() -> None:
    """Downgrade schema."""
    op.execute("ALTER TABLE accounts DROP COLUMN language")
