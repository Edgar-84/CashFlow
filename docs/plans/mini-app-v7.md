# Plan: V7 — language, admin panel, and three menu fixes

Eighth plan file, after `docs/plans/expense-tracker-mvp.md` (V1 MVP, D1–D45),
`docs/plans/family-features-v1_1.md` (V1.1, D100–D124),
`docs/plans/bot-allowlist-db.md` (D300s, allowlist),
`docs/plans/mini-app-v2.md` (screens 01–05, D200–D211),
`docs/plans/mini-app-v3.md` (periods, categories & tags, D300–D3xx),
`docs/plans/mini-app-v4.md` (navigation, editing & settings, D400–D420),
`docs/plans/mini-app-v5.md` (colour picker & budget form, D500–D512) and
`docs/plans/mini-app-v6.md` (comment saves, category order, ring colour,
budget alerts, D600–D609) — all done. Decision ids here start at **D700**.

**The file name is `mini-app-v7` because the user asked for it, but the scope
is not Mini-App-only.** Items 1 and 2 are the first work since V1.1 to touch
`models/`, `repositories/`, `services/`, `api/`, `bot/` *and* `migrations/` —
V6's "no backend change of any kind" does not carry over. Read the milestone
you own; M1 and M2 really are frontend-only, M3 and M4 are not.

Workflow per unit: `/clear` → `/unit <id> docs/plans/mini-app-v7.md` →
Stop-gate (`bash scripts/verify.sh`) → [reviewer subagent for M4 units] →
human commits.

## Goal
Five items from the user's V7 brief (2026-08-25):

1. **The whole UI can be shown in the account's language.** A per-account
   language (not per-user), a language picker in the menu, and every visible
   string in **both** the Mini App and the bot read from a catalogue.
   EN + RU + UK ship in V7 (D701, D702).
2. **A System Admin can create accounts and suspend users or whole accounts**,
   from an **Admin** row added to the end of the side menu, after Settings.
   Suspending an account revokes access for every user in it (D710–D715).
3. **Categories and Tags stop printing per-row expense information** next to
   the name (D703).
4. **Statistics gets the main screen's period filters** — Day · Week · Month ·
   Year · Period — replacing This month / Last month / Last 3 months (D704).
5. **The tag chips on Add expense are ordered most-used first**, the same rule
   V6 gave the category grid (D705).

## Review of the brief — what changed after reading the code
Written during planning so no unit re-derives it.

- **Item 4 needs no backend work.** `api/statistics.py` already accepts
  `period` / `offset` / `start_date` / `end_date` on all three endpoints and
  already calls `validate_period_params`; `months_back` is a *second*,
  older parameter sitting beside them. `webapp/src/api/client.ts:113` even
  types `StatisticsQuery = PeriodQuery | { months_back?: number }` — the
  period arm exists and is unused. M2 is wiring, not a feature.
- **Item 5 is nearly free.** `sortCategoriesByUsage` already exists
  (`webapp/src/screens/add-expense.ts:147`), `TagResponse.expense_count`
  already exists (`webapp/src/api/types.ts:93`), `GET /tags?include_usage=true`
  already exists (`api/tags.py:20`), and `ApiClient.listTags({includeUsage})`
  already exists (`client.ts:268`). The only reason the chips are unordered is
  that `loadAddExpenseData` calls `api.listTags()` with no flag
  (`add-expense.ts:118`). One mirrored sort function, one flag, tests.
