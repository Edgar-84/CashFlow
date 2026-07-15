"""initial schema

Revision ID: 1fd1bea5a842
Revises:
Create Date: 2026-07-14 20:05:58.478834

"""

from collections.abc import Sequence

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "1fd1bea5a842"
down_revision: str | None = None
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Upgrade schema."""
    op.execute("""
        CREATE TABLE accounts (
          id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          name       TEXT NOT NULL,
          owner_id   UUID,
          created_at TIMESTAMPTZ DEFAULT now()
        )
    """)

    op.execute("""
        CREATE TABLE users (
          id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          tg_id      BIGINT UNIQUE NOT NULL,
          name       TEXT NOT NULL,
          role       TEXT NOT NULL DEFAULT 'member',
          account_id UUID NOT NULL REFERENCES accounts(id),
          created_at TIMESTAMPTZ DEFAULT now()
        )
    """)

    op.execute("""
        CREATE TABLE categories (
          id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          name       TEXT NOT NULL,
          account_id UUID NOT NULL REFERENCES accounts(id),
          created_at TIMESTAMPTZ DEFAULT now()
        )
    """)

    op.execute("""
        CREATE TABLE tags (
          id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          name       TEXT NOT NULL,
          account_id UUID NOT NULL REFERENCES accounts(id),
          created_at TIMESTAMPTZ DEFAULT now()
        )
    """)

    op.execute("""
        CREATE TABLE expenses (
          id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          amount      BIGINT NOT NULL,
          comment     TEXT,
          category_id UUID NOT NULL REFERENCES categories(id) ON DELETE RESTRICT,
          user_id     UUID NOT NULL REFERENCES users(id),
          account_id  UUID NOT NULL REFERENCES accounts(id),
          created_at  TIMESTAMPTZ DEFAULT now(),
          updated_at  TIMESTAMPTZ DEFAULT now()
        )
    """)

    op.execute("""
        CREATE TABLE expense_tags (
          expense_id UUID NOT NULL REFERENCES expenses(id) ON DELETE CASCADE,
          tag_id     UUID NOT NULL REFERENCES tags(id)     ON DELETE CASCADE,
          PRIMARY KEY (expense_id, tag_id)
        )
    """)

    op.execute("""
        CREATE TABLE budget_plans (
          id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          category_id        UUID NOT NULL REFERENCES categories(id) ON DELETE RESTRICT,
          account_id         UUID NOT NULL REFERENCES accounts(id),
          amount             BIGINT NOT NULL,
          period             TEXT NOT NULL DEFAULT 'monthly',
          notify_threshold   INT  NOT NULL DEFAULT 80,
          created_at         TIMESTAMPTZ DEFAULT now(),
          updated_at         TIMESTAMPTZ DEFAULT now(),
          UNIQUE (category_id, account_id, period)
        )
    """)

    op.execute("""
        CREATE TABLE permissions (
          id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          resource   TEXT NOT NULL,
          can_create BOOLEAN NOT NULL DEFAULT false,
          can_read   BOOLEAN NOT NULL DEFAULT true,
          can_update BOOLEAN NOT NULL DEFAULT false,
          can_delete BOOLEAN NOT NULL DEFAULT false,
          own_only   BOOLEAN NOT NULL DEFAULT true,
          UNIQUE (user_id, resource)
        )
    """)

    op.execute(
        "CREATE INDEX ix_expenses_account_id_created_at ON expenses (account_id, created_at)"
    )
    op.execute("CREATE INDEX ix_expenses_category_id ON expenses (category_id)")
    op.execute("CREATE INDEX ix_expense_tags_tag_id ON expense_tags (tag_id)")

    op.execute("""
        CREATE OR REPLACE FUNCTION set_updated_at()
        RETURNS TRIGGER AS $$
        BEGIN
          NEW.updated_at = now();
          RETURN NEW;
        END;
        $$ LANGUAGE plpgsql
    """)

    op.execute("""
        CREATE TRIGGER expenses_set_updated_at
          BEFORE UPDATE ON expenses
          FOR EACH ROW
          EXECUTE FUNCTION set_updated_at()
    """)

    op.execute("""
        CREATE TRIGGER budget_plans_set_updated_at
          BEFORE UPDATE ON budget_plans
          FOR EACH ROW
          EXECUTE FUNCTION set_updated_at()
    """)


def downgrade() -> None:
    """Downgrade schema."""
    op.execute("DROP TRIGGER IF EXISTS budget_plans_set_updated_at ON budget_plans")
    op.execute("DROP TRIGGER IF EXISTS expenses_set_updated_at ON expenses")
    op.execute("DROP FUNCTION IF EXISTS set_updated_at()")
    op.execute("DROP TABLE permissions")
    op.execute("DROP TABLE budget_plans")
    op.execute("DROP TABLE expense_tags")
    op.execute("DROP TABLE expenses")
    op.execute("DROP TABLE tags")
    op.execute("DROP TABLE categories")
    op.execute("DROP TABLE users")
    op.execute("DROP TABLE accounts")
