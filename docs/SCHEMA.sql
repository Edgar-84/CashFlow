-- Canonical schema for CashFlow.
-- Source of truth: the first Alembic migration is generated from this file.
-- Every change here must be paired with a new Alembic migration (never edit
-- an already-applied migration).
--
-- Money rule: all amounts are BIGINT in minor currency units (kopecks/cents).
-- Never use FLOAT or NUMERIC for money.

CREATE TABLE accounts (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name       TEXT NOT NULL,
  owner_id   UUID,              -- set after first user is created
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE users (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tg_id      BIGINT UNIQUE NOT NULL,
  name       TEXT NOT NULL,
  role       TEXT NOT NULL DEFAULT 'member',  -- admin | member | viewer
  account_id UUID NOT NULL REFERENCES accounts(id),
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE categories (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name       TEXT NOT NULL,
  account_id UUID NOT NULL REFERENCES accounts(id),
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE tags (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name       TEXT NOT NULL,
  account_id UUID NOT NULL REFERENCES accounts(id),
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE expenses (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  amount      BIGINT NOT NULL,       -- minor units (kopecks / cents)
  comment     TEXT,
  category_id UUID REFERENCES categories(id),
  user_id     UUID NOT NULL REFERENCES users(id),
  account_id  UUID NOT NULL REFERENCES accounts(id),
  created_at  TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE expense_tags (
  expense_id UUID NOT NULL REFERENCES expenses(id) ON DELETE CASCADE,
  tag_id     UUID NOT NULL REFERENCES tags(id)     ON DELETE CASCADE,
  PRIMARY KEY (expense_id, tag_id)
);

CREATE TABLE budget_plans (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  category_id        UUID NOT NULL REFERENCES categories(id),
  account_id         UUID NOT NULL REFERENCES accounts(id),
  amount             BIGINT NOT NULL,          -- minor units
  period             TEXT NOT NULL DEFAULT 'monthly',
  notify_threshold   INT  NOT NULL DEFAULT 80, -- percent (0-100)
  created_at         TIMESTAMPTZ DEFAULT now(),
  UNIQUE (category_id, account_id, period)
);

CREATE TABLE permissions (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  resource   TEXT NOT NULL,      -- expenses | categories | tags | budgets
  can_create BOOLEAN NOT NULL DEFAULT false,
  can_read   BOOLEAN NOT NULL DEFAULT true,
  can_update BOOLEAN NOT NULL DEFAULT false,
  can_delete BOOLEAN NOT NULL DEFAULT false,
  own_only   BOOLEAN NOT NULL DEFAULT true,  -- true = only own records
  UNIQUE (user_id, resource)
);