- **Item 3 must not stop *fetching* the usage count.** The count drives the
  hide-vs-delete branch on both screens (D305 — "the pre-tap knowledge of
  hide-vs-delete"). Only the *rendering* goes: `categories.ts:252`'s
  `` `${row.expenseCount} · ${formatAmount(row.monthTotalMinor)}` `` and the
  tags equivalent. The **aria label at `categories.ts:257` carries the amount
  too** and must go with it, or a screen reader keeps announcing exactly the
  thing the user asked to remove.
- **"The bot's additional menu" is the Mini App's side menu.** `bot/keyboards.py`
  has no Settings row and no drawer; `docs/ui/components/side-menu.md` is the
  only list in this product that ends with Settings. Item 2's Admin row is the
  side menu's **eighth** row.
- **Item 2 cuts across the security model.** Every repository call in this
  project is scoped by `account_id` — that scoping *is* the isolation
  guarantee. A global System Admin deliberately steps outside it, so it gets
  its own router, its own dependency and a reviewer pass (D711).
- **`require_admin` will reject the System Admin** as written
  (`api/deps.py:310`: `if user.role is not Role.ADMIN`). Adding a fourth role
  without touching that line silently locks system admins out of every
  existing admin route. Same for `resolve_permission`'s matrix.
- **CLAUDE.md lists the admin panel under "Out of scope (V2)".** M4's last unit
  updates that section in the same change, per the repo's own docs rule.
- **Three of the five items have no spec to decompose.** There is no
  `docs/ui/screens/05-statistics.md` at all, no language-picker spec and no
  admin-panel spec. The methodology's rule is explicit — decompose the spec,
  never the brief — so **M0 is `ui-spec` work and must land before M1–M4**.

## Non-goals
- **Per-user language.** The brief says the language belongs to the family
  account; a member who wants a different one is out of scope (D701). If that
  is ever wanted, it is a `users.language` column overriding the account's, not
  a redesign — but it is a decision with its own units.
- **Translating stored data.** Category names, tag names, account names and
  comments are user data and are never translated. Only chrome is.
- **Currency conversion or currency-per-language coupling.** `accounts.currency`
  and `accounts.language` are independent columns (D400 still holds: changing
  the currency relabels, never converts).
- **Right-to-left layouts.** None of EN/RU/UK needs it, and `app.css` has no
  logical-property audit behind it. Adding an RTL language later is a real
  piece of work, not a catalogue file.
- **A translation-management pipeline.** Catalogues are hand-written TypeScript
  and Python dicts in the repo. No `gettext`, no `.po`, no external service.
- **Self-registration.** A System Admin creating an account still needs the
  first user's `tg_id` handed to them out of band; the bot does not gain a
  sign-up flow (still out of scope per CLAUDE.md).
- **Deleting accounts or users.** M4 blocks and unblocks. `DELETE /users/{id}`
  already exists for account admins and is untouched.
- **An audit log of admin actions.** Worth having; not V7.
- **Batching `GET /budgets` progress** (V5's gotcha, still true) and **touching
  `assignCategoryColors`** (V6's gotcha, still true).

## Constraints
- Money stays `BIGINT` minor units end to end; no unit here does money maths.
- No colour, size or radius that is not in `docs/ui/design-system.md`. The
  language picker and the admin screen reuse the existing list-row rules
  (`08-settings.md`'s pattern) rather than inventing a third rhythm.
- `INTERNAL_TOKEN` and every other secret stay out of the browser bundle;
  `scripts/verify.sh`'s grep over the build output must keep passing.
- Language is **not** an env var — it is a column, exactly like `currency`
  (D211's precedent).
- `migrations/versions/` is "do not edit without asking": every migration unit
  below **stops and asks the human before writing the file**.

## Ordering (a hard constraint, not a preference)
**M0 → M1 → M2 → M3 → M4.**

M1 and M2 change strings and add a screen region; M3 extracts every string into
a catalogue. Running M3 first would force M1/M2 to add catalogue keys in three
languages for markup that is still moving, and running M4 before M3 would mean
translating the admin panel twice. So: small visible fixes first, then the
extraction pass over a settled UI, then the admin panel written
catalogue-native from its first line. **M4 introduces no English literal.**
(D700.)

## Contracts (M0/M3.1/M4.1)

```python
# models/enums.py — M3.1
class Language(StrEnum):
    """Account UI language (D701, D702). The catalogue key set is EN's;
    every other catalogue is checked against it by a test, not by hand."""
    EN = "en"
    RU = "ru"
    UK = "uk"


# models/enums.py — M4.1, a fourth role appended to the existing three
class Role(StrEnum):
    SYSTEM_ADMIN = "system_admin"   # NEW — cross-account; see D711
    ADMIN = "admin"
    MEMBER = "member"
    VIEWER = "viewer"
```

```sql
-- docs/SCHEMA.sql — M3.1 and M4.1, two separate migrations
ALTER TABLE accounts ADD COLUMN language   TEXT NOT NULL DEFAULT 'en';
ALTER TABLE accounts ADD COLUMN is_blocked BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE users    ADD COLUMN is_blocked BOOLEAN NOT NULL DEFAULT false;
```

```python
# models/account.py — M3.1 / M4.1
class AccountResponse(BaseModel):
    ...                                   # unchanged fields
    language: Language
    is_blocked: bool                      # M4.1

class AccountUpdate(BaseModel):
    currency: Currency | None = None      # existing
    language: Language | None = None      # M3.1

# models/user.py — M3.1 / M4.1
class UserMeResponse(UserResponse):
    ...                                   # currency, account_name, today
    language: Language                    # M3.1 — resolved from the account row

class UserResponse(UserBase):
    ...
    is_blocked: bool                      # M4.1
```

```python
# models/admin.py — M4.1, new file. The only shapes that cross account borders.
class AdminAccountRow(BaseModel):
    id: UUID; name: str; currency: Currency; language: Language
    is_blocked: bool; user_count: int; created_at: datetime

class AdminUserRow(BaseModel):
    id: UUID; tg_id: int; name: str; role: Role
    account_id: UUID; account_name: str; is_blocked: bool

class AdminAccountCreate(BaseModel):
    name: str; currency: Currency = Currency.USD; language: Language = Language.EN
    owner_tg_id: int; owner_name: str      # the first user, created in the same tx

class BlockUpdate(BaseModel):
    is_blocked: bool
```

```ts
// webapp/src/lib/i18n.ts — M3.3, new module
export type Lang = "en" | "ru" | "uk";
export type Catalogue = typeof en;           // EN is the key registry
export function setLanguage(lang: Lang): void;      // called at boot (D709),
                                                     // and again by the
                                                     // language-picker screen
                                                     // (09-language.md) after
                                                     // a successful PATCH
export function t(key: keyof Catalogue, vars?: Record<string, string | number>): string;
```

```ts
// webapp/src/screens/statistics.ts — M2.1, replacing PERIOD_PRESETS
export interface StatisticsData {
  ...
  period: PeriodValue;      // was: monthsBack: number
}
// loadStatistics(api, period: PeriodValue) — passes the period arm of
// StatisticsQuery straight through; it never computes bounds (D120/D300).
```

```python
# bot/i18n.py — M3.11, new module. Mirrors the webapp catalogue's key set.
def t(key: str, lang: Language, **vars: object) -> str: ...
```

Contracts are immutable for the units that consume them. If an
implementation hits a limitation, stop and record it in the Decision log first.

## Units

### M0 — Specs (`ui-spec` skill; nothing here writes code)
**Numbered in dependency order, not in screen order**: each unit here is the
gate on exactly one implementation milestone, and M0 units are independent of
each other. U0.1 and U0.2 gate M1, U0.3 gates M2, U0.4 gates M3's picker,
U0.5 gates M4. M0 can therefore be done in one sitting or spread out, but no
implementation unit may start before *its own* spec exists.

- [x] **U0.1** `docs/ui/screens/06-categories.md` + `07-tags.md` — revise. The
      per-row caption line is removed from both. *(Gates U1.1, U1.2.)*
      **AC:** neither Anatomy table has a per-row count/amount caption; both
      Copy tables drop that string; **both files state explicitly that
      `include_usage=true` is still fetched** and why (hide-vs-delete, D305);
      the accessibility section says the row's accessible name is the category
      or tag name alone.
- [x] **U0.2** `docs/ui/screens/02-add-expense.md` — revise the tag-chip
      region to usage-descending ordering, in the same words V6 gave the
      category grid. *(Gates U1.3.)*
      **AC:** the tag region names all-time `expense_count` descending with
      `created_at ASC` as the tiebreak; an AC covers a tag with zero uses;
      "+ Add tag" is still stated as the last chip.
- [x] **U0.3** `docs/ui/screens/05-statistics.md` — **new**. The screen has
      shipped since V2 with no spec file at all. Write it from the current
      implementation, then apply the V7 delta: the three `months_back` presets
      become the shared period selector. *(Gates all of M2. The largest M0
      unit — it documents a shipped screen before changing it.)*
      **AC:** the file exists; its Layout table names the period selector
      component and the grouping toggle; its Copy table has no "This month" /
      "Last month" / "Last 3 months" row left; it states that the client never
      computes period bounds; every value traces to `design-system.md`.
- [x] **U0.4** `docs/ui/screens/09-language.md` — **new** — plus the deltas in
      `components/side-menu.md` and `screens/08-settings.md` that place it.
      *(Gates U3.11.)*
      **AC:** the spec fixes *where* the picker lives (a row inside Settings,
      or a ninth side-menu destination — decide in the spec, D706); lists the
      three languages with their endonyms; states the reload/re-render
      behaviour after a change; states that non-admins see it read-only, the
      same rule the currency list follows.
- [x] **U0.5** `docs/ui/screens/10-admin.md` — **new** — plus the
      `components/side-menu.md` delta adding the eighth row. *(Gates all of
      M4. Note it touches `side-menu.md` too, like U0.4 — if both are done in
      one session, that file takes two passes, not one merged edit.)*
      **AC:** the spec covers the accounts list, the users list, the two block
      toggles, the create-account form and its confirm step; it states the row
      is **hidden, not disabled**, for every role but `system_admin` (the one
      place this app hides rather than dims — say why); it defines the copy a
      suspended user sees; every value traces to `design-system.md`.

### M1 — The two small fixes (items 3 and 5)
- [x] **U1.1** Categories screen stops rendering the per-row caption.
      **AC:** no row on screen 06 shows a count or an amount; the row's
      accessible name is the category name alone; `listCategories` is **still**
      called with `includeUsage: true` and the hide-vs-delete branch is
      unchanged (a test asserts both); `verify.sh` green.
- [ ] **U1.2** Tags screen, same change.
      **AC:** as U1.1, for screen 07 and `listTags`.
- [ ] **U1.3** Tag chips ordered most-used first.
      **AC:** `sortTagsByUsage` mirrors `sortCategoriesByUsage` exactly —
      `expense_count` descending, `created_at ASC` tiebreak, absent/null
      counts as 0, no throw; `loadAddExpenseData` passes
      `{ includeUsage: true }`; with Taxi=100, Entertainment=30, Fast Food=5
      the chips render in that order; "+ Add tag" is still last.

### M2 — Statistics period filters (item 4)
- [ ] **U2.1** `loadStatistics`/`buildStatisticsData` take a `PeriodValue`
      instead of `monthsBack`; `PERIOD_PRESETS` is deleted.
      **AC:** the three statistics calls send `period`/`offset` (or
      `start_date`/`end_date`) and never `months_back`; no bound is computed in
      the browser; the never-throws/cache-fallback contract is unchanged; unit
      tests cover each of the five units.
- [ ] **U2.2** The screen renders `period-selector` and re-fetches on a unit or
      offset tap.
      **AC:** the five tabs appear in the order Day · Week · Month · Year ·
      Period; a unit tap resets offset to 0; the offset arrows clamp at 0
      (no future period); the grouping toggle still re-renders **without**
      refetching; the donut and bars both follow the selected period.
- [ ] **U2.3** The "Period" tab opens `date-range-picker` and a custom range
      drives the screen.
      **AC:** picking a range sends `period=custom` with both dates and no
      `offset`; cancelling leaves the previous selection intact; the label row
      shows the chosen range; the selection survives a drill-down and return.

### M3 — Language (item 1)
- [ ] **U3.1** Contracts + migration: `Language` enum, `accounts.language`,
      the three model changes above, `docs/SCHEMA.sql`. **Ask the human before
      writing the migration file.**
      **AC:** `alembic upgrade head` then `downgrade -1` runs clean on a
      throwaway DB (`scripts/integration_docker.sh`); every existing account
      reads back `en`; `verify.sh` green; **no route behaviour changes yet.**
- [ ] **U3.2** Backend: `GET /users/me` returns `language`; `PATCH
      /accounts/me` accepts it.
      **AC:** the PATCH is admin-only, the same gate the currency change uses;
      an unknown code is 422, not a 500; changing the language leaves currency
      untouched and vice versa; tests cover both fields in one PATCH.
- [ ] **U3.3** `webapp/src/lib/i18n.ts` + boot wiring, EN catalogue only.
      **AC:** `t()` returns the EN string; an unknown key fails the build
      (typed key union), never renders at runtime; `setLanguage` runs **before
      any screen renders**, not when `GET /users/me` resolves — `boot()` paints
      Home's skeleton first (`main.ts:1051` → `showHome`, whose loader is what
      actually fetches `/users/me`), so the language is read from the same
      cache the app already uses for offline snapshots and only reconciled
      against the server response (D709); interpolation is escaped, never
      injected as HTML.
- [ ] **U3.4** RU + UK catalogues for the keys that exist so far.
      **AC:** a test asserts all three catalogues have **identical key sets**
      and fails on a missing or extra key; no catalogue contains markup.
- [ ] **U3.5** Extract `home.ts` + `components/side-menu.ts`.
- [ ] **U3.6** Extract `add-expense.ts` (the largest single file, ~33 strings).
- [ ] **U3.7** Extract `expenses.ts` + `expense-detail.ts`.
- [ ] **U3.8** Extract `budgets.ts` + `budget-form.ts`.
- [ ] **U3.9** Extract `categories.ts` + `tags.ts`.
- [ ] **U3.10** Extract `settings.ts` + `statistics.ts` + the remaining
      components (`period-selector`, `date-range-picker`, `category-picker`,
      `color-picker`, `toast`) + `main.ts`.
      **AC (U3.5–U3.10, each):** no user-visible literal remains in the files
      the unit owns — including `aria-label`s, `alt` text, MainButton labels,
      Telegram popup copy and error strings; all three catalogues stay
      key-identical; the rendered EN output is byte-identical to before the
      unit (that is the regression test); `verify.sh` green.
- [ ] **U3.11** The language picker screen from U0.4's spec, plus its route and
      its side-menu/Settings entry point.
      **AC:** picking a language PATCHes the account, re-renders the app in it
      without a manual reload, and shows a success haptic; a non-admin sees the
      current language and cannot change it; a failed PATCH keeps the selection
      and shows the error; the three languages are listed by endonym.
- [ ] **U3.12** `bot/i18n.py` + language resolution, EN catalogue only.
      **AC:** the language is resolved **from the `GET /users/me` probe
      `AllowlistMiddleware` already makes** and cached beside the allow verdict
      (D707) — no extra round-trip per update; handlers receive it as injected
      data and never fetch it themselves; a cache miss falls back to `en` and
      logs, never raises.
- [ ] **U3.13** Extract `bot/keyboards.py` + `bot/handlers/common.py` +
      `expenses.py`.
- [ ] **U3.14** Extract `bot/handlers/categories.py` + `tags.py` +
      `budgets.py` + `statistics.py` + `bot/charts.py` labels.
      **AC (U3.13–U3.14, each):** no user-visible literal remains in the files
      the unit owns, button captions included; the bot's EN output is
      unchanged; RU and UK render for an account set to them.
- [ ] **U3.15** RU + UK bot catalogues + the cross-surface key test.
      **AC:** bot and webapp catalogues are each internally key-complete; a
      test fails on any language missing a key in either surface.

### M4 — Admin panel and blocking (item 2)
Every unit in M4 is written **catalogue-native** (D700) and every unit
touching auth or scoping goes through the reviewer subagent.

- [ ] **U4.1** Contracts + migration: `Role.SYSTEM_ADMIN`,
      `users.is_blocked`, `accounts.is_blocked`, `models/admin.py`,
      `docs/SCHEMA.sql`. **Ask the human before writing the migration file.**
      **AC:** upgrade/downgrade clean; every existing row reads back
      `is_blocked = false`; `resolve_permission`'s matrix has an explicit,
      tested entry for the new role (it behaves as `admin` inside its own
      account); `verify.sh` green; no route behaviour changes yet.
- [ ] **U4.2** The block gate in `get_current_user`, and `require_admin`
      accepting a system admin.
      **AC:** a blocked user gets **403 with a distinguishable detail**, not
      401 (D713); a user in a blocked account gets the same 403 even though
      their own `is_blocked` is false; an unblocked user in an unblocked
      account is unaffected; **both** credential paths (bot headers and
      Mini App `initData`) are gated by the same code and both are tested;
      `require_admin` admits `system_admin`. **Reviewer pass required.**
- [ ] **U4.3** `require_system_admin` + `api/admin.py`: `GET /admin/accounts`,
      `GET /admin/users`.
      **AC:** the router is the **only** module reading users or accounts
      outside the caller's `account_id`, and says so in its docstring; every
      role but `system_admin` gets 403, including a plain `admin` (tested);
      the endpoints are unreachable without a valid credential.
      **Reviewer pass required.**
- [ ] **U4.4** `POST /admin/accounts` — creates the account, its first user and
      the seeded "General" category **in one transaction**.
      **AC:** a duplicate `owner_tg_id` is 409, not a 500 (`users.tg_id` is
      UNIQUE); a failure anywhere leaves no partial account behind (tested);
      the created account is immediately usable by the new user with no bot
      restart; `owner_id` is set on the account row.
- [ ] **U4.5** `PATCH /admin/users/{id}/block` and
      `PATCH /admin/accounts/{id}/block`.
      **AC:** blocking an account revokes every user in it without writing
      `users.is_blocked` (one flag, one place — D714); unblocking restores
      exactly the users who were not individually blocked; a system admin
      cannot block themselves or their own account (422, tested).
- [ ] **U4.6** The bot's suspended path.
      **AC:** a blocked caller gets the suspended message in the account's
      language, not silence and not a stack trace; the allow-cache's TTL can
      delay that *message* by up to `ttl_ok`, but no backend call ever succeeds
      in that window (D715) — a test asserts the 403, not the message timing.
- [ ] **U4.7** Mini App admin screen: the accounts and users lists.
      **AC:** matches U0.5's spec; loading, empty, error and offline states all
      render; a non-system-admin reaching the route directly sees the 403
      state, not a blank screen.
- [ ] **U4.8** Mini App admin screen: the block toggles.
      **AC:** every block/unblock goes through Telegram's confirm popup naming
      the target; exactly one PATCH regardless of taps; the list reflects the
      new state without a full reload; a failed PATCH restores the previous
      toggle state and shows the error.
- [ ] **U4.9** Mini App admin screen: the create-account form.
      **AC:** name, currency, language, owner `tg_id` and owner name are all
      required; a non-numeric `tg_id` is caught client-side; a 409 renders as
      "that Telegram user already has an account", not a generic failure.
- [ ] **U4.10** The eighth side-menu row, gated on the role, plus the docs.
      **AC:** the Admin row is the **last** row, after Settings, and is
      **absent from the DOM** for every other role — not dimmed, not
      `aria-hidden`; `CLAUDE.md`'s "Out of scope (V2)" section no longer lists
      the admin panel and its "adding users manually" note points at the panel;
      `docs/ui/components/side-menu.md`'s row count and ACs match the code.

## Risks
- **M3 is a 300-plus-string mechanical pass across 17 TS files and 8 Python
  files.** The risk is not difficulty, it is drift: a half-extracted screen
  passes `verify.sh` happily. The mitigation is the per-unit AC "no
  user-visible literal remains in the files this unit owns" plus the
  key-identity test — and the fact that each unit owns whole files, never
  parts of them.
- **A grep-based "no literals" gate would be nice and is not specified.**
  Template-literal HTML makes it unreliable enough to produce false failures on
  `data-testid` and `aria` plumbing. Left as an open question rather than a
  half-working gate in `verify.sh`.
- **M4 deliberately breaches account isolation.** Every existing repo call is
  `account_id`-scoped and that scoping is the security model. One router steps
  outside it. If `require_system_admin` is ever wrong, it is wrong for every
  account at once. Hence: its own module, its own dependency, a docstring that
  says so, and a reviewer pass on U4.2/U4.3.
- **Adding a fourth `Role` touches code that predates this plan** —
  `resolve_permission`'s matrix, `require_admin`, the permission seeding on
  user creation, and every test that enumerates roles. U4.1's AC covers the
  matrix explicitly for that reason.
- **`AllowlistMiddleware` caches allow verdicts for `ttl_ok` (300s).** Blocking
  a user does not stop their updates reaching handlers for up to five minutes.
  It does stop every backend call in that window (the 403 gate is
  server-side), so the exposure is a confusing error, not access. D715.
- **Two migrations in one plan**, both against a live Supabase database, both
  under the "ask first" rule. They are deliberately in different milestones so
  neither is bundled with behaviour.
- **The M2 period rewrite deletes `PERIOD_PRESETS`**, which the statistics
  tests assert against. Expect the test file to change shape, not just gain
  cases — and expect the *bot's* three statistics presets to now differ from
  the Mini App's five. That divergence is accepted (D708), not a bug to
  "fix" by touching `bot/keyboards.py` mid-unit.

## Decision log
- 2026-08-25: **D700** — Milestone order is M0→M1→M2→M3→M4, and M4 is written
  catalogue-native. Because extracting strings from markup that is still moving
  costs the work twice, and translating the admin panel after building it in
  English costs it twice again. Rejected: i18n first (M1/M2 would each have to
  add keys in three languages for regions they are still reshaping).
- 2026-08-25: **D701** — Language lives on `accounts`, not `users`, per the
  brief. One family, one language. Rejected: `users.language` with an account
  default — real, but the brief asked for the account and the override is
  additive later.
- 2026-08-25: **D702** — EN + RU + UK in V7, chosen with the human. Every added
  language is a catalogue that must stay key-complete forever; adding a fourth
  later is a data-only change with no code in it. Rejected: seven "most
  popular" languages — the translation content would dominate the diff and
  could not be reviewed for correctness by anyone on this project.
- 2026-08-25: **D703** — Screens 06 and 07 drop the **entire** `{count} ·
  {amount}` caption, count included, not just the amount. **Confirmed with the
  human (2026-08-25):** "removing the entire {quantity} · {amount} heading […]
  it is unnecessary information in those places". Both the visible caption
  (`categories.ts:252` and the tags equivalent) and the amount inside the row's
  accessible name (`categories.ts:257`) go. The usage count keeps being
  **fetched** — it drives hide-vs-delete (D305) — it is only never rendered.
- 2026-08-25: **D704** — Statistics adopts the shared period selector and
  `months_back` disappears from the client. The backend keeps accepting
  `months_back` — the bot still sends it — so this is a client change only.
  Rejected: adding the five units *beside* the three presets (two competing
  period vocabularies on one screen).
- 2026-08-25: **D705** — Tag chips order by all-time `expense_count`
  descending, `created_at ASC` tiebreak: the same rule, the same shape and the
  same test names V6's D604 gave categories. A second ordering rule for tags
  would be a coin flip nobody could later justify.
- 2026-08-25: **D706** — Where the language picker lives (a row inside
  Settings vs. its own side-menu destination) is decided **in U0.4's spec**,
  not here. Both are defensible; the spec is where that choice belongs and it
  gates no other unit. **Resolved in U0.4 (2026-08-25): a row inside
  Settings**, leading to its own new screen (`docs/ui/screens/09-language.md`).
  Rejected: an eighth side-menu row — it is exactly the kind of
  account-preference item Settings already exists to hold (the same reasoning
  Currency used in V4), and it would push U0.5's Admin row to a ninth
  position instead of the plan's stated "eighth row, after Settings".
- 2026-08-25: **D707** — The bot resolves the account language from the
  `GET /users/me` probe `AllowlistMiddleware` already performs, cached beside
  the allow verdict. Rejected: a fetch per update (a round-trip per keystroke
  in a conversation) and a language in the FSM state (stale after a change,
  and absent for the first update of every conversation).
- 2026-08-25: **D708** — The bot's statistics keeps its three `months_back`
  presets; only the Mini App gets the five units. The surfaces diverge on
  purpose: the period selector is a two-row tab control that inline keyboards
  render badly. Revisit only if the user asks.
- 2026-08-25: **D709** — The language applied at first paint comes from the
  client cache, not from the network. `boot()` paints before `/users/me`
  resolves, so a network-first rule would flash English chrome on every cold
  open; a cache-first rule is wrong only on the first launch after a language
  change, and self-corrects one render later. Rejected: blocking `boot()` on
  the request (a white screen on a slow connection, for chrome text).
- 2026-08-25: **D710** — System Admin is a **fourth `Role` value**, not a
  boolean column and not a separate table. The role column already exists,
  already flows through `PermissionChecker`, and already appears in
  `UserResponse`. Rejected: `users.is_system_admin` — a second authority
  mechanism beside the role matrix.
- 2026-08-25: **D711** — Cross-account reads and writes live **only** in
  `api/admin.py`, behind `require_system_admin`. No existing repository or
  service loses its `account_id` argument. Rejected: an `account_id=None`
  "means all" convention on the existing repos — one forgotten `None` check
  away from leaking every account through a normal route.
- 2026-08-25: **D712** — A system admin still belongs to one account and
  behaves as its `admin` there. Rejected: an accountless super-user — every
  table in this schema has a NOT NULL `account_id`, and `GET /users/me` would
  have nothing to answer with.
- 2026-08-25: **D713** — A blocked caller gets **403** with an explicit
  suspended detail, chosen with the human, not 401. A suspended family member
  should not be told they are unregistered.
- 2026-08-25: **D714** — Blocking an account sets `accounts.is_blocked` only;
  it never mass-writes `users.is_blocked`. So unblocking restores exactly the
  users who were not individually blocked, with no bookkeeping of prior state.
- 2026-08-25: **D715** — The allowlist cache's `ttl_ok` lag on a fresh block is
  accepted, not engineered around. The 403 gate is server-side and immediate,
  so the window costs a confusing error message, never access. Rejected:
  dropping `ttl_ok` to zero (a `/users/me` per update) and a cache-invalidation
  channel from backend to bot (a message bus this project does not have).

## Open questions
- [?] **A "no literals" lint** in `scripts/verify.sh` after M3. Template-literal
  HTML makes a naive grep noisy. If M3's per-unit ACs prove insufficient, this
  becomes its own unit rather than a rushed regex.
- ~~[?] **Locale-aware number and date formatting.**~~ — **answered in U0.4's
  spec (2026-08-25): out of scope for V7.** `formatAmount` and the period
  selector's `describe` keep the browser's default locale regardless of the
  account's language; the plan's own Non-goals already draw the "only chrome
  is translated" line for stored data, and this extends it to formatting.
  Touches every screen that renders a number or a date, not just the language
  picker — a decision for its own plan if ever wanted, not a U3.x unit here.
- [?] **The Mini App's `Language` union vs. the Python enum.** `api/types.ts` is
  hand-written by rule; a third place to add a language code. Accepted for
  V7 (three codes), worth revisiting if the list grows.

## STATE (handoff)
- **Done:** Planning only. The five items were read against the code on
  2026-08-25 and the "Review of the brief" section is the result — items 3, 4
  and 5 are much smaller than they read, item 1 is much larger, item 2 crosses
  the security model. Four scope decisions were taken with the human: bot **and**
  Mini App are translated (D701 scope), EN+RU+UK (D702), System Admin is a
  global cross-account superuser (D711/D712), and a blocked caller gets a 403
  with an explicit message (D713). A fifth followed: the whole caption goes,
  count included (D703). **U0.1 is done**: `docs/ui/screens/06-categories.md`
  and `07-tags.md` are revised — Anatomy drops the caption line/element, Copy
  drops `cell.caption.*`/`row.caption.*`, Accessibility now states the
  accessible name is the category/tag name alone, and both files' Data
  sections state explicitly that `include_usage=true` stays on the
  `GET /categories`/`GET /tags` calls for hide-vs-delete (D305) even though
  nothing renders the count. Left an open call for U1.1/U1.2, not decided
  here: whether `GET /statistics/by-category`/`by-tag` (the now-unconsumed
  this-month-total fetch) is dropped or left unused.
- **U0.2 is done**: `docs/ui/screens/02-add-expense.md`'s Tags section now
  states the chip-row ordering in the same words `../components/category-picker.md`'s
  Ordering section gives the category grid (all-time `expense_count`
  descending, `created_at ASC` tiebreak, a zero/absent count sorting last
  among itself by `created_at ASC`) — D705's rule, just applied to this
  screen's spec, no new decision needed. The Data row for `GET /tags` now
  states `include_usage=true` the same way the `GET /categories` row does.
  "+ Add tag" stays the last chip regardless of order; a freshly created tag
  (0 uses) sorts among the unused tags, not to the front. No new component
  file was created for tags — Add Expense's Tags section already owned this
  spec directly (there is no `tag-picker.md`, unlike categories), so the
  ordering rule lives inline rather than in a new component doc.
- **U0.3 is done**: `docs/ui/screens/05-statistics.md` is written from the
  shipped `webapp/src/screens/statistics.ts` + `api/statistics.py`, then the
  V7 delta applied — the three `months_back` preset chips are replaced by
  `../components/period-selector.md` (Day/Week/Month/Year/Period, offset
  arrows, jump-to-present), with a "Period" tab opening
  `../components/date-range-picker.md` in `"range"` mode, exactly as Home
  already does. `docs/ui/components/period-selector.md` is updated in the
  same change — its "Used by screen 01 only" note and its "Statistics is out
  of scope" Resolved bullet were both false the moment this spec named it a
  second consumer. `docs/design/mini-app-ux.md` §4 screen 05's old chip table
  is **not** edited — the new spec states it supersedes that table, the same
  pattern `01-home.md` used for its own three-chip supersession (D700's
  ordering: M0 documents the delta, M2 implements it). Two shipped
  discrepancies were documented rather than silently reproduced or fixed:
  region 2 (period selector + donut) is **not** wrapped in a `.chart-card`
  the way Home's region 2 is — kept bare on the page background, matching
  where the preset chips it replaces already sat, flagged `[?]`; and the
  donut's stroke-width is 26px here vs. Home's 30px (Home was thickened in
  V4, this screen never was) — also flagged `[?]`, not corrected. Six other
  `[?]`s were left open in the new file for M2 to pick up or ignore (see the
  file's Open questions): the donut's missing `aria-label`, the bar tap not
  carrying the period (unlike Home's V4 ranked-row tap), the single-generic-
  string empty copy vs. Home's five period-named strings, and the period
  control not freezing while offline (unlike Home's `disabled` prop). None of
  these blocks M2 — they are pre-existing shipped behaviour, stated so M2
  doesn't have to rediscover them, and none is required by the V7 brief.
- **U0.4 is done**: `docs/ui/screens/09-language.md` is written — a
  three-row `--card` list (EN/RU/UK by endonym, `models/enums.py::Language`'s
  order) reached **only** from a new "Language" row inside Settings, never a
  side-menu destination (D706, resolved this unit). Its interaction model
  deliberately diverges from Currency's: no MainButton, no confirm popup, no
  discard flow — a row tap *is* the PATCH, per U3.11's own AC wording
  ("picking a language PATCHes the account"), because language carries no
  financial risk the way relabelling every amount does. A successful change
  calls `i18n.setLanguage()` directly off the PATCH response and re-renders
  the app's chrome in place — no page reload, and no wait for a `/users/me`
  refetch (that refetch-driven pattern is Currency's, not this one's). Three
  files got small deltas in the same change: `08-settings.md` gained a
  "Language" section (region 4/5, one navigation row, no `✓` of its own —
  the picker's `radiogroup` lives entirely on the new screen) and its "Anything
  else in Settings" open question is now answered; `side-menu.md` gained a
  Resolved entry recording that the drawer stays at seven rows, so U0.5's
  Admin row is still the literal eighth; `design-system.md`'s `✓` icon usage
  list now names screen 09 alongside 08 and 06b, keeping that table accurate
  (same kind of same-change touch U0.3 gave `period-selector.md`). The plan's
  own open question on locale-aware number/date formatting was also resolved
  here, as asked: **out of scope for V7** — `formatAmount` and the period
  selector's `describe` stay in the browser's default locale regardless of
  the account's language, extending the "only chrome is translated" rule
  Non-goals already states for stored data.
- **U0.5 is done**: `docs/ui/screens/10-admin.md` is written — a single file
  covering both required surfaces, per its own AC: a **List mode** (stacked
  "Accounts"/"Users" `--card` lists, reusing `08-settings.md`'s row rhythm)
  and a **Create-account mode** (an in-screen Save/Cancel form reached via
  MainButton, reusing `04b-budget-form.md`'s reasoning for hiding MainButton
  once a Cancel affordance exists). Block/unblock on either list reuses
  `06c-category-delete.md`'s Telegram-`showConfirm`-then-optimistic-patch
  shape — every block or unblock is confirmed and named before it fires, and
  a failed `PATCH` reverts the row rather than reloading the list. `side-
  menu.md` got its second pass of the session (as the plan's Ordering note
  anticipated): Anatomy/Variants/Copy/Inputs/Acceptance-criteria all now
  state the eighth "Admin" row, gated on `role === "system_admin"`, sitting
  directly under Settings with no new gap. A new "Admin row visibility"
  section documents **why** this is the one row in the app that hides rather
  than dims: every other conditional row (Add expense for a viewer, Currency
  for a non-admin) dims a capability the viewer's *own* account admin could
  eventually grant them; System Admin is assigned only by direct DB access
  (no in-app path ever unlocks it), so dimming would falsely imply an
  in-account path to it, and the row's mere presence would disclose a
  cross-account superuser role to people who have no reason to know it
  exists. One load-bearing modelling decision, not asked for explicitly but
  required to satisfy D714's "one flag, one place" split: because blocking
  an account never writes `users.is_blocked`, a user row shows "Suspended"
  when *either* its own flag is set *or* its `account_name` matches a
  currently-blocked row already loaded in the Accounts list above — computed
  client-side from the two lists this screen already holds, no extra fetch.
  A user whose account is blocked also gets its own Block/Unblock trigger
  disabled (`disabled.accountBlocked`), since toggling it would change
  nothing the user actually experiences. The screen also disables the
  caller's own account/user Block trigger client-side, ahead of U4.5's
  server-side 422 for the same case. No `docs/ui/design-system.md` edit was
  needed — every token, spacing value and typography role this file uses
  already existed, per the plan's own Constraint to reuse the existing
  list-row rhythm rather than invent a third one. Left open, not decided
  here: Currency/Language in the create form use a plain `<select>` rather
  than this app's usual full-screen-radiogroup/sheet picker pattern
  (flagged `[?]`, a deliberate scope-saving call for a screen only one
  persona ever opens); list ordering for both Accounts and Users
  (`[inferred]`); and — most notably — **which screen actually renders the
  "this account has been suspended" copy a blocked caller sees**. That copy
  is defined in `10-admin.md` (block semantics live there), but rendering it
  is cross-cutting (most likely Home, extending its existing 403 state) and
  is explicitly left for whichever M4 unit wires the 403 detail through, or
  a decision of its own.
- **U1.1 is done**: `webapp/src/screens/categories.ts` no longer renders the
  per-row caption (`captionText`/`captionAriaLabel`, `.cat-cell-caption`,
  `.cat-archived-caption`) on either the active grid or the archived row
  list — both cells are swatch + name only, and each accessible name is now
  just the category name (`aria-label="Groceries"`), matching the revised
  spec's Accessibility section verbatim. `GET /categories` still sends
  `include_usage=true` (a test asserts the exact call args), and
  `categoryDeleteOutcomeKind`/`categoryDeleteTriggerLabel` (the hide-vs-delete
  branch, D305) are untouched — they read `expenseCount`, which stays on
  `CategoryRow`. Per the spec's explicit "implementation choice" note, this
  unit **also dropped** `monthTotalMinor`/`monthTotalFor` from
  `CategoryRow`/`buildCategoriesData` and the `GET /statistics/by-category`
  call from `loadCategories` (and `statisticsByCategory` from the
  `CategoriesApi` interface) — that fetch had no remaining consumer once the
  amount half of the caption was gone, so keeping it would have been dead
  code. `getMe()`/`CategoriesData.currency` were deliberately left alone even
  though nothing on this screen formats an amount any more — the spec's Data
  table still lists that call without flagging it as removable, unlike the
  statistics call, so removing it would have been a drive-by beyond this
  unit's boundary. `webapp/tests/categories.test.ts` updated to match (no
  `monthTotals`/`CategoryTotal` fixtures, aria-label assertions now check the
  bare name).
- **Next:** `/clear`, then **U1.2** (Tags screen, same change — mirror U1.1's
  approach in `webapp/src/screens/tags.ts`, including the same call as here
  on whether `GET /statistics/by-tag` still has a consumer). M0 is complete:
  all five spec files (`06-categories.md`/`07-tags.md` revised,
  `02-add-expense.md` revised, `05-statistics.md` new, `09-language.md` new,
  `10-admin.md` new) and their `side-menu.md`/`08-settings.md`/
  `design-system.md`/`period-selector.md` deltas exist. No unit in M1–M4 may
  start before the spec it decomposes — that gate is satisfied for all four
  remaining milestones.
- **Gotchas the next session must know:**
  - **U3.11 has no MainButton and no confirm popup.** `09-language.md`
    deliberately made the language picker tap-to-apply — a row tap fires the
    `PATCH` directly. Do not port Currency's select-then-save pattern over by
    habit; the spec's Delta section explains why the two screens diverge.
  - **Do not "add period support" to `api/statistics.py`.** It is already
    there and already validated. M2 is client wiring; a Python diff in M2 is
    the signal to stop.
  - **Do not stop passing `include_usage=true`** in U1.2 (`tags.ts`, mirroring
    U1.1's `categories.ts`). The count still drives hide-vs-delete (D305);
    only the rendering goes, and the accessible name becomes the tag name
    alone, same as U1.1.
  - **`sortCategoriesByUsage` already exists** at `add-expense.ts:147`. U1.3
    mirrors it; it does not generalise it into a shared helper, because
    `CategoryResponse` and `TagResponse` are separate hand-written mirrors by
    rule and a generic would outlive its usefulness in one file.
  - **`require_admin` (`api/deps.py:310`) rejects `system_admin`** as written.
    Every M4 unit that adds a role check reads that line first.
  - **Two "ask the human first" migrations** (U3.1, U4.1). `migrations/versions/`
    is under the do-not-edit-without-asking rule.
  - **The language is not available at first paint** (U3.3). `boot()` renders
    Home's skeleton immediately and only `loadHome` fetches `/users/me`, so
    waiting for the response means a frame of English chrome on every cold
    open. Read it from the cache at boot, reconcile after (D709) — and do not
    add a second `/users/me` fetch to work around it.
  - **Do not touch `assignCategoryColors`** (V6's gotcha, still true) and **do
    not batch `GET /budgets`' progress** (V5's gotcha, still true).
  - The webapp's vitest DOM tests need the per-file
    `// @vitest-environment jsdom` docblock — the config sets no global default
    (V6's U0.5).
