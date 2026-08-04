"""add category tag archive flags color slot expenses spent at

Revision ID: a1d5976f1ce0
Revises: 0231c6bd4dfa
Create Date: 2026-08-04 18:29:50.756893

"""

from collections.abc import Sequence

from alembic import op
from sqlalchemy import text

from config import get_settings

# revision identifiers, used by Alembic.
revision: str = "a1d5976f1ce0"
down_revision: str | None = "0231c6bd4dfa"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Upgrade schema."""
    op.execute("ALTER TABLE categories ADD COLUMN is_active BOOLEAN NOT NULL DEFAULT true")
    op.execute("ALTER TABLE categories ADD COLUMN color_slot SMALLINT")
    op.execute("ALTER TABLE tags ADD COLUMN is_active BOOLEAN NOT NULL DEFAULT true")
    op.execute("ALTER TABLE expenses ADD COLUMN spent_at DATE NOT NULL DEFAULT current_date")

    # color_slot backfill: 1-based position within the account by created_at
    # ASC, capped at 6 — exactly the colours the app renders today (D206),
    # frozen. Slots 7-12 are for a user to choose and are never auto-assigned.
    op.execute("""
        WITH ranked AS (
            SELECT id, ROW_NUMBER() OVER (
                PARTITION BY account_id ORDER BY created_at ASC
            ) AS rn
            FROM categories
        )
        UPDATE categories c
        SET color_slot = ranked.rn
        FROM ranked
        WHERE c.id = ranked.id AND ranked.rn <= 6
    """)

    # spent_at backfill: the existing row's created_at as seen in family_tz,
    # not a naive ::date cast, so a late-night expense logged in a UTC+N
    # family timezone keeps landing in the local day it already appears in
    # (same class of bug as D120).
    family_tz = get_settings().family_tz
    op.execute(
        text("UPDATE expenses SET spent_at = (created_at AT TIME ZONE :tz)::date").bindparams(
            tz=family_tz
        )
    )


def downgrade() -> None:
    """Downgrade schema."""
    op.execute("ALTER TABLE expenses DROP COLUMN spent_at")
    op.execute("ALTER TABLE tags DROP COLUMN is_active")
    op.execute("ALTER TABLE categories DROP COLUMN color_slot")
    op.execute("ALTER TABLE categories DROP COLUMN is_active")
