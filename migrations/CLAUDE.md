# migrations/ — Alembic (asyncpg-compatible)

<!-- Loaded only when Claude works inside migrations/. -->

## Purpose
Schema migrations for the Supabase (PostgreSQL) database. Source of truth for
the schema is `docs/SCHEMA.sql`; the first migration is generated from it, and
every subsequent migration is a delta.

## Layout
- `env.py` — Alembic env configured for asyncpg (async engine, run migrations
  in an async context).
- `versions/` — generated migrations. **Do not edit past migrations** — write
  a new one to change something.

## Rules
- **Never edit an already-applied migration.** Add a new one that supersedes it.
- **Never edit `versions/` files without asking.** (Also in root CLAUDE.md.)
- Every schema change: new migration file, `alembic upgrade head` locally,
  then commit both `docs/SCHEMA.sql` (if it moved) and the new version.
- Money columns: `BIGINT` (minor units). Never `NUMERIC`/`FLOAT` for money.
- IDs: `UUID PRIMARY KEY DEFAULT gen_random_uuid()`.
- Timestamps: `TIMESTAMPTZ DEFAULT now()`.
- FKs: explicit `REFERENCES ... ON DELETE {CASCADE|SET NULL|RESTRICT}` — never
  the default (which is `NO ACTION`, easy to trip on).

## Commands
- Generate: `uv run alembic revision --autogenerate -m "short description"`.
  Autogenerate is a **starting point**, not a finished migration — always
  review the file before applying.
- Apply: `uv run alembic upgrade head`.
- Downgrade one step: `uv run alembic downgrade -1` (only in dev).

## First migration
Bootstrap from `docs/SCHEMA.sql`. Options:
1. `alembic revision -m "initial schema"` (blank), then paste the DDL into
   `upgrade()` as `op.execute("""...""")`.
2. Or write it as native Alembic ops for autogenerate-friendliness.

Pick (1) if the schema is stable and you want a faithful reproduction of the
canonical SQL; pick (2) if you'll iterate on the schema early.
