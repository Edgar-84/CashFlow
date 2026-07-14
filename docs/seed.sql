-- ============================================================
-- CashFlow — Manual Seed Script (V1 onboarding)
-- ============================================================
-- Purpose: bootstrap a family account and its users by hand.
-- Run in Supabase SQL Editor (or psql) AFTER all migrations
-- are applied (alembic upgrade head).
--
-- V1 has no self-registration — this file IS the registration
-- flow. In V2 a bot-driven flow will perform the same inserts
-- programmatically; permission logic will not change.
--
-- HOW TO GET tg_id: each family member messages @userinfobot
-- in Telegram and receives their numeric ID.
--
-- IMPORTANT: after seeding, add every tg_id to ALLOWED_TG_IDS
-- in .env and restart the bot (bot middleware allowlist).
-- ============================================================


-- ------------------------------------------------------------
-- STEP 1. Create the family account (shared "wallet").
-- owner_id stays NULL for now — the owner user doesn't exist yet
-- (chicken-and-egg; that's why the column is nullable).
-- ------------------------------------------------------------
INSERT INTO accounts (name)
VALUES ('Family Account')          -- <<< EDIT: your account name
RETURNING id;
-- >>> SAVE the returned UUID. Referred to below as <ACCOUNT_ID>.


-- ------------------------------------------------------------
-- STEP 2. Create yourself as admin.
-- ------------------------------------------------------------
INSERT INTO users (tg_id, name, role, account_id)
VALUES (
  111111111,                       -- <<< EDIT: your tg_id
  'Edgar',                         -- <<< EDIT: your name
  'admin',
  '<ACCOUNT_ID>'                   -- <<< PASTE from step 1
)
RETURNING id;
-- >>> SAVE the returned UUID. Referred to below as <ADMIN_ID>.


-- ------------------------------------------------------------
-- STEP 3. Close the loop: set the account owner.
-- ------------------------------------------------------------
UPDATE accounts
SET owner_id = '<ADMIN_ID>'        -- <<< PASTE from step 2
WHERE id = '<ACCOUNT_ID>';


-- ------------------------------------------------------------
-- STEP 4. Add family members to the SAME account.
-- The shared account_id is what unites the family in one wallet.
--
-- Role defaults (no permissions row needed):
--   member -> CRUD own expenses; read-only categories/tags/plans
--   viewer -> read-only everywhere
-- ------------------------------------------------------------
INSERT INTO users (tg_id, name, role, account_id) VALUES
  (222222222, 'Wife',    'member', '<ACCOUNT_ID>'),   -- <<< EDIT
  (333333333, 'Son',     'member', '<ACCOUNT_ID>'),   -- <<< EDIT
  (444444444, 'Grandma', 'viewer', '<ACCOUNT_ID>');   -- <<< EDIT
-- Remove/add rows as needed.


-- ------------------------------------------------------------
-- STEP 5 (OPTIONAL). Custom permissions overriding role defaults.
-- Example: let Wife edit ANY family expense, not just her own
-- (own_only = false), but still no delete right.
-- ------------------------------------------------------------
-- INSERT INTO permissions
--   (user_id, resource, can_create, can_read, can_update, can_delete, own_only)
-- VALUES
--   ('<WIFE_USER_ID>', 'expenses', true, true, true, false, false);


-- ------------------------------------------------------------
-- STEP 6 (OPTIONAL). Starter categories so the bot menu
-- isn't empty on first launch.
-- ------------------------------------------------------------
INSERT INTO categories (name, account_id) VALUES
  ('Food',      '<ACCOUNT_ID>'),
  ('Transport', '<ACCOUNT_ID>'),
  ('Home',      '<ACCOUNT_ID>'),
  ('Health',    '<ACCOUNT_ID>'),
  ('Fun',       '<ACCOUNT_ID>');


-- ------------------------------------------------------------
-- VERIFY: everything landed correctly.
-- ------------------------------------------------------------
SELECT a.name AS account, a.owner_id IS NOT NULL AS owner_set,
       u.name, u.tg_id, u.role
FROM accounts a
JOIN users u ON u.account_id = a.id
ORDER BY u.role, u.name;

-- ============================================================
-- CHECKLIST after running this file:
-- [ ] owner_id set on the account (owner_set = true above)
-- [ ] every tg_id added to ALLOWED_TG_IDS in .env
-- [ ] bot restarted
-- [ ] each member sent /start to the bot and got the main menu
-- ============================================================
