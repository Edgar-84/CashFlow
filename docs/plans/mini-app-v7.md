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
export type Catalogue = Record<keyof typeof en, string>;   // EN is the key
                                                             // registry (D717:
                                                             // string values,
                                                             // not EN's exact
                                                             // literals, so
                                                             // RU/UK can differ)
export const catalogues: Record<Lang, Catalogue>;    // D717 — exported so
                                                      // tests can assert
                                                      // key-identity
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
- [x] **U1.2** Tags screen, same change.
      **AC:** as U1.1, for screen 07 and `listTags`.
- [x] **U1.3** Tag chips ordered most-used first.
      **AC:** `sortTagsByUsage` mirrors `sortCategoriesByUsage` exactly —
      `expense_count` descending, `created_at ASC` tiebreak, absent/null
      counts as 0, no throw; `loadAddExpenseData` passes
      `{ includeUsage: true }`; with Taxi=100, Entertainment=30, Fast Food=5
      the chips render in that order; "+ Add tag" is still last.

### M2 — Statistics period filters (item 4)
- [x] **U2.1** `loadStatistics`/`buildStatisticsData` take a `PeriodValue`
      instead of `monthsBack`; `PERIOD_PRESETS` is deleted.
      **AC:** the three statistics calls send `period`/`offset` (or
      `start_date`/`end_date`) and never `months_back`; no bound is computed in
      the browser; the never-throws/cache-fallback contract is unchanged; unit
      tests cover each of the five units.
- [x] **U2.2** The screen renders `period-selector` and re-fetches on a unit or
      offset tap.
      **AC:** the five tabs appear in the order Day · Week · Month · Year ·
      Period; a unit tap resets offset to 0; the offset arrows clamp at 0
      (no future period); the grouping toggle still re-renders **without**
      refetching; the donut and bars both follow the selected period.
- [x] **U2.3** The "Period" tab opens `date-range-picker` and a custom range
      drives the screen.
      **AC:** picking a range sends `period=custom` with both dates and no
      `offset`; cancelling leaves the previous selection intact; the label row
      shows the chosen range; the selection survives a drill-down and return.

### M3 — Language (item 1)
- [x] **U3.1** Contracts + migration: `Language` enum, `accounts.language`,
      the three model changes above, `docs/SCHEMA.sql`. **Ask the human before
      writing the migration file.**
      **AC:** `alembic upgrade head` then `downgrade -1` runs clean on a
      throwaway DB (`scripts/integration_docker.sh`); every existing account
      reads back `en`; `verify.sh` green; **no route behaviour changes yet.**
- [x] **U3.2** Backend: `GET /users/me` returns `language`; `PATCH
      /accounts/me` accepts it.
      **AC:** the PATCH is admin-only, the same gate the currency change uses;
      an unknown code is 422, not a 500; changing the language leaves currency
      untouched and vice versa; tests cover both fields in one PATCH.
- [x] **U3.3** `webapp/src/lib/i18n.ts` + boot wiring, EN catalogue only.
      **AC:** `t()` returns the EN string; an unknown key fails the build
      (typed key union), never renders at runtime; `setLanguage` runs **before
      any screen renders**, not when `GET /users/me` resolves — `boot()` paints
      Home's skeleton first (`main.ts:1051` → `showHome`, whose loader is what
      actually fetches `/users/me`), so the language is read from the same
      cache the app already uses for offline snapshots and only reconciled
      against the server response (D709); interpolation is escaped, never
      injected as HTML.
- [x] **U3.4** RU + UK catalogues for the keys that exist so far.
      **AC:** a test asserts all three catalogues have **identical key sets**
      and fails on a missing or extra key; no catalogue contains markup.
- [x] **U3.5** Extract `home.ts` + `components/side-menu.ts`.
- [x] **U3.6** Extract `add-expense.ts` (the largest single file, ~33 strings).
- [x] **U3.7** Extract `expenses.ts` + `expense-detail.ts`.
- [x] **U3.8** Extract `budgets.ts` + `budget-form.ts`.
- [x] **U3.9** Extract `categories.ts` + `tags.ts`.
- [x] **U3.10** Extract `settings.ts` + `statistics.ts` + the remaining
      components (`period-selector`, `date-range-picker`, `category-picker`,
      `color-picker`, `toast`) + `main.ts`.
      **AC (U3.5–U3.10, each):** no user-visible literal remains in the files
      the unit owns — including `aria-label`s, `alt` text, MainButton labels,
      Telegram popup copy and error strings; all three catalogues stay
      key-identical; the rendered EN output is byte-identical to before the
      unit (that is the regression test); `verify.sh` green.
- [x] **U3.11** The language picker screen from U0.4's spec, plus its route and
      its side-menu/Settings entry point.
      **AC:** picking a language PATCHes the account, re-renders the app in it
      without a manual reload, and shows a success haptic; a non-admin sees the
      current language and cannot change it; a failed PATCH keeps the selection
      and shows the error; the three languages are listed by endonym.
- [x] **U3.12** `bot/i18n.py` + language resolution, EN catalogue only.
      **AC:** the language is resolved **from the `GET /users/me` probe
      `AllowlistMiddleware` already makes** and cached beside the allow verdict
      (D707) — no extra round-trip per update; handlers receive it as injected
      data and never fetch it themselves; a cache miss falls back to `en` and
      logs, never raises.
- [x] **U3.13** Extract `bot/keyboards.py` + `bot/handlers/common.py` +
      `expenses.py`.
- [x] **U3.14** Extract `bot/handlers/categories.py` + `tags.py` +
      `budgets.py` + `statistics.py` + `bot/charts.py` labels.
      **AC (U3.13–U3.14, each):** no user-visible literal remains in the files
      the unit owns, button captions included; the bot's EN output is
      unchanged; RU and UK render for an account set to them.
- [x] **U3.15** RU + UK bot catalogues + the cross-surface key test.
      **AC:** bot and webapp catalogues are each internally key-complete; a
      test fails on any language missing a key in either surface.

### M4 — Admin panel and blocking (item 2)
Every unit in M4 is written **catalogue-native** (D700) and every unit
touching auth or scoping goes through the reviewer subagent.

- [x] **U4.1** Contracts + migration: `Role.SYSTEM_ADMIN`,
      `users.is_blocked`, `accounts.is_blocked`, `models/admin.py`,
      `docs/SCHEMA.sql`. **Ask the human before writing the migration file.**
      **AC:** upgrade/downgrade clean; every existing row reads back
      `is_blocked = false`; `resolve_permission`'s matrix has an explicit,
      tested entry for the new role (it behaves as `admin` inside its own
      account); `verify.sh` green; no route behaviour changes yet.
- [x] **U4.2** The block gate in `get_current_user`, and `require_admin`
      accepting a system admin.
      **AC:** a blocked user gets **403 with a distinguishable detail**, not
      401 (D713); a user in a blocked account gets the same 403 even though
      their own `is_blocked` is false; an unblocked user in an unblocked
      account is unaffected; **both** credential paths (bot headers and
      Mini App `initData`) are gated by the same code and both are tested;
      `require_admin` admits `system_admin`. **Reviewer pass required.**
- [x] **U4.3** `require_system_admin` + `api/admin.py`: `GET /admin/accounts`,
      `GET /admin/users`.
      **AC:** the router is the **only** module reading users or accounts
      outside the caller's `account_id`, and says so in its docstring; every
      role but `system_admin` gets 403, including a plain `admin` (tested);
      the endpoints are unreachable without a valid credential.
      **Reviewer pass required.**
- [x] **U4.4** `POST /admin/accounts` — creates the account, its first user and
      the seeded "General" category **in one transaction**.
      **AC:** a duplicate `owner_tg_id` is 409, not a 500 (`users.tg_id` is
      UNIQUE); a failure anywhere leaves no partial account behind (tested);
      the created account is immediately usable by the new user with no bot
      restart; `owner_id` is set on the account row.
- [x] **U4.5** `PATCH /admin/users/{id}/block` and
      `PATCH /admin/accounts/{id}/block`.
      **AC:** blocking an account revokes every user in it without writing
      `users.is_blocked` (one flag, one place — D714); unblocking restores
      exactly the users who were not individually blocked; a system admin
      cannot block themselves or their own account (422, tested).
- [x] **U4.6** The bot's suspended path.
      **AC:** a blocked caller gets the suspended message in the account's
      language, not silence and not a stack trace; the allow-cache's TTL can
      delay that *message* by up to `ttl_ok`, but no backend call ever succeeds
      in that window (D715) — a test asserts the 403, not the message timing.
- [x] **U4.7** Mini App admin screen: the accounts and users lists.
      **AC:** matches U0.5's spec; loading, empty, error and offline states all
      render; a non-system-admin reaching the route directly sees the 403
      state, not a blank screen.
- [x] **U4.8** Mini App admin screen: the block toggles.
      **AC:** every block/unblock goes through Telegram's confirm popup naming
      the target; exactly one PATCH regardless of taps; the list reflects the
      new state without a full reload; a failed PATCH restores the previous
      toggle state and shows the error.
- [x] **U4.9** Mini App admin screen: the create-account form.
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
- 2026-08-25: **D716** — U3.3's boot wiring calls `setLanguage` in exactly two
  places: `main.ts::boot` seeds `"en"` (the only content this unit ships)
  before any screen renders (D709), and `screens/home.ts::loadHome` reconciles
  it against the account's real language right where it already destructures
  the same `GET /users/me` response for `currency`/`today`/`account_name` —
  reusing that call rather than adding a second fetch (the plan's own
  gotcha). The reconciled value is a side effect only, deliberately **not**
  added to `HomeData`/`HomeState`'s shape — `loadHome` already has one
  precedent for a side effect (`cache.set`), and no screen consumes `language`
  yet, so widening the shape would only cascade into every exact-equality
  fixture in `home.test.ts` that has nothing to do with language. A screen
  that later needs to react to a language change (starting with U3.11's
  picker) calls `setLanguage` itself off its own response, per the contract's
  own two documented call sites. Rejected: widening `HomeData` now (large,
  premature test churn for an unconsumed field); a dedicated `/users/me` fetch
  for language alone (explicitly forbidden); `localStorage` persistence across
  reloads (not in the Contracts section, and the module's in-memory default
  already matches the "cache the app already uses for offline snapshots"
  pattern every other screen's `createMemoryCache` follows).

- 2026-08-25: **D717** — U3.4 widens `Catalogue` from `typeof en` (EN's exact
  literal string values) to `Record<keyof typeof en, string>`, and exports the
  previously module-private `catalogues` map. Necessary because the original
  `typeof en` contract pinned every language to EN's literal string content —
  workable only while `ru`/`uk` aliased `en` outright, and no longer once they
  need their own translations. `keyof Catalogue` is unchanged (`Record<K,
  string>`'s `keyof` still resolves to `K`), so `t()`'s signature and the
  unknown-key-fails-the-build guarantee both hold; `catalogues` is exported
  only so `tests/i18n.test.ts` can assert the three catalogues stay
  key-identical without hand-duplicating EN. Neither change alters `Lang`,
  `setLanguage`, or `t`'s shape. Flagged by the reviewer as a contract update
  that hadn't reached this section; fixed here rather than left silently
  stale for U3.5+ to stumble on.
- 2026-08-26: **D718** — `bot/keyboards.py`'s builder functions take
  `language: Language = Language.EN`, defaulted rather than required, even
  though this unit (U3.13) translates every literal in the file, including
  `tags_keyboard`/`budgets_keyboard`/`statistics_keyboard`, whose captions
  are called from `bot/handlers/tags.py`/`categories.py`/`budgets.py`/
  `statistics.py` — files U3.14 owns, not this unit. The default lets those
  not-yet-updated call sites keep compiling and rendering byte-identical EN
  output without U3.13 reaching into their files ("no drive-by edits to
  unrelated code" — the /unit-auto workflow's own instruction, not
  CLAUDE.md); `bot/handlers/expenses.py`, this unit's own
  caller, always passes the real resolved `language` explicitly, never
  relies on the default. U3.14 closes the gap when it extracts those four
  files: passing the real `language` into these same keyboard calls is then
  a one-line addition alongside each file's own literal-string work, not a
  new problem to discover. Rejected: touching `tags.py`/`budgets.py`/
  `statistics.py` now just to thread a parameter through — would pull three
  U3.14-owned files into this unit's diff for zero behavioural change (RU/UK
  still alias EN until U3.15 regardless).
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
- 2026-08-28: **D719** — U4.3's cross-account reads go through a thin
  `AdminService` and `list_for_admin()` repo methods, not raw SQL inlined in
  `api/admin.py`. D711 names "its own router, its own dependency" as the
  carve-out from account-scoping, but root CLAUDE.md's routes→services→
  repositories layering is non-negotiable and isn't suspended by D711 — only
  the *scoping rule* is. `api/admin.py`'s module docstring states it is the
  only router reading across account boundaries; `AdminService` and
  `AccountRepository.list_for_admin`/`UserRepository.list_for_admin` are its
  sole callers, so the unscoped read is still contained to one surface, just
  spread across the normal three layers instead of collapsed into the route
  function.
- 2026-08-28: **D720** — U4.4's cross-repo atomicity (account + owner user +
  seeded "General" category, one transaction) is implemented by adding a thin
  `BaseRepository.transaction()` method (returns `self._conn.transaction()`)
  rather than a full Unit-of-Work class. `repositories/CLAUDE.md`'s D31 note
  had already flagged this as the first genuinely atomic cross-repo write and
  invited "a small UoW or a transactional variant of `get_connection`" —
  `transaction()` is that small variant: every repo built for one request
  already shares the same connection (`database.get_connection` is cached
  per request by FastAPI), so `AdminService.create_account` opens
  `account_repo.transaction()` and then calls `user_repo.create`/
  `category_repo.create` inside the same `async with` block, and asyncpg
  groups all three inserts into one real transaction because it's the same
  underlying connection object. Rejected: a dedicated UoW class — no second
  caller exists yet to justify the abstraction; `transaction()` is a
  one-line, generically reusable primitive any future cross-repo write can
  reach for the same way. The owner user is created with `role=admin` (not
  a fresh role) per D712's "a system admin still behaves as `admin` inside
  its own account" — every account still needs an in-account admin, and the
  system admin creating it is not a member of it. The seeded category's
  `color_slot` is hardcoded to `1` rather than routed through
  `CategoryService._next_free_color_slot`: this is always the first category
  of a brand-new, empty account, so the two are provably equivalent, and
  calling the per-account-scoped `CategoryService` from this cross-account
  surface would be the kind of layering mismatch D719 already ruled out for
  reads.

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
- **U1.2 is done**: `webapp/src/screens/tags.ts` mirrors U1.1 exactly — no
  row on either the active list or the archived row list renders the
  `{count} · {amount}` caption (`captionText`/`captionAriaLabel`,
  `.tag-row-caption`) any more; each accessible name is now just the tag name
  (`aria-label="vacation"`). `GET /tags` still sends `include_usage=true` (a
  test asserts the exact call args), and `tagDeleteOutcomeKind`/
  `tagDeleteTriggerLabel` (the hide-vs-delete branch, D305) are untouched —
  they read `expenseCount`, which stays on `TagRow`. Following the same call
  U1.1 made (the spec left it as an implementation choice), this unit also
  dropped `monthTotalMinor` from `TagRow`/`buildTagsData`, the
  `GET /statistics/by-tag` call from `loadTags`, and `statisticsByTag` from
  the `TagsApi` interface — that fetch had no remaining consumer once the
  amount half of the caption was gone. `getMe()`/`TagsData.currency` were
  left alone for the same reason as `categories.ts`: the spec's Data table
  doesn't flag `GET /users/me` as removable. `webapp/tests/tags.test.ts`
  updated to match (no `monthTotals`/`TagTotal` fixtures, aria-label
  assertions now check the bare name). `TagTotal` and `client.ts`'s
  `statisticsByTag` themselves are untouched — `statistics.ts` still consumes
  both.
- **U1.3 is done**: `webapp/src/screens/add-expense.ts` gained
  `sortTagsByUsage`, mirroring `sortCategoriesByUsage` (`add-expense.ts:147`)
  exactly — all-time `expense_count` descending, `created_at ASC` tiebreak,
  absent/null count treated as 0, no throw, no shared generic across the two
  (per the file's own comment: `CategoryResponse`/`TagResponse` are separate
  hand-written mirrors by rule). `renderTagChips` now sorts through it before
  mapping to chip markup, so "+ Add tag" — appended after the sorted chips,
  untouched — stays the last chip regardless of order. `AddExpenseApi.listTags`
  gained the same optional `opts: { includeUsage?: boolean }` `listCategories`
  already had (the `ApiClient` implementation already accepted it, per U0.2's
  finding that this unit was "nearly free"), and `loadAddExpenseData` now
  calls it with `{ includeUsage: true }` instead of no args.
  `webapp/tests/add-expense.test.ts` gained a `sortTagsByUsage` describe block
  mirroring `sortCategoriesByUsage`'s four cases (including the exact
  Taxi=100/Entertainment=30/Fast Food=5 fixture named in the plan's AC), a
  `loadAddExpenseData` test asserting the `listTags({ includeUsage: true })`
  call, and a `renderForm` test asserting chip order plus "+ Add tag" still
  last. M1 is complete.
- **U2.1 is done**: `webapp/src/screens/statistics.ts`'s data layer takes a
  `PeriodValue` end to end — `StatisticsData.period`/`StatisticsState`'s
  `loading`/`error`/`empty` variants replace `monthsBack`, `StatisticsApi`'s
  three statistics methods take a `PeriodQuery` instead of `{ months_back? }`,
  and `loadStatistics(api, cache, period, grouping)` calls `toQuery(period)`
  once and passes the same query object to all three calls — mirroring
  `home.ts::loadHome`'s existing shape exactly. `PeriodPreset`/`PERIOD_PRESETS`
  are deleted, and with them `renderPresetChips` and
  `StatisticsHandlers.onPresetChange` — region 2 (the period selector) renders
  nothing between this unit and U2.2, which owns wiring
  `../components/period-selector.md` there; this unit's contract
  (mini-app-v7.md's Contracts section) only covers the data layer, so that gap
  is expected, not a regression. `main.ts`'s `showStatistics` takes
  `period: PeriodValue = { unit: "month", offset: 0 }` in place of
  `monthsBack = 0`; its one call site (the side menu's "Statistics" row)
  already called it with no arguments, so it needed no change. `api/client.ts`'s
  `StatisticsQuery` docblock was corrected in the same change — it previously
  said screen 05 "keeps sending `months_back`" (D316), which this unit makes
  false; the `months_back` alias itself is untouched (kept for the backend's
  sake, D708 — the bot still sends it). `webapp/tests/statistics.test.ts`
  updated to match: `loadStatistics`'s preset-loop test became a
  `day`/`week`/`month`/`year`/`custom` parametrized test asserting each sends
  `toQuery(period)` and never `months_back` (the AC's "unit tests cover each
  of the five units"); the "marks the active preset chip" render test was
  deleted (the chip UI it exercised no longer exists, per the above); every
  other fixture's `monthsBack: N` became `period: PeriodValue`.
- **U2.2 is done**: `webapp/src/screens/statistics.ts` now renders
  `../components/period-selector.md` in regions 2a/2b — `renderReady`/
  `renderEmpty`/`renderError` all prepend `renderPeriodControl(period, now)`
  (a new `.period-selector-slot` wrapper, bare on the page background per
  05-statistics.md's Layout table — no `.card`/`.chart-card`, unlike Home);
  `renderForbidden`/`renderSkeleton` are untouched (no live control on 403 or
  loading, per the screen doc's States table). `mount` now takes a `now: Date`
  param (mirroring `home.ts`) and, for every state with a live period selector
  (`ready`/`offline`/`empty`/`error`), calls `mountPeriodSelector` on that slot
  wiring `onUnitChange`/`onOffsetChange` straight to two new
  `StatisticsHandlers` callbacks; `disabled` is hardcoded `false` always — the
  screen doc's Edge cases explicitly states the control is **not** frozen
  offline, unlike Home's `disabled` prop. `onOpenPicker` is wired to a no-op
  with a comment pointing at U2.3, which wires the date-range picker there —
  tapping "Period" or the label does nothing yet, in scope for the next unit,
  not this one. `main.ts::showStatistics` implements the two new handlers by
  recursing into a fresh `showStatistics(period, grouping)` call (the same
  shape `onRetry` already used, not module-level state like `homePeriod`) —
  `onUnitChange` sets `{ unit, offset: 0 }`, `onOffsetChange` sets
  `{ ...period, offset: clampOffset(offset) }` (imported, already used by
  `showHome`), and both carry `grouping` through unchanged. Matches Home's own
  precedent: this wiring itself is not unit-tested (`mount`'s DOM glue is the
  file's one accepted gap, same as every other screen, and `main.ts`'s routing
  functions are never exported for testing either — confirmed by grepping
  `main.test.ts`, which only tests small pure helpers). `webapp/tests/statistics.test.ts`
  gained a `now: Date` second argument on every `renderStatistics` call (new
  `NOW` fixture, mirroring `home.test.ts`'s) and five new tests: the five tabs
  render in order with the current unit active; the next-arrow is
  `aria-disabled` at offset 0 across every live state; the control is **not**
  disabled while offline (the explicit divergence from Home); and region 2 has
  no `.chart-card` wrapper.
- **U2.3 is done**: `webapp/src/screens/statistics.ts` wires `onOpenPicker` —
  previously a no-op stub — to a new private `openPicker` plus an exported
  `pickerValueForPeriod`, both direct mirrors of `home.ts`'s own functions of
  the same name (same DOM-as-plain-child-of-`root` shape, same
  reopen-seeds-the-previous-range behaviour). The one deliberate divergence
  from `home.ts::openPicker`: Statistics' BackButton is **not** normally
  `null` the way Home's root-screen BackButton is — it navigates back to
  Home (`applyStatisticsChrome`) — so this screen's `openPicker` takes an
  explicit `onBack` param and restores *that* handler on close, instead of
  restoring to `null`. `StatisticsHandlers` gained `onApplyCustomRange`
  (same shape as `HomeHandlers`'), wired in `main.ts::showStatistics` by
  recursing into a fresh `showStatistics({ unit: "custom", offset: 0, start,
  end }, grouping)` call — the same recursive shape U2.2 already used for
  `onUnitChange`/`onOffsetChange`, not module-level state like `homePeriod`.
  No change was needed in `components/period-selector.ts` — `onOpenPicker` was
  already wired to both the "Period" tab tap and the label tap (U2.2's
  `renderPeriodControl` already passed a `noop` placeholder there, per that
  component's own contract). `period=custom` with both dates and no `offset`
  was already covered by U2.1's `PERIOD_CASES`/`toQuery` test (custom strips
  `offset`), so this unit only added `webapp/tests/statistics.test.ts`'s
  `pickerValueForPeriod` describe block, a direct mirror of
  `home.test.ts`'s. `openPicker` itself is not unit-tested — same accepted
  DOM-glue gap `mount` already has, and the same gap `home.ts::openPicker`
  has. M2 is complete.
- **U3.1 is done**: `models/enums.py` gained the `Language` StrEnum
  (EN/RU/UK, D701/D702) — `Role.SYSTEM_ADMIN` is M4.1's job and was not
  touched. `AccountResponse.language`/`AccountUpdate.language` and
  `UserMeResponse.language` were added exactly per the Contracts section (the
  M4.1 `is_blocked` fields in the same contract block were left out — not
  this unit's job). New migration
  `2026_08_25_1906-be7167499d7d_add_accounts_language.py` mirrors the
  `accounts.currency` migration precedent exactly:
  `ALTER TABLE accounts ADD COLUMN language TEXT NOT NULL DEFAULT 'en'` /
  `DROP COLUMN language` on downgrade; `docs/SCHEMA.sql`'s `accounts` table
  gained the matching column. One mechanical wiring change beyond the
  contract text itself was required, not a design decision: `UserMeResponse.language`
  is a required field, so `api/deps.py::get_current_user_with_currency` now
  also passes `language=account.language` — otherwise every `GET /users/me`
  call would 500 on a missing field. **Caught by the reviewer subagent and
  fixed in this unit, not deferred**: adding `language` to `AccountUpdate`
  alone would have silently wired `PATCH /accounts/me` to accept and persist
  it too, because `services/account_service.py::AccountService.update` built
  its repository payload generically from every set field on `AccountUpdate`
  with no allow-list — it was never scoped to `currency` by name. That is a
  real AC violation ("no route behaviour changes yet"), not a hypothetical
  one: the reviewer verified it persists language end-to-end against a real
  Postgres. Fixed by adding `include={"currency"}` to that `model_dump` call,
  with a comment pointing at U3.2 as the unit that lifts the restriction, and
  a new regression test (`tests/test_accounts_api.py::test_update_language_is_not_yet_accepted`)
  asserting a `PATCH /accounts/me` with `{"language": "ru"}` leaves the
  stored language untouched. Existing
  fixtures that construct `AccountResponse`/`UserMeResponse` directly
  (`tests/test_models.py`, `tests/test_accounts_api.py`,
  `tests/test_users_api.py`) were updated to supply `language` since it has
  no default on the Pydantic model (only the DB column defaults). New
  coverage: `tests/test_account_repo.py::test_get_returns_account_with_default_language`
  (an account inserted with no explicit `language` reads back `Language.EN`,
  the AC's "every existing account reads back en", run against
  `scripts/integration_docker.sh`'s schema-applied throwaway DB — the
  generic alembic `upgrade head` → `downgrade base` round-trip for this
  migration is covered by CI, same pattern `test_schema_backfill.py`'s
  docstring already documents for U0.3's migration, since local `alembic
  upgrade` can't run on this dev machine, D18). A second reviewer pass on the
  fixed diff came back APPROVE with one NIT, fixed in the same unit:
  `test_enums_have_expected_members` gained `assert set(Language) ==
  {Language.EN, Language.RU, Language.UK}`, alongside the existing
  `Role`/`Resource`/`Action`/`Currency` membership checks.
- **U3.2 is done**: `GET /users/me` already returned `language` as of U3.1
  (`api/deps.py::get_current_user_with_currency` already passed
  `language=account.language`), so this unit's only remaining wiring was
  lifting the `include={"currency"}` allow-list U3.1's reviewer pass added
  to `services/account_service.py::AccountService.update`. Changed it to
  `include={"currency", "language"}` and generalized the enum-to-string
  branch from `isinstance(value, Currency)` to `isinstance(value, Currency |
  Language)`, so both NOT-NULL fields go through the same "set only if
  present and non-null" path independently of each other (D400/D401's
  currency precedent, extended). The admin-only gate and the 422-on-unknown-
  code behaviour needed no new code — `require_admin` on the route and
  `Language` being a Pydantic-validated enum on `AccountUpdate` already cover
  both, same as `currency`. Replaced
  `tests/test_accounts_api.py::test_update_language_is_not_yet_accepted`
  (U3.1's placeholder-behaviour regression test, now stale) with the AC's
  four requirements as separate tests: `test_update_language_as_admin`,
  `test_update_language_reflected_in_get_users_me`,
  `test_update_language_as_member_is_403`,
  `test_update_language_as_viewer_is_403`,
  `test_update_language_unknown_code_is_422`,
  `test_update_language_leaves_currency_untouched`,
  `test_update_currency_leaves_language_untouched`, and
  `test_update_currency_and_language_in_one_patch` — mirroring the existing
  currency tests in the same file one-for-one.
- **U3.3 is done.** New `webapp/src/lib/i18n.ts`: `Lang` (`"en"|"ru"|"uk"`),
  an `en` catalogue (three keys pulled verbatim from already-shipped screens'
  Copy tables — `readonly`, `error.retry`, `offline.banner` — chosen because
  they're real, provenance-backed strings rather than invented test content;
  no screen consumes `t()` yet, that starts at U3.5), `Catalogue = typeof en`,
  `setLanguage`/`t`. `ru`/`uk` both map to the `en` object in `catalogues`
  until U3.4 ships real content, so a `Language` the backend already accepts
  (U3.1/U3.2) never throws or blanks the UI here — it just falls back to EN.
  `t()` HTML-escapes an interpolated string value (a local `escapeHtml`,
  mirroring every screen's own copy of it) and passes a number through as-is;
  a `{var}` with no matching key is left untouched rather than dropped. The
  typed-key-union AC ("an unknown key fails the build") is enforced by
  `keyof Catalogue` and pinned by a `// @ts-expect-error` test in
  `tests/i18n.test.ts` — if the typing is ever weakened that test itself
  fails to compile-check, catching the regression.
  Boot wiring (D716, see Decision log): `main.ts::boot` calls
  `setLanguage("en")` before `await showHome()`; `screens/home.ts::loadHome`
  calls `setLanguage(me.language)` off the same `GET /users/me` response it
  already destructures for `currency`/`today`/`account_name` (no second
  fetch), as a side effect **not** added to `HomeData`/`HomeState`'s shape —
  avoids cascading into home.test.ts's many exact-equality fixtures for a
  field nothing renders yet. `webapp/src/api/types.ts::UserMeResponse` gained
  `language: Language` (a new `Language` type, mirroring `Currency`'s
  literal-union style, matching `models/enums.py::Language` — U3.1's backend
  contract had no webapp-side counterpart until now); `HomeApi.getMe()`'s
  return type gained `language` to match. `tests/home.test.ts`: `vi.mock`s
  `lib/i18n` and asserts `loadHome` reconciles with the account's language
  from that one call, and does **not** call `setLanguage` on the offline
  fallback (no fresh response to reconcile against); `tests/client.test.ts`'s
  one hand-built `UserMeResponse` fixture gained `language: "en"`. **Reviewer
  round 1** flagged one WARN, fixed in this unit: `boot()`'s `setLanguage("en")`
  call had no test — `main.test.ts`'s existing `boot()` test only exercises
  the Node-environment `typeof document === "undefined"` guard, never the
  real path. New `tests/main.boot.test.ts` (jsdom, its own file per D603's
  precedent) mocks `screens/home`'s `createHomeController` — not
  `globalThis.fetch` — because `main.ts`'s module-level `client`/
  `homeController` singletons are constructed at import time, before a plain
  `vi.stubGlobal` call could ever run; `vi.mock` factories are hoisted above
  the triggering `import`, and `vi.hoisted` shares the mock's pending-promise
  handle with the test body. **Reviewer round 2** found that first version of
  the test was vacuous: `main.ts`'s own module bottom auto-invokes `boot()`
  on import (`if (typeof document !== "undefined") { void boot(); }`), and
  under this file's jsdom environment `document` already exists at import
  time — before the test body attaches `#app` — so that auto-boot already
  ran once, calling the shared mocked `setLanguage` on its own before the
  test's own explicit `boot()` call, satisfying the assertion regardless of
  ordering. Fixed by calling `vi.clearAllMocks()` right after attaching
  `#app` and before capturing the test's own `bootPromise`, discarding the
  auto-boot's contaminating call, plus a `toHaveBeenCalledTimes(1)`
  assertion. Verified empirically (not just argued): reintroduced round 1's
  bug in a scratch copy of `main.ts` (moved `setLanguage("en")` to after
  `await showHome()`) and confirmed the fixed test fails
  (`expected "spy" to be called 1 times, but got 0 times`); reverted the
  scratch copy and reran `verify.sh` green before continuing. **Round 3**
  independently re-ran the same reintroduce-the-bug experiment from a clean
  agent (no memory of round 2's own run) and got the same failing result,
  confirmed a clean revert, and reran the full diff against round 1's other
  findings: APPROVE, no new findings.
- **U3.4 is done**: `webapp/src/lib/i18n.ts` gained real `ru`/`uk` catalogue
  objects for the three keys U3.3 shipped (`readonly`, `error.retry`,
  `offline.banner`), replacing the `ru: en, uk: en` placeholder fallback.
  `Catalogue` changed from `typeof en` (EN's exact literal string values) to
  `Record<keyof typeof en, string>` — still keyed off `en` as the registry
  (D702's "the catalogue key set is EN's"), but with plain `string` values so
  RU/UK can hold different content under the same keys; `keyof Catalogue` for
  `t()`'s parameter type is unaffected; this is the only contract-adjacent
  change and it doesn't touch `t`'s or `setLanguage`'s signatures. A TS excess
  or missing property on either `const ru`/`const uk` (both explicitly typed
  `: Catalogue`) already fails `pnpm typecheck` at that assignment; the AC's
  own runtime test lives in `tests/i18n.test.ts`, which now imports a newly
  exported `catalogues` map (previously module-private, exported for exactly
  this test — no other export or signature changed) and asserts, via
  `it.each`, that all three languages' sorted key arrays equal EN's and that
  no string in any catalogue contains `<` or `>`. The stale "falls back to EN
  for ru/uk" test (accurate before this unit, false after) was replaced with
  two tests asserting the real RU and UK strings render instead of the EN
  ones. Translations are plain declarative sentences with no markup and no
  interpolation-syntax changes — `{time}` stays the placeholder token in both.
- **U3.5 is done**: every user-visible literal in `home.ts` and
  `components/side-menu.ts` now goes through `t()`, called at each render
  site (never cached in a module constant) so a future language change
  re-renders without a reload. New catalogue keys, matching
  `01-home.md`/`side-menu.md`'s own Copy tables: `mb.add`/`add.aria`,
  `menu.aria`/`menu.title`, `empty.day`–`empty.custom`, `item.addExpense`–
  `item.settings`, `footer.synced`, `alert.over`, `alert.warn`. Three more
  literals had no Copy-table row yet — `chart.other` ("Other", the donut/bar's
  folded-tail label), `category.unknown` ("Unknown", the ranked-row/alert
  fallback for a missing category — defensive only, not reachable in normal
  use) and `error.fallback` ("Something went wrong.", `loadHome`'s fallback
  for a non-`Error` rejection, distinct from the still-unused `error.load`) —
  added to `01-home.md`'s Copy table in this same change, each noted as an
  existing string now catalogued. `budgetAlertMessage` keeps its "raw,
  unescaped" contract (`main.ts`'s toast reuses it verbatim, D609): it fetches
  `alert.over`/`alert.warn`'s template via `t(key)` with no vars and fills
  `{placeholders}` with a new local `fillTemplate` helper that does **not**
  escape — `t()`'s own vars mechanism HTML-escapes string vars, which would
  have leaked entities into the Telegram toast and, on the DOM side, been
  escaped a second time by `renderBudgetAlertLine`'s existing
  `escapeHtml(budgetAlertMessage(...))` wrap. Caught by writing the
  R&D-category test first, not by review. One incidental fix inside
  `buildHomeData`, required by the extraction itself: its `.filter`/`.map`
  callbacks used `t` as the `CategoryTotal` parameter name, shadowing the
  newly-imported `t()` — renamed to `ct`.
  Tests: `home.test.ts`'s and `main.boot.test.ts`'s `vi.mock("../src/lib/i18n", ...)`
  both changed from replacing the whole module (`{ setLanguage: vi.fn() }`,
  which left no `t` export and broke every render call) to
  `importOriginal` plus overriding only `setLanguage` — so this suite's
  existing exact-EN-string assertions run through the real catalogue and
  double as the AC's byte-identical-output regression test, with no new
  fixture duplication. New coverage beyond that: `i18n.test.ts` asserts
  `mb.add`/`add.aria` never drift apart in any language (D318); `home.test.ts`
  covers the `category.unknown` fallback, the `error.fallback` non-Error
  branch, and the R&D raw-vs-escaped-once budget-alert case; `side-menu.test.ts`
  gained a `setLanguage("ru")` pass asserting translated row labels, the RU
  dialog `aria-label`, and the `footer.synced` template. **Reviewer round 1:
  APPROVE**, two NITs left as-is (both noted, not fixed): `home.test.ts`'s
  `setLanguage` mock has no `afterEach` reset (harmless — it's a fully mocked
  no-op spy there, unlike `side-menu.test.ts`'s real `setLanguage` calls,
  which do reset); and `side-menu.md`'s `item.admin` Copy-table row (V7,
  `system_admin`-gated) is correctly not yet wired into `ROWS` or the
  catalogue — flagged only so a later unit doesn't assume it already is.
- **U3.6 is done**: every user-visible literal in `add-expense.ts` now goes
  through `t()`. 24 new `addExpense.*` keys cover the button guards
  (`chooseCategory`/`enterAmount`/`saveChanges`, shared verbatim between
  `submitButtonState` and `editButtonState`), the six `submitErrorMessage`
  branches, the two discard-confirm strings (`discardExpense` for create,
  `discardChanges` for 02b), the account/tags/comment/categories field
  labels, the two date-row `aria-label`s, the `"+ Add tag"` chip and the
  three date-pill words (`today`/`yesterday`/`two days ago`) `datePillOptions`
  itself now returns pre-translated — the `Mon`/`Sun`-style weekday fallback
  for pill 3 stays on `Intl.DateTimeFormat("en-US", ...)`, untouched, per the
  plan's own out-of-scope call on locale-aware date formatting (U0.4's
  resolved open question). Three strings turned out to already have a
  matching global key from U3.5 and were reused instead of duplicated:
  `error.retry` ("Try again", the retry button), `error.fallback`
  ("Something went wrong.", `loadAddExpenseData`'s non-`Error` rejection
  fallback — same fallback shape as `home.ts::loadHome`'s), and
  `offline.banner` ("Offline — showing data from {time}", byte-identical
  wording to Home's own offline banner). `addExpense.submitLabel`
  ("Add {amount} {currency} to {category}") is the one templated key: like
  U3.5's `alert.over`/`alert.warn`, it's a native `MainButton` label, not
  innerHTML, so it's fetched via `t(key)` with no vars and filled by a new
  private `fillTemplate` (a second copy of `home.ts`'s own function of that
  name — pure modules don't share helpers in this file, per its existing
  date-row convention) rather than `t()`'s own vars mechanism, which would
  have HTML-escaped the category name into the button chrome. One rename to
  avoid a second `t`-shadowing case (`home.ts` hit the same thing in U3.5):
  `renderTagChips`'s `.map((t) => ...)` callback param renamed to `tag`.
  `webapp/tests/add-expense.test.ts` needed **no changes** — every existing
  exact-EN-string assertion runs through the real `en` catalogue by default
  (no `vi.mock` on `../src/lib/i18n` in this file at all), so the full
  existing suite doubles as the AC's byte-identical-output regression test.
  `i18n.test.ts`'s generic per-language loops pick up all 24 new keys with no
  changes needed there either.
- **U3.7 is done**: every user-visible literal in `expenses.ts` and
  `expense-detail.ts` now goes through `t()`. Four strings reused U3.5's
  global keys byte-identically (`category.unknown`, `error.retry`,
  `error.fallback`, `offline.banner` — the last via `t()`'s own vars
  mechanism, `renderOfflineBanner`'s existing convention, mirroring
  `home.ts`/`add-expense.ts`). New keys: `expenses.unknownCategory` (the
  "this category" fallback label for a filter whose category id no longer
  resolves), `expenses.forbidden`, `expenses.loadMore`, `expenses.endOfList`,
  and the two templated groups `expenses.filter.both`/`expenses.empty.*`
  (both/categoryOnly/periodOnly/unfiltered) — composed with a private,
  non-escaping `fillTemplate` (a fourth per-file copy of `home.ts`'s helper,
  same "pure modules don't share helpers" convention U3.6 already
  reaffirmed) and escaped exactly once by the existing outer `escapeHtml`
  wrap in `renderReady`/`renderEmpty`, since `t()`'s own vars mechanism would
  have double-escaped the category/period labels otherwise. `expense-detail.ts`
  gained `detail.action.edit`/`detail.action.delete`, `detail.forbidden`,
  `detail.notFound`, `detail.err.forbidden`/`detail.err.delete`
  (`deleteErrorMessage`'s two branches) and `detail.confirm.message`, passed
  to `confirmAction()` as a plain `t(key)` call with no escaping — Telegram's
  native popup, not innerHTML, same rule as U3.6's MainButton labels.
  Both files had one pre-existing `t`-shadowing `.map((t) => t.name)` tag
  callback (harmless as shipped — neither body called `t()` — but caught by
  the review's own grep-for-`(t) =>` check); renamed to `tag`, matching
  U3.5/U3.6's precedent.
  Both test files needed **no changes** to their existing exact-EN-string
  assertions (no `vi.mock` on `../src/lib/i18n` in either, same as
  `add-expense.test.ts`) — they doubled as the AC's byte-identical-output
  regression test unchanged. Added: one `setLanguage("ru")` pass per test
  file (reset in a scoped `afterEach`) asserting real RU strings render for
  the forbidden/empty/end-of-list and action/forbidden/not-found copy,
  mirroring `side-menu.test.ts`'s convention; `i18n.test.ts`'s generic
  per-language loops pick up all 19 new keys with no changes needed there.
  **Doc/reality mismatch found, not fixed (out of scope — this unit's AC
  requires byte-identical EN output):** `03b-expense-detail.md`'s Copy table
  lists `author`: "Added by {name}" as an existing `[repo]` string, but the
  shipped `renderCard` only ever prints the bare name with no "Added by"
  prefix — nothing to catalogue here since there is no static literal at that
  call site, only user data. Flagged for whoever next touches that spec or
  screen; not this unit's job to reconcile.
- **U3.8 is done**: every user-visible literal in `budgets.ts` and
  `budget-form.ts` now goes through `t()`. Two strings reused global keys
  byte-identically (`error.retry`, `offline.banner` via `t()`'s own vars
  mechanism). New keys: `budgets.mainButtonLabel` (contextual MainButton
  label, composed with a private, non-escaping `fillTemplate` — a fifth
  per-file copy of the same helper, "pure modules don't share helpers"
  convention U3.5–U3.7 already established — since it feeds native chrome,
  not innerHTML), `budgets.status.{noLimit,over,warn,ok}` (the bar's status
  line, inserted at its one render call site with **no** extra `escapeHtml`
  wrap — `status.over`'s `{amount}`/`{currency}` vars are already escaped
  once by `t()`'s own vars mechanism, and the other three branches are
  trusted catalogue literals with no vars at all; the reviewer's first pass
  caught an initial version that wrapped the whole thing in `escapeHtml`
  anyway, double-escaping `status.over`'s vars — harmless today since
  `formatAmount`/`currency` never contain HTML-special characters, but
  fixed to keep the "escaped exactly once" rule actually true rather than
  coincidentally harmless), `budgets.empty.{noBudgets,noCategories}`, `budgets.invite.cta`,
  `budgets.forbidden`, and `budgets.unknownCategory` (the stale/deleted
  category fallback label, previously a hardcoded "Unknown category" the
  AC's literal-scan still catches even though the design doc calls it
  unreachable under the DB's `ON DELETE RESTRICT`). `budget-form.ts` gained
  `budgetForm.{amountError,thresholdError}` (inline field errors),
  `budgetForm.err.{forbidden,gone,duplicate,fallback,planGone}`
  (`saveErrorMessage`'s four branches plus `deleteBudget`'s create-mode
  guard message — a fifth, previously-missed literal found only by a
  post-edit re-scan of the file, not by the original literal inventory),
  `budgetForm.spent` (the edit-mode spend line, `t()` vars only — no extra
  `escapeHtml` wrap, matching `expenses.ts`'s `offline.banner` precedent for
  a string whose vars are already escaped once by `t()` itself),
  `budgetForm.{delete,amountLabel,thresholdLabel,save,cancel}`, and
  `budgetForm.{discardChanges,confirmDelete}` (the two `confirmDiscard`/
  `confirmAction` popup messages — `t()` with no vars, no escaping, same
  native-chrome rule as every other screen's confirm popups). Deliberately
  **not** reused across the two files despite near-duplicate EN wording with
  `addExpense.*`/`detail.*` (e.g. "Enter an amount greater than 0.",
  "You don't have permission to do that.", "Something went wrong. Please
  try again."): the established rule from U3.6's gotcha only reuses a
  **global, unprefixed** key, never another screen's own prefixed one, so
  `budgetForm.*` catalogues its own copies even where the English text
  happens to match verbatim — this keeps each screen's translations
  independently editable later without cross-screen coupling.
  Neither test file needed changes to its existing exact-EN-string
  assertions (no `vi.mock` on `../src/lib/i18n` in either) — they doubled as
  the AC's byte-identical-output regression test unchanged. Added: a scoped
  `setLanguage("ru")`/`afterEach(() => setLanguage("en"))` block per test
  file asserting real RU strings render for the forbidden/empty/status copy
  (`budgets.test.ts`, plus the MainButton label via the existing
  `fakeWebApp`/`installWebApp` helpers) and the labels/actions/spent-line/
  field-errors/mapped-save-error copy (`budget-form.test.ts`); `i18n.test.ts`'s
  generic per-language loops pick up all 24 new keys with no changes needed
  there. Grepped both files for the `(t) =>`/`(t:` shadowing hazard flagged
  by U3.5/U3.6's gotchas — none found, nothing to rename.
- **U3.9 is done**: every user-visible literal in `categories.ts` and `tags.ts`
  now goes through `t()`. Four strings reused global keys byte-identically
  (`readonly`, `error.retry`, `error.fallback`, `offline.banner` via `t()`'s
  own vars mechanism). New keys, split `categories.*`/`categoryForm.*` and
  `tags.*`/`tagForm.*` exactly as `budgets.*`/`budgetForm.*` split in U3.8:
  `categories.addCategory` (the Add-category cell's aria-label and visible
  text, one key for both since they were byte-identical strings already),
  `categories.empty`, `categories.archivedHeader` (`{count}`, inserted via
  `t()`'s own vars with no extra wrap — the call site never `escapeHtml`d a
  bare number either), `categories.archivedExplain`,
  `categories.{hideTrigger,deleteTrigger}`,
  `categories.delete.{expenseCountOne,expenseCountMany,confirmHide,
  confirmDelete,lastActiveWarning,failureHide,failureDelete}`, and
  `categoryForm.{nameLabel,namePlaceholder,colourLabel,nameError,
  duplicateWarning,saveError.fallback,save,discardChanges}`; the tags side
  mirrors it 1:1 (`tags.addTag`, `tags.empty`, `tags.archivedHeader`,
  `tags.archivedExplain`, `tags.{hideTrigger,deleteTrigger}`,
  `tags.delete.{expenseCountOne,expenseCountMany,confirmHide,confirmDelete,
  failureHide,failureDelete}` — no `lastActiveWarning` counterpart, tags never
  had one — and `tagForm.{nameLabel,namePlaceholder,nameError,
  saveError.fallback,save,discardChanges}`). Both files gained their own
  private, non-escaping `fillTemplate` (a sixth/seventh per-file copy, same
  "pure modules don't share helpers" convention U3.5–U3.8 established),
  used for every templated string with **two** distinct reasons to avoid
  `t()`'s auto-escaping vars, not just the usual native-chrome one:
  `categoryDeleteConfirmMessage`/`tagDeleteConfirmMessage` (and the
  `expenseCountPhrase`/`tagExpenseCountPhrase` helpers they compose) feed
  `confirmAction` — native Telegram chrome, the established reason — but
  `categoryDeleteFailureMessage`/`tagDeleteFailureMessage` and
  `categoryDuplicateWarning` feed a value that its **own caller**
  (`renderDeleteFailureBanner`/`renderNameField`) already wraps in
  `escapeHtml()` once; using `t()`'s auto-escaping vars there would have
  escaped the interpolated name **twice**. This second reason wasn't in any
  prior unit's gotcha list — flagged here since U3.10 (`settings.ts` +
  `statistics.ts` + several components) is likely to hit the same shape
  wherever a screen builds a message string in one function and escapes it in
  another. `categoryFormErrorMessage`/`tagFormErrorMessage`'s forbidden branch
  and both files' `renderForbidden()` reuse the global `readonly` key rather
  than adding a screen-prefixed duplicate (checked per U3.6's gotcha — the
  English text was already byte-identical to the existing global). Neither
  test file needed changes to its existing exact-EN-string assertions (no
  `vi.mock` on `../src/lib/i18n` in either) — they doubled as the AC's
  byte-identical-output regression test unchanged. Added: a scoped
  `setLanguage("ru")`/`afterEach(() => setLanguage("en"))` block per test file
  asserting real RU strings render for the forbidden/empty/archived copy, the
  delete-trigger labels/confirm/failure messages, the form's
  labels/placeholder/name-error/duplicate-warning copy, and the MainButton
  "Save" label; `i18n.test.ts`'s generic per-language loops pick up all 39 new
  keys with no changes needed there. Grepped both files for the
  `(t) =>`/`(t:` shadowing hazard — none found, nothing to rename.
- **U3.10 is done**: every user-visible literal in `settings.ts`, `statistics.ts`,
  the five remaining components (`period-selector.ts`, `date-range-picker.ts`,
  `category-picker.ts`, `color-picker.ts`, `toast.ts`) and `main.ts` now goes
  through `t()`. `toast.ts` needed no change — its `message` is always
  pre-composed by the caller (`home.ts`'s `budgetAlertMessage`, already
  catalogued). `main.ts` needed only two: both `deleteCategoryAndUpdateCache`/
  `deleteTagAndUpdateCache`'s hardcoded `"You have read-only access to this
  account."` now reuse the global `readonly` key U3.5 already catalogued.
  `settings.ts`'s 15 hardcoded `CURRENCY_NAMES` became `currencyName(code)`,
  one catalogue key per ISO code (`settings.currency.USD` etc.) — the
  screen doc's own "English names, no localisation" line is now stale
  (pre-V7; not touched by U0.4's later delta) and superseded by the plan's
  Goal item 1 and this unit's AC; flagged here rather than silently
  reproduced or hand-edited into the spec, which is this unit's owned code,
  not its spec. `date-range-picker.ts` and `color-picker.ts` each carry a
  file-header note stating a deliberate boundary: calendar month/weekday
  names (`date-range-picker.ts`'s `MONTH_NAMES`/`WEEKDAY_HEADER`) and
  category-slot colour names (`color-picker.ts`'s `categorySlotName`, owned
  by `lib/category-colors.ts`, outside this unit's file list) stay
  browser-locale/untranslated — the same "only chrome is translated, date/
  number formatting stays out of V7" line U0.4's resolved open question and
  `lib/period.ts::describe` already draw; only the chrome *around* them
  (dialog titles, quick-chip labels, footer buttons, aria-label templates)
  is catalogued. `period-selector.ts`'s `aria.prev`/`aria.next` templates
  compose with a translated unit noun (`periodSelector.unit.*`) via a
  private `fillTemplate` rather than `t()`'s auto-escaping vars, since the
  composed string is written into an `aria-label` attribute that the call
  site's own `escapeHtml` already wraps once — same double-escape hazard
  U3.9 first flagged, now confirmed recurring in this unit's non-native-chrome
  cell too (not just MainButton/`showConfirm`), per that unit's own gotcha
  note. `statistics.ts` renamed two more `(t) =>`/`(t:` map-callback
  shadowing sites (`catTotalById`, `input.tagTotals.map`) to `ct`/`tt`,
  alongside the pattern's now-familiar `tagNameById` → `tag` rename.
  Every test file needed no changes to its existing exact-EN-string
  assertions (no `vi.mock` on `../src/lib/i18n` in any of them) — they
  doubled as the AC's byte-identical-output regression test unchanged,
  except `settings.test.ts` (dropped the `CURRENCY_NAMES`/`SAVE_ERROR`
  exports it imported directly, switched to `currencyName()`/`t()`).
  Added: a scoped `setLanguage("ru")`/`afterEach(() => setLanguage("en"))`
  block per screen/component test file (settings, statistics,
  period-selector, date-range-picker, category-picker, color-picker) —
  `main.ts`'s own routing functions stay untested under Node, the same
  accepted gap the file's header comment and U2.2's STATE note both already
  document. `i18n.test.ts`'s generic per-language loops pick up all ~70 new
  keys with no changes needed there. M3.3 (the webapp string-extraction
  pass) is complete; `bot/` extraction starts at U3.12.
- **U3.11 is done**: `screens/language.ts` (screen 09) is new — same
  data/controller/presentation/mount split as `settings.ts`, but a row tap
  fires the `PATCH` directly (no MainButton, no confirm popup, no discard
  flow, per `09-language.md`'s Delta section and the plan's own gotcha
  below). `createLanguageController.choose(code)` is a no-op (`blocked`, no
  request) when `code` is already the confirmed selection, **except** right
  after a failed attempt, when any tap — including a re-tap of the same row
  — retries; a private `failed` flag (cleared on success, set on failure)
  carries that distinction, since the row shown checked after a failure was
  never actually confirmed server-side. `settings.ts` gained region 4/5 (a
  "Language" heading + one navigation row, always tappable regardless of
  role — the read-only gate lives on `09-language.md` itself, not here);
  `SettingsData`/`SettingsApi.getMe()` now also carry `language` (one extra
  field off the same `GET /users/me`, no second fetch) so the row can show
  the current endonym+code without loading anything new. `api/types.ts`'s
  `AccountResponse`/`AccountUpdate` gained the `language` field the backend
  has carried since U3.1/U3.2 — this unit is their first webapp reader.
  New CSS: `.settings-language-section` (the 24px between-sections gap) and
  `.lang-row-text`/`.lang-row-endonym`/`.lang-row-code` (the endonym-primary,
  ISO-code-secondary two-line row both screens 08 and 09 share) — no new
  design-system values, only new compositions of already-listed ones.
  Reviewer round 1 caught `.settings-language-section`'s `margin-top: 24px`
  being additive with `.settings-view`'s own 12px flex `gap` — fixed to
  `margin-top: 12px`, but round 2 caught that the fix's own arithmetic still
  missed a third additive term: `.settings-eyebrow`'s own `margin: 4px 4px 0`
  compounds inside this newly-*nested* flex container (every other
  `.settings-eyebrow` use is a first child of `.settings-view` directly,
  where flex `gap` already supersedes it). Fixed with a scoped
  `.settings-language-section .settings-eyebrow { margin-top: 0; }`
  override, so the remaining two terms (12 + 12) sum to exactly 24px.
  Verified empirically, not just by arithmetic: rendered `vite build`
  output, loaded the real compiled CSS + `renderSettings()`/`renderLanguage()`
  output in Chrome, and measured `getBoundingClientRect()` gaps directly —
  24px confirmed between the Currency card and the Language heading, and all
  three `docs/ui/screens/09-language.md` states (admin/non-admin/save-error)
  screenshotted and checked against the spec's Layout/Copy/States tables.
  `language.name.en`/`.ru`/`.uk` are the only catalogue keys that are
  **identical across all three catalogues on purpose** (an endonym doesn't
  translate with the viewer's language) — `i18n.test.ts`'s key-identity
  check still passes since it only asserts key *sets* match, not that values
  differ. 62 new/changed tests (`language.test.ts` new, `settings.test.ts`
  extended); `verify.sh` green. Not done: a live Chrome click-through — this
  repo has no mock `Telegram.WebApp` harness or Playwright rig for the Mini
  App (checked; none exists), and a real one needs Telegram-signed
  `initData` the backend's HMAC check won't fake. Covered instead by the 62
  tests above plus `tsc`/`eslint`/`vite build`. Worth a `/run-skill-generator`
  pass if manual verification of Mini App units becomes a recurring need.
- **U3.12 is done**: `bot/i18n.py` is new — mirrors `webapp/src/lib/i18n.ts`'s
  shape (a `Catalogue` dict, a `t()` lookup-and-fill function) but adapted to
  the bot's per-update, multi-account-in-one-process nature: there is no
  module-level `currentLang` state; every `t(language, key, **vars)` call
  takes the caller's resolved `Language` explicitly, sourced from injected
  handler data, never a global. Seeded with two placeholder-style global
  keys (`readonly`, `error.tryAgain`) — same "infra lands before extraction"
  shape U3.3 used on the webapp side (its three seed keys weren't consumed
  by that unit's own diff either); real bot strings move in at U3.13/U3.14.
  RU/UK both alias the same `_en` dict object (`webapp`'s U3.3 precedent)
  until U3.15's catalogues ship. No HTML-escaping in `t()` (unlike the
  webapp's) — checked bot-wide first: no handler passes `parse_mode`, so
  every outgoing message is plain text, and escaping plain text would corrupt
  it. Language resolution lives in `bot/middlewares.py::AllowlistMiddleware`:
  `BackendClient.get_me()` now parses the `/users/me` probe response into
  `UserMeResponse` instead of the narrower `UserResponse` (D707 — the probe
  already fetches `language`, this just stops discarding it), and the
  verdict cache's tuple grew a `Language` field (`(allowed, language,
  expires_at)`), read on a cache hit and stored on a cache miss identically
  to `allowed`. Handlers get it via `data["language"]`, injected the same
  update `data["client"]` already is; none read it yet since no handler has
  been extracted. A denied probe (`me is None`, e.g. a clean 401) resolves
  to `Language.EN` via `_resolve_language(me)` — cheap and correct since a
  denied update is dropped immediately after (the language is never read),
  but it still belongs in the cache entry so a repeat call from a denied
  tg_id costs no second probe either. This does not relax D302: a malformed
  response body still raises inside `client.get_me()`'s own parsing and is
  caught by the pre-existing broad `except Exception` a transport error or
  5xx already was, so it fails exactly as closed as before — reviewer round
  1 flagged the module docstring for briefly overclaiming a language lookup
  "never fails closed," fixed by naming the D302 boundary explicitly instead
  of implying language resolution bypasses it. Touched but not owned by this
  unit: `tests/test_bot_bot.py`'s
  and `tests/test_bot_middlewares.py`'s `_user_json`/probe-response fixtures
  needed `currency`/`language`/`account_name`/`today` added — both were
  building the narrower `UserResponse` shape by hand and `UserMeResponse`
  validation now rejects a payload missing them; caught by `verify.sh`'s
  pytest step, not by inspection. 8 new tests across `test_bot_i18n.py`
  (new) and `test_bot_middlewares.py`; `verify.sh` green (700 backend +
  874 webapp tests).
- **U3.13 is done**: every literal in `bot/keyboards.py`,
  `bot/handlers/common.py` and `bot/handlers/expenses.py` now goes through
  `bot/i18n.py::t()`. ~40 new EN keys (`common.*`, `kb.*`, `expense.*`); RU/UK
  still alias EN (U3.15 ships real catalogues). Every handler/helper in the
  three files takes `language: Language = Language.EN` — the default is a
  call-site convenience only (aiogram injects the caller's real resolved
  language by parameter name regardless of it, same mechanism `client:
  ExpenseBackendClient` already relied on with no default; internal calls
  within these three files always thread the real `language` through
  explicitly, never fall through to the default). D718 (Decision log):
  `bot/keyboards.py` is fully U3.13's to translate — including
  `tags_keyboard`/`budgets_keyboard`/`statistics_keyboard`, whose literals
  live in this file even though their *callers* (`tags.py`/`categories.py`/
  `budgets.py`/`statistics.py`) are U3.14's — but those callers keep calling
  them with no `language` argument (default EN) rather than U3.13 reaching
  into four files it doesn't own; U3.14 threads the real language into those
  same calls as a one-line addition alongside its own literal-string work.
  `WELCOME_TEXT`/`HELP_TEXT` module constants are gone from `common.py`
  (moved into `i18n.py` as `common.welcome`/`common.help`); tests that
  referenced them now import `t`+`Language` instead. 15 new tests
  (`test_bot_i18n.py`, `test_bot_handlers_common.py`, `test_bot_keyboards.py`,
  `test_bot_handlers_expenses.py`) assert the language-threading *mechanism*
  (an explicit `language=Language.RU` reaches `t()` and resolves correctly)
  rather than translated content, since RU/UK are still EN aliases;
  `verify.sh` green (711 backend + 874 webapp tests).
- **U3.14 is done**: every literal in `bot/handlers/categories.py`,
  `tags.py`, `budgets.py` and `statistics.py` now goes through
  `bot/i18n.py::t()`; `bot/charts.py` turned out to carry no user-visible
  literal at all (every rendered line is a formatted number/bar built from
  caller-supplied data), so it needed no change — confirmed by re-reading the
  file, not assumed. D718's gap is closed: `tags_keyboard`/`budgets_keyboard`/
  `statistics_keyboard` calls from these four files now pass the handler's
  real resolved `language` instead of relying on `keyboards.py`'s
  `Language.EN` default (`categories_keyboard` takes no `language` parameter
  at all — it renders only category names, never a static caption — so its
  call sites were untouched). ~75 new EN keys: `categories.*`, `tags.*`
  (mechanical mirror, D43's precedent), `budgets.*`, `statistics.*`, plus
  three new shared keys reused within this unit's own four files —
  `common.backendUnreachable`, `common.cancelled` (identical wording already
  exists under `expense.*` from U3.13, but repointing that file at a new
  global key would be a drive-by outside this unit's file list, so it kept
  its own copy) and `error.fallback` (the generic catch-all, mirroring the
  webapp's own `error.fallback` naming). RU/UK still alias EN (U3.15 ships
  real catalogues). Every handler/helper in the four files takes
  `language: Language = Language.EN`, threaded explicitly between calls, same
  convention U3.13 established — aiogram injects the caller's real resolved
  language by parameter name regardless of the default. Module-level string
  constants that existed purely to hold literal text
  (`categories.py`/`tags.py`'s `_BACKEND_UNREACHABLE`/`_DELETED_MESSAGE`/
  `_ARCHIVED_MESSAGE`, `statistics.py`'s `_BACKEND_UNREACHABLE`/
  `_EMPTY_PERIOD`/`_NOTHING_TO_CHART`) are gone, replaced by inline `t()`
  calls, since the rendered string now depends on the caller's language and
  a module constant can no longer hold it — same pattern U3.5 used removing
  `WELCOME_TEXT`/`HELP_TEXT` from `common.py`. Every EN catalogue value is
  byte-identical to the literal it replaced, so all four handler test files'
  pre-existing exact-EN-string assertions passed with **no changes needed**
  (728 backend tests, up from 711 only because of the new tests below) —
  the AC's "bot's EN output is unchanged" regression test. New language-
  threading tests (17 total, mirroring U3.13's
  `test_bot_handlers_expenses.py` mechanism-not-content shape since RU/UK
  still alias EN): 5 each in `test_bot_handlers_categories.py` and
  `test_bot_handlers_tags.py`, 4 in `test_bot_handlers_budgets.py`, 3 in
  `test_bot_handlers_statistics.py`; `tests/README.md` updated with a row per
  new test in the same change (tests/CLAUDE.md's own rule). One ruff-format
  wrap-up: several function signatures needed multi-line wrapping after
  gaining the `language` parameter pushed them past the 100-column limit —
  `ruff format` did the reflow, not hand-formatting.
- **U3.15 is done**: `bot/i18n.py`'s `_ru`/`_uk` catalogues ship real content
  for all 123 EN keys (`_catalogues` now maps each `Language` to its own
  dict, no more `Language.RU: _en` aliasing). Translation followed the
  webapp catalogues' existing RU/UK vocabulary wherever a concept overlapped
  (`readonly`, category/tag hide-vs-delete phrasing, budget/statistics
  wording), so a family member reading both surfaces sees consistent terms.
  `budgets.theCategoryFallback` (RU "категория"/UK "категорія", nominative)
  is only substituted into `budgets.set`/`budgets.updated`'s subject
  position, never into a `для {category}` (genitive-governing) slot — the
  two call sites that need a category name in that position always have the
  real name by then. Reviewer round 1 caught a real one, though:
  `budgets.enterLimit`/`enterNewLimit` originally read "лимит для
  {category}" — `для` governs the genitive case, but `{category}` fills
  with the raw, undeclinable user-entered name, which read as broken
  grammar for most names ("для Продукты" instead of "для Продуктов"). Fixed
  by quoting the proper noun after a declined common noun instead — "для
  категории «{category}»"/"для категорії «{category}»" — the idiomatic
  Russian/Ukrainian way to hold a name that can't be declined. New tests in
  `tests/test_bot_i18n.py`:
  `test_every_language_has_exactly_ens_key_set` (fails on a missing/extra
  key in any language — the AC's key-completeness test, mirroring
  `webapp/tests/i18n.test.ts`'s existing per-language loop) and
  `test_no_catalogue_contains_markup`; `test_falls_back_to_en_for_ru_and_uk`
  is gone (the premise no longer holds) and two content tests
  (`test_renders_real_ru/uk_content_not_an_en_fallback`) took its place. The
  "cross-surface key test" of the unit's own title is two tests, not one —
  bot and webapp use disjoint key namespaces (different screens/handlers),
  so there is nothing to compare *across* them; each surface's own
  completeness loop is what the AC actually asks for. Fallout outside this
  unit's own files, fixed because U3.15 broke it: five tests in
  `tests/test_bot_keyboards.py` hardcoded literal EN strings while passing
  `language=Language.RU` (banking on the old alias) — switched to compare
  against `t(Language.RU, key)` like every other language-threading test in
  the suite already does, same fix pattern U3.13's own tests used. Several
  now-stale "RU aliases EN until U3.15" notes in `tests/README.md` (this
  file, `test_bot_handlers_common.py`, `_categories.py`, `_tags.py`,
  `_budgets.py`, `_statistics.py` sections) were reworded in the same
  change; the tests they describe needed no code change since they already
  looked up expected values via `t()` rather than hardcoding content. 731
  backend tests (up from 728), 874 webapp tests (unchanged — webapp side
  was untouched). No new D-numbered decision: D702 already settled "every
  catalogue stays key-complete, real content, no aliasing."
- **Next:** `/clear`, then **U4.1** (Contracts + migration:
  `Role.SYSTEM_ADMIN`, `users.is_blocked`, `accounts.is_blocked`). M3 (bot +
  webapp i18n) is fully done. M4 starts the admin panel — U4.1 touches
  `migrations/versions/`, which is on CLAUDE.md's do-not-edit-without-asking
  list, and the unit's own text says **"Ask the human before writing the
  migration file"** — the human must be in the loop for this one, not run
  via `/unit-auto`.
- **Gotchas the next session must know:**
  - **Re-scan the whole file for literals after the first pass, not just the
    obvious render/copy sites.** U3.8's `budgetForm.err.planGone` was a
    guard-clause message (`deleteBudget()`'s create-mode no-op branch) that
    the initial spec-driven inventory missed entirely — it surfaced only on
    a second full read of the file post-edit. The Copy table in a screen's
    `docs/ui/screens/*.md` is a good starting inventory, not a complete one;
    it won't list a defensive branch nobody designed on purpose.
  - **`confirmAction`/`confirmDiscard` (`lib/telegram.ts`) take only a
    `message` string** — Telegram's `showConfirm` has no title or
    custom-button-text parameter, so a Copy table's `confirm.title`/
    `confirm.yes`/`confirm.cancel`-style rows (03b's `09-...`-style docs) are
    native Telegram chrome, not literals this codebase renders — only the
    `message` row is ever an actual `t()` call site.
  - **Check for an existing global key before adding a screen-prefixed one.**
    U3.6 found three strings (`error.retry`, `error.fallback`,
    `offline.banner`) that U3.5 had already catalogued under a global,
    unprefixed key with byte-identical wording — reused rather than
    duplicated under `expenses.*`. Worth a quick grep of `i18n.ts`'s `en`
    object before naming a new key.
  - **A `t`-shadowing local named `t` is a recurring hazard in this
    codebase's map callbacks** (category/tag/transaction-style loops).
    U3.5 hit it in `buildHomeData` (renamed to `ct`), U3.6 hit it in
    `renderTagChips` (renamed to `tag`). Grep for `(t) =>`/`(t:` before
    assuming a file is clean.
  - **A string feeding a native `MainButton`/`showConfirm`/`showAlert` call is
    not innerHTML.** `t()`'s vars mechanism HTML-escapes string
    substitutions, which is correct for template-literal markup but wrong for
    Telegram chrome — use `t(key)` with no vars plus a private `fillTemplate`
    (U3.5's `budgetAlertMessage`, U3.6's `submitButtonState`) whenever a
    templated string's rendered destination is native UI, not the DOM.
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
  - **The language is not available at first paint** — implemented in U3.3,
    still binding on every unit that touches boot ordering. `boot()` seeds
    `"en"` before `showHome()` renders; `loadHome` reconciles once
    `GET /users/me` resolves (D709/D716). Do not add a second `/users/me`
    fetch to read `language` sooner — reuse the one `loadHome` already makes.
  - **Do not touch `assignCategoryColors`** (V6's gotcha, still true) and **do
    not batch `GET /budgets`' progress** (V5's gotcha, still true).
  - The webapp's vitest DOM tests need the per-file
    `// @vitest-environment jsdom` docblock — the config sets no global default
    (V6's U0.5).
  - **A private `fillTemplate` isn't only for native chrome.** U3.9 found a
    second reason to skip `t()`'s auto-escaping vars: a helper function (e.g.
    `categoryDeleteFailureMessage`) whose return value is `escapeHtml`'d once
    by its *caller*'s own render function. Using `t()`'s vars there would
    escape the interpolated value twice. Before wiring a templated string
    through `t(key, vars)`, check whether anything downstream already
    escapes the result — if so, use `fillTemplate` and let that one existing
    `escapeHtml()` call do the only escaping.
  - **A screen doc can be stale about localisation itself, not just about a
    string's content.** `08-settings.md`'s Copy section says "English names,
    no localisation — the rest of the app is English-only" for the 15
    currency names — true when written (V4), false since M3 started. U3.10
    translated them anyway (the plan's Goal item 1 and the unit's own AC both
    say every visible string, no carve-out for this one) and left the doc
    line as found — fixing a spec beyond the unit's own file list is a
    drive-by, not this unit's job. Whoever next touches `08-settings.md`
    should correct that line in the same change.
  - **Date/number formatting stays out of V7 wherever it appears, not just in
    `lib/period.ts::describe`.** U3.10 hit the same boundary twice more:
    `date-range-picker.ts`'s `MONTH_NAMES`/`MONTH_ABBR`/`WEEKDAY_HEADER` and
    `color-picker.ts`'s `categorySlotName` (owned by `lib/category-colors.ts`,
    a file no U3.x unit's file list includes) both stay untranslated on
    purpose — translate the chrome *around* a formatted/named value, never
    the formatter or name table itself, unless a future unit's file list
    explicitly names that module.

- **U4.1 is done**: `models/enums.py` gained `Role.SYSTEM_ADMIN`, appended
  above the existing three members. `models/account.py::AccountResponse` and
  `models/user.py::UserResponse` each gained `is_blocked: bool` (no Python
  default, matching `language`'s precedent from U3.1 — every existing
  fixture that constructs either model directly needed updating, not just
  the three files U3.1 touched: `is_blocked=False` was added at every one of
  the ~34 `UserResponse`/`UserMeResponse` and 4 `AccountResponse` call sites
  across `tests/*.py`, found by grepping for the `role=`/`owner_id=None`
  lines those constructors always include). New `models/admin.py`:
  `AdminAccountRow`, `AdminUserRow` (both `from_attributes=True`, per the
  contract), `AdminAccountCreate` and `BlockUpdate` — none consumed by a
  route yet, that starts at U4.3–U4.5. `docs/SCHEMA.sql` gained
  `accounts.is_blocked`/`users.is_blocked` (both `BOOLEAN NOT NULL DEFAULT
  false`) and the `users.role` column comment now lists `system_admin`.
  `api/deps.py::resolve_permission` gained an explicit `Role.SYSTEM_ADMIN`
  branch at step 2, alongside `Role.ADMIN` — full access inside its own
  account (D712), since this resource matrix has no cross-account concept
  at all (that lives entirely in `api/admin.py`, starting at U4.3, per
  D711). **`require_admin` is deliberately untouched here** — U4.2's job,
  named explicitly by the plan as a separate unit, not this one's.
  New/updated tests: `test_models.py::test_admin_models` (all four new
  schemas) and its `test_enums_have_expected_members` now asserts the
  four-member `Role` set; `test_deps.py` gained a 16-row `Role.SYSTEM_ADMIN`
  block in `DEFAULT_MATRIX` (mirroring `Role.ADMIN`'s block exactly) and
  `test_system_admin_ignores_override_row` (mirroring
  `test_admin_ignores_override_row`); `test_account_repo.py`/
  `test_user_repo.py` each gained a default-`is_blocked`-is-`False`
  assertion against a real throwaway Postgres (`scripts/integration_docker.sh`),
  satisfying the AC's "every existing row reads back `is_blocked = false`";
  `tests/factories.py::make_user`'s `RETURNING` clause gained `is_blocked`
  (the DB default supplies the value — no INSERT column needed, same as
  `make_account`'s handling of `language`). **One gap found only by running
  the full fast suite, not by the file list above**: `bot/client.py::get_me`
  parses `GET /users/me`'s JSON straight into `UserMeResponse` — a name that
  doesn't match the `UserResponse` substring search the unit's initial file
  scan used, so it was missed until `pytest -m "not integration"` failed six
  bot tests on a `is_blocked` "Field required" `ValidationError`. Fixed by
  adding `"is_blocked": False` to the shared `_user_json` fixture helper in
  both `tests/test_bot_middlewares.py` and `tests/test_bot_bot.py` (the two
  files with their own copy of that helper) — no bot source change, since
  `bot/` never constructs `UserMeResponse` itself, only parses it. New
  migration `2026_08_28_1108-3573394f8c7a_add_is_blocked_columns.py`
  (down_revision `be7167499d7d`, U3.1's head) mirrors that migration's shape:
  two `ALTER TABLE ... ADD COLUMN is_blocked BOOLEAN NOT NULL DEFAULT false`
  statements upgrading `accounts` then `users`, `DROP COLUMN` in reverse
  order downgrading. Written only after asking the human, per the plan's own
  gate on this unit and `migrations/versions/`'s do-not-edit-without-asking
  rule. The AC's `alembic upgrade head` → `downgrade -1` round-trip was not
  run locally — real `alembic upgrade` can't run on this dev machine (D18,
  same as U3.1); CI's dedicated job covers it, per `test_schema_backfill.py`'s
  docstring. What *was* run locally: the full `bash scripts/integration_docker.sh`
  suite (94 passed) against `docs/SCHEMA.sql` applied directly via `psql`,
  and `bash scripts/verify.sh` end to end, both green. No route behaviour
  changed — `require_admin`, `api/admin.py` and every existing route are
  untouched, matching the AC's explicit "no route behaviour changes yet."

- **U4.2 is done**: `api/deps.py::get_current_user` gained an `account_repo`
  parameter and the block gate — `users.is_blocked` is checked first (no
  extra query), then the caller's account is fetched and `accounts.is_blocked`
  checked; either gets a `403` (`_blocked()` helper) with a distinguishable
  detail (`"User is suspended"` / `"Account is suspended"`), never the `401`
  an unknown/malformed credential gets (D713). Both credential paths
  (`X-Telegram-Init-Data` and the bot's header pair) converge on this one
  function, so both are gated identically — tested for both. `require_admin`
  now admits `Role.SYSTEM_ADMIN` alongside `Role.ADMIN` (mirrors
  `resolve_permission`'s step-2 D712 shape). New tests in `test_deps.py`:
  blocked-user and blocked-account cases via both credential paths (4 tests),
  an unblocked-user/unblocked-account control case, and three direct
  `require_admin` tests (admin/system_admin allowed, member denied).
  **Cross-cutting test fallout, not scope creep**: `get_current_user` is a
  dependency of every authenticated route, so the six other API test files
  whose hermetic `app.dependency_overrides` fixtures didn't already stub
  `get_account_repo` (`test_budgets_api.py`, `test_categories_api.py`,
  `test_expenses_api.py`, `test_permissions_api.py`, `test_statistics_api.py`,
  `test_tags_api.py`) started failing with `RuntimeError: Database pool is
  not initialized` the moment `get_current_user` needed an account lookup —
  fixed by adding a `FakeAccountRepo` override (via `test_deps.py`'s new
  `FakeAccountRepo`/`make_account` helpers, imported the same way those
  files already import `FakePermissionRepo`) to each file's `override_repos`
  fixture, seeded from their existing `account_id` fixture (and
  `other_account_id` too, for `test_permissions_api.py`'s `foreign_user`).
  `test_accounts_api.py`/`test_users_api.py` already had their own
  `get_account_repo` override (needed since U0.5/`get_current_user_with_currency`)
  and needed no change. **Known, accepted duplicate query**: `GET /users/me`
  (`get_current_user_with_currency`) now fetches the caller's account twice
  per request — once inside `get_current_user`'s block gate, once again for
  currency/language/account_name — since `get_current_user` returns
  `UserResponse`, not the account row. Left as-is: it's one extra query on
  one route, not worth widening `get_current_user`'s return type or adding
  a request-scoped cache for. `bash scripts/verify.sh` green end to end
  (757 backend unit tests, up from 750; 874 webapp tests unchanged — no
  webapp files touched) and `bash scripts/integration_docker.sh` green
  (94 passed, unchanged — no repository/schema change this unit).
- **U4.3 is done**: `api/deps.py` gained `require_system_admin` — admits
  `Role.SYSTEM_ADMIN` alone, unlike `require_admin`'s `(admin, system_admin)`
  pair; a plain `admin` gets 403 here. New `AccountRepository.list_for_admin()`
  (`LEFT JOIN users`, `GROUP BY accounts.id`, returns `AdminAccountRow` with
  `user_count`) and `UserRepository.list_for_admin()` (`JOIN accounts`,
  returns `AdminUserRow` with `account_name`) — both unscoped by `account_id`
  on purpose, the only such repo methods in the project (D711). New
  `services/admin_service.py::AdminService` (`list_accounts`/`list_users`,
  duck-typed repo protocols, mirrors `AccountService`'s shape) and new
  `api/admin.py` (`GET /admin/accounts`, `GET /admin/users`, both gated by
  `require_system_admin`), registered in `main.py` after `statistics_router`.
  Layering decision recorded as D719 (Decision log): the service/repo split
  stays, D711's carve-out is from account-scoping, not from
  routes→services→repositories. New tests: 4 `require_system_admin` cases in
  `test_deps.py`; new `tests/test_admin_api.py` (10 cases — cross-account
  visibility, `user_count`, plain-admin 403, member 403, missing-credentials
  401, and a blocked-system-admin-still-gets-403 case proving D713's gate
  applies here too); 2 new integration tests (`test_account_repo.py`,
  `test_user_repo.py`) against a real Postgres via
  `scripts/integration_docker.sh`, both green. `bash scripts/verify.sh` green
  end to end (771 backend unit tests, up from 757; 874 webapp tests
  unchanged — no webapp files touched); `bash scripts/integration_docker.sh`
  green (96 passed, up from 94).
- **U4.4 is done**: `POST /admin/accounts` creates the account, its owner
  user and the seeded "General" category in one transaction. New
  `BaseRepository.transaction()` (`repositories/base.py`) exposes
  `self._conn.transaction()` — the "small transactional variant" D31/D719
  already anticipated for the project's first genuinely cross-repo
  multi-write, recorded as **D720** (Decision log). `AdminService.create_account`
  (`services/admin_service.py`) opens `account_repo.transaction()`, creates
  the account, creates the owner (`role=admin`, D712) inside a `try`/`except
  asyncpg.UniqueViolationError` translating a duplicate `owner_tg_id` to
  `ConflictError` (409, same pattern as `user_service.py`), sets
  `accounts.owner_id` via `account_repo.update`, then creates the "General"
  category with `color_slot=1` hardcoded (always the first category of a
  brand-new account, so provably equivalent to
  `CategoryService._next_free_color_slot`'s result without pulling that
  per-account service into this cross-account surface). `AdminAccountRepositoryProtocol`/
  `AdminUserRepositoryProtocol` gained `create`/`update`/`transaction()` (account
  repo) and `create()` (user repo); a new `AdminCategoryRepositoryProtocol`
  was added, and `AdminService`'s constructor now takes `category_repo` too
  — `api/deps.py::get_admin_service` updated to inject it.
  `api/admin.py` gained `POST /admin/accounts` (`status_code=201`,
  `require_system_admin`-gated, same as the two `GET` routes).
  New tests: `tests/test_admin_service.py` (hermetic, 5 cases — happy path,
  `owner_id` set, currency/language defaults and overrides, duplicate-tg_id
  → `ConflictError` with no category write); `tests/test_admin_api.py`
  gained 5 HTTP cases (201, 409, admin/member 403, missing-credentials 401)
  and its `override_repo` fixture now also builds/overrides a fake
  `CategoryRepository`, widening its return tuple to three (the one existing
  `user_repo, _ = override_repo()` call site updated to `user_repo, _, _ =`);
  `tests/test_account_repo.py` gained one integration test
  (`test_transaction_rolls_back_cross_repo_writes_on_failure`) proving the
  real DB-level guarantee directly against `AccountRepository`/
  `UserRepository`/`CategoryRepository` sharing one connection — a duplicate
  `tg_id` partway through leaves no `accounts` row behind. `tests/README.md`
  updated with all of the above (repository, service and API/route
  sections). `bash scripts/verify.sh` green end to end (781 backend unit
  tests, up from 771; 874 webapp tests unchanged — no webapp files touched);
  `bash scripts/integration_docker.sh` green (97 passed, up from 96).
- **U4.5 is done**: `AdminService` gained `block_user`/`block_account`, both
  taking the calling system admin (`caller: UserResponse`) alongside the
  target id and the new flag. Each is a single `BaseRepository.update` on
  the one flag — `users.is_blocked` for `block_user`,
  `accounts.is_blocked` for `block_account` — so D714's "one flag, one
  place" holds structurally, not just by convention: `block_account` never
  touches `users` at all, so unblocking an account automatically restores
  exactly the members who were never individually blocked, with nothing to
  bookkeep. The self-block guard (`is_blocked and target_id == caller.id`
  / `caller.account_id`) only fires on the blocking direction — unblocking
  is never restricted, and is moot for self anyway since a self-block is
  now unreachable. Missing target → `NotFoundError` (404, existing global
  handler), self-block → a bare `ValueError`, mapped to **422** in
  `api/admin.py`'s two new routes via a small `_unprocessable()` helper —
  no new domain-error type, since this project already has this exact
  precedent (`api/expenses.py`/`api/statistics.py` catch `ValueError` from
  `resolve_period_params` the same way) and a one-off `SelfActionError`
  class for a single call site would be the kind of premature abstraction
  root CLAUDE.md rules out. Both new routes return the plain
  `UserResponse`/`AccountResponse` (not `AdminUserRow`/`AdminAccountRow`),
  matching every other PATCH in the project (`api/users.py::update_user`,
  `api/accounts.py::update_my_account`) rather than inventing a richer
  cross-account response shape the AC never asked for; the Mini App's
  U4.8 already computes suspended-via-account state client-side from its
  own two cached lists (per U0.5's spec), so it needs no extra join data
  back from this PATCH. `AdminAccountRepositoryProtocol`/
  `AdminUserRepositoryProtocol` (`services/admin_service.py`) each gained
  `get` (account already had `update`; user gained both `get` and
  `update`) — both were already implemented on the real repositories via
  `BaseRepository`, so this is a protocol-only change, no repo edit.
  New tests: 10 hermetic cases in `tests/test_admin_service.py` (block/
  unblock each of user and account, missing-id 404 each, self-block 422
  each, a self-*unblock* case proving the guard is direction-only, plus the
  D714 assertion — fixed after the reviewer's first pass flagged it, see
  below — that blocking an account leaves a *member of that account*'s
  `is_blocked` untouched, not an unrelated user in a different account);
  14 HTTP cases in `tests/test_admin_api.py` covering both routes'
  200/404/422/403/401 paths and an end-to-end D714 check (block then
  unblock an account with one of its users already individually blocked;
  the unblock response is 200 and that user's row is still blocked after).
  `bash scripts/verify.sh` green end to end (802 backend unit tests, up
  from 781; 874 webapp tests unchanged — no webapp files touched, matching
  the AC's backend-only scope). **Reviewer pass (round 1) returned APPROVE**
  with one WARN and three NITs, all fixed before finishing: the WARN
  (`test_block_account_sets_is_blocked_only_not_users` asserted against an
  unrelated user in a *different* account, so a broken mass-write
  implementation would still have passed it) was fixed by adding a `member`
  fixture actually inside the blocked account as the assertion target; two
  NITs got one-line comments explaining the deliberate self-block-before-
  existence-check ordering and the accepted get-then-update TOCTOU (no
  delete route exists on `users`/`accounts` today); the coverage-gap NIT
  (no test proved a system admin can unblock themselves) was closed by
  `test_system_admin_can_unblock_themselves`.
- **U4.6 is done**: `AllowlistMiddleware`'s probe (`bot/middlewares.py`)
  distinguishes a 403 (blocked, D713) from every other probe failure —
  `client.get_me()` already only swallows a clean 401 into `None`, so a 403
  reached the pre-existing broad `except Exception` and was silently dropped
  exactly like a transport error or a 5xx, which is precisely the "silence"
  U4.6's AC rules out. A new `except httpx.HTTPStatusError` branch, checked
  before that broad except, catches the 403 specifically, caches a third
  verdict state (`blocked`, alongside the existing `allowed`) in the same
  per-tg_id cache entry with `ttl_deny`, and sends the caller
  `bot/i18n.py`'s new `common.suspended` key — a single message covering
  both an individually-blocked user and a blocked account (the 403's own
  detail string distinguishes the two but the AC never asked the copy to),
  reusing `docs/ui/screens/10-admin.md`'s `suspended.title`/`suspended.body`
  wording (that spec explicitly left "which screen renders it" open for
  whichever M4 unit wires the 403 through — this is that unit, for the bot
  surface). The message needs the caller's real language, but a 403 body
  carries none, so the middleware also keeps a small, independently-evicted
  `_last_language: dict[int, Language]` populated on every successful probe
  (not gated by TTL) — a caller blocked after being previously allowed is
  messaged in the language their last good probe resolved; a caller blocked
  before ever succeeding once falls back to `Language.EN`, the same fallback
  `_resolve_language` already gives a denied (401) caller. A cached `blocked`
  verdict re-sends the message on every subsequent update while it stands
  (a suspension, not a one-time notice), with no second probe inside
  `ttl_deny` — mirroring how a cached `allowed`/`denied` verdict already
  avoids re-probing. Message delivery is duck-typed off the update
  (`event.message` or `event.callback_query.message`), not
  `isinstance`-checked against `aiogram.types.Update`, so it degrades to a
  silent drop (not a crash) for an update shape with nothing to answer, and
  a failure to *send* the notice is caught and logged rather than raised
  (bot/CLAUDE.md: never a raw traceback). D715's own risk note already
  covers the one thing this unit deliberately leaves alone: an
  already-cached *allowed* caller who gets blocked keeps reaching handlers
  for up to `ttl_ok` (five minutes), and every backend call they make in
  that window still gets a live, immediate 403 from `get_current_user`
  (D713) — surfaced through each handler's own generic error mapping
  (`readonly`, not `common.suspended`), a confusing message, never access.
  Fixing that message's wording for the mid-`ttl_ok` case would mean every
  handler's error mapping learning about blocking, which is out of this
  unit's scope per D715's own accepted-not-engineered-around framing; the
  AC itself says to test the 403, not the message timing. New tests: 8
  hermetic cases in `tests/test_bot_middlewares.py` — dropped-with-message,
  no backend call beyond the probe, real-language-via-`_last_language`,
  repeated notice with no second probe within `ttl_deny`, callback-query
  delivery, no-respondable-message-is-a-silent-drop, and the `WARNING` log.
  `bash scripts/verify.sh` green end to end (809 backend unit tests, up
  from 802; 874 webapp tests unchanged — no webapp files touched, matching
  the AC's bot-only scope).
- **U4.7 is done**: new `webapp/src/screens/admin.ts` (List mode only, per
  this unit's own narrower AC — the block/unblock flow is U4.8, the
  create-account form and its MainButton are U4.9, the side-menu entry point
  is U4.10; none of those exist yet, so this screen isn't reachable from
  `main.ts` in this unit, matching task-methodology's "pure rendering before
  wiring" decomposition order). Same three-layer split as every other
  screen: `loadAdmin` (`GET /users/me` for the caller's own ids, plus
  `GET /admin/accounts`/`GET /admin/users` in parallel, U4.3) resolves to
  `loading`/`forbidden`/`error`/`ready` — `forbidden` is a *real* top-level
  state here, unlike `settings.ts`/`language.ts`'s inline admin-gate
  sub-case, because this screen's own data calls are server-gated by
  `require_system_admin` and a `ForbiddenError` from either is caught the
  same way `budgets.ts::loadBudgets` already catches its own role gate; this
  screen has no cache (screen doc's States table: "this screen never caches
  its data locally"), so a network/offline failure resolves to the same
  `error` state as any other failure, with no separate `offline` status.
  `buildAccountRowView`/`buildUserRowView` are pure row-model builders (own
  unit tests, no DOM) computing the Suspended badge, the meta line and the
  disabled-trigger reason exactly per the screen doc's Anatomy — a user is
  suspended when either their own `is_blocked` or their account's row
  (already loaded, `blockedAccountIds`) is blocked (D714), but the trigger's
  own **label and colour follow the user's own `is_blocked` only**
  (`ownBlocked`, kept as its own field distinct from `isSuspended` after a
  self-review caught the two being conflated — an account-blocked-but-not-
  individually-blocked user's row was briefly rendering an "Unblock" trigger
  it shouldn't have). One implementation choice beyond the spec's own
  `[inferred]`: the suspended-via-account join uses `AdminUserRow.account_id`
  against `blockedAccountIds`' id set, not the `account_name` string match
  the screen doc's prose suggests — both `AdminUserRow` and `AdminAccountRow`
  already carry `account_id` (Contracts section), and matching by id is
  strictly more correct than by name (two accounts could share a display
  name) with no extra cost, so this isn't flagged as a fresh `[?]`. The
  trigger `<button>`s render with the correct label/colour/disabled state
  per row but carry **no click handler** in this unit's `mount()` — U4.8
  wires the confirm popup and the `PATCH`, per the plan's own unit split.
  `webapp/src/api/types.ts::Role` widened from three members to four
  (`"system_admin"` added, D710) — the one contract touch this unit needed,
  since `AdminUserRow.role` can hold it; new `AdminAccountRow`/`AdminUserRow`
  interfaces mirror `models/admin.py` verbatim (U4.1's contract).
  `client.ts` gained `listAdminAccounts()`/`listAdminUsers()` only — the
  three other admin endpoints (`POST /admin/accounts`,
  `PATCH /admin/accounts/{id}/block`, `PATCH /admin/users/{id}/block`) are
  added by the units that actually call them (U4.8/U4.9), not pre-added
  here as dead client methods. Written catalogue-native (D700): 19 new keys
  (`admin.*`) added to all three catalogues in the same change, including a
  `admin.role.*` set translating `AdminUserRow.role` for the meta line — a
  role name is as user-visible as any other string on this screen. A new
  `.sr-only` utility class was added to `app.css` (this app's first use of a
  visually-hidden-but-screen-reader-reachable node) for the disabled
  trigger's `aria-describedby` target, per the screen doc's Accessibility
  section; every other visual value reuses `.card`'s 14px radius and
  `.row`'s `10px 13px` padding verbatim from `07-tags.md`, and the blocked-row
  60% opacity from `06-categories.md`'s archived rows — no new
  design-system token. New `webapp/tests/admin.test.ts` (32 cases):
  `loadAdmin`'s four states including both admin endpoints' 403 mapping
  independently; `buildAccountRowView`/`buildUserRowView` covering the
  singular/plural meta split, the self-disable and account-blocked-disable
  reasons (including the self-takes-precedence case when a caller's own
  account is somehow blocked), and the ownBlocked-vs-isSuspended trigger
  divergence; `renderAdmin` for all four states plus the empty-lists
  no-crash case; RU/UK translation spot checks. `bash scripts/verify.sh`
  green end to end (809 backend unit tests, unchanged — no backend file
  touched; 906 webapp tests, up from 874). **Reviewer pass (round 1)
  returned changes-requested**, one blocking WARN plus two non-blocking
  ones, all addressed: the blocking one — `.admin-eyebrow--users`'s
  `margin-top: 24px` double-counted `.admin-view`'s own `12px` flex `gap`,
  landing 36px between sections instead of the screen doc's documented 24px
  — fixed to `margin-top: 12px`, the same arithmetic
  `.settings-language-section` already uses for its own 24px gap (comment
  added alongside it). The two non-blocking WARNs: `docs/ui/screens/
  10-admin.md`'s `user.meta` Copy row now states `{role}` is a localized
  label, not the raw enum value; and `api/types.ts::Role`'s own comment,
  which had wrongly implied `UserResponse.role`/`UserMeResponse.role` read
  back as `"admin"` for a system admin, was corrected to state that they
  pass the DB column through verbatim (`"system_admin"`, confirmed against
  `api/deps.py::get_current_user_with_currency`) — only the permission
  matrix treats the two as equivalent (D712), not the field's value. That
  correction surfaced a real pre-existing gap (`settings.ts`/`language.ts`/
  `expense-detail.ts` all gate on strict `role === "admin"`, so a system
  admin is today treated as a non-admin/non-owner on their own account's
  Settings/Language screen and on expense edit permission) — out of this
  unit's file list to fix, recorded as a new `[?]` in `10-admin.md`'s Open
  questions for whichever unit next touches one of those three files. The
  NIT (disabled-trigger tests asserting the reason text and the `disabled`
  attribute separately, never that `aria-describedby` actually resolves to
  the reason span's own `id`) was closed by rewriting both self-disable
  tests to assert the exact `id`/`aria-describedby` pairing. Re-verified
  green after all fixes (906 webapp tests, typecheck/lint/build clean).
- **U4.8 is done**: `webapp/src/screens/admin.ts` wires the Block/Unblock
  trigger U4.7 rendered but left unhandled. Same three-layer split the file's
  own header already documents: a pure `createAdminBlockController(api)`
  (directly unit-tested, no DOM) owns the double-submit guard exactly like
  `settings.ts::createSettingsController`'s `submitting` flag, except keyed
  per `"account:<id>"`/`"user:<id>"` so blocking one account and unblocking
  an unrelated user at the same time are independent, while a duplicate tap
  on the *same* trigger while its own PATCH is in flight is rejected before
  a second one fires. `withAccountBlocked`/`withUserBlocked` are tiny
  immutable flips of one row's `is_blocked`, used for both the optimistic
  apply and its own revert-on-failure (same value, opposite direction).
  `adminBlockConfirmMessage`/`adminBlockFailureMessage` build the
  Telegram-popup and retry-banner copy with a private, non-escaping
  `fillTemplate` — the same "pure modules don't share helpers" convention
  every other screen's own copy already follows — rather than `t()`'s
  auto-escaping vars, since these strings feed `confirmAction`/innerHTML text
  nodes, not markup. One deliberate gap from the screen doc's Copy table,
  not a fresh `[?]`: `confirm.yes.block`/`confirm.yes.unblock`/
  `confirm.cancel` are not implemented and not added to the catalogue —
  `showConfirm` has no custom button text (the same constraint
  `settings.ts::settingsConfirmMessage`'s own comment already documents),
  so those three keys would be dead catalogue entries with no call site;
  `06c-category-delete.md`'s own Copy table already omits the equivalent
  keys for exactly this reason, so this isn't a new finding. `mount()`'s
  `ready` branch now holds the accounts/users lists and an
  `AdminBlockFailure | null` in its own closure (no cache, matching the
  screen's own no-cache rule) and re-renders from that local state after
  every change — blocking an *account* needs no separate user-list update:
  `buildUserRowView`'s existing `blockedAccountIds(accounts)` join (U4.7)
  recomputes every affected user row's Suspended badge and disabled-trigger
  reason automatically on the next render, so the cascade the screen doc
  describes falls out of the existing join rather than needing new code. A
  confirmed tap (`handleTriggerTap`) opens `confirmAction`'s native popup,
  fires the `medium` haptic only after confirming (matching `06c`'s own
  rule), then delegates to `applyAndPatch` — the same function the retry
  banner's "Try again" calls directly, with no second confirm popup, per
  `main.ts::onRetryDelete`'s own precedent for 06c's delete-failure retry.
  `client.ts` gained `blockAdminAccount`/`blockAdminUser`, typed by their
  real response shapes (`AccountResponse`/`UserResponse`) even though
  `admin.ts` never reads the body — it already knows the outcome optimistic
  state already applied; no `BlockUpdate` mirror type was added to
  `api/types.ts` for a single inline-bodied call site in one file. Five new
  catalogue keys (`admin.confirm.blockAccount`/`unblockAccount`/
  `blockUser`/`unblockUser`, `admin.block.failed`) shipped in all three
  languages in this same change (D700). New `.admin-block-failed` CSS rule
  reuses `06c`'s own `.cat-delete-failed` treatment verbatim — no new
  design-system token. New tests in `webapp/tests/admin.test.ts` (17 cases,
  49 total in the file): the two pure row-flip helpers; all four
  confirm-message branches plus the failure message; the controller's
  success/error/routing/pending/duplicate-tap/independent-target behaviour;
  `renderAdmin`'s failure banner placed above the correct list for each
  `kind`, and absent when there's no failure. `bash scripts/verify.sh` green
  end to end (809 backend unit tests, unchanged — no backend file touched;
  923 webapp tests, up from 906; typecheck/lint/build clean, including the
  secret-grep). `mount()` itself stays the file's one accepted
  not-meaningfully-unit-tested gap, same as every other screen's mount —
  consistent with this file's own header, not a new deviation.
  **Reviewer pass (round 1) returned APPROVE** with one WARN, fixed before
  finishing: `applyAndPatch` cleared the single-slot `failure` banner
  unconditionally on every call, so confirming an unrelated, independent
  target (the controller's guard deliberately lets two different accounts/
  users toggle concurrently) dismissed a still-unresolved failure banner for
  a *different* target before its own outcome was known. Fixed by clearing
  `failure` only when it belongs to the same `kind`/`id` being acted on.
  `failure` is still a single slot (same shape as `categories.ts`/
  `tags.ts`'s own delete-failure banner) — two different targets failing at
  once still show only the most recent one — an accepted limitation of that
  shape, not something this fix attempts to solve. Re-verified green after
  the fix (923 webapp tests, typecheck/lint/build clean). **Reviewer pass
  (round 2) returned APPROVE**, confirming the fix introduced no new bug.
  Two NITs left deferred, both cosmetic/pre-existing from this unit's
  original diff, not the fix: `.admin-block-failed` (app.css) drops the
  `12px` bottom margin `.cat-delete-failed` has, despite the comment saying
  "verbatim"; and an in-flight trigger stays visually enabled (no
  disabled/spinner state) during its own PATCH — a rapid second tap is
  still correctly swallowed by the controller (AC holds), just with no
  visual feedback that the tap did nothing.
- **U4.9 is done**: `webapp/src/screens/admin.ts` gained Create-account mode
  — List mode's new MainButton ("Create account", always enabled) switches
  `mount`'s own internal `mode` (`"list" | "create"`) and replaces the two
  lists with `renderCreateForm` in place, no navigation, matching the screen
  doc's Layout section. `AdminState`/`renderAdmin`'s existing contract is
  untouched: Create mode is entirely mount-local state
  (`mode`/`createController`), the same choice `budget-form.ts` made for its
  own single-mode screen, since it isn't fetched data and neither U4.7 nor
  U4.8's tests needed to change. Three pure, directly-tested pieces do the
  real work: `createNameError`/`createOwnerTgIdError`/`createOwnerNameError`
  (the three validatable fields — currency/language are `<select>`s seeded
  with a real default and can't be invalid, per the AC), `isCreateFormDirty`/
  `createAccountConfirmMessage` (fed to `confirmDiscard`/`confirmAction` via
  the file's existing non-escaping `fillTemplate`, same convention as every
  other native-chrome message here), and `createAdminCreateController` — a
  `budget-form.ts::createBudgetFormController`-shaped double-submit guard
  that owns the draft and posts the trimmed, typed `AdminAccountCreate` body
  on `submit()`, mapping a `409 ApiError` to `create.error.duplicateOwner`
  and anything else to `create.error.generic` (mirroring
  `budget-form.ts::saveErrorMessage`'s own 409 branch). Field errors are
  gated by a single `attempted` flag (set on a blocked "Create account" tap,
  cleared on reopen) rather than per-field blur tracking like
  `categories.ts::nameInteracted` — a deliberate simplification for this
  single-attempt form, noted here since it's an implementation choice the
  spec left open, not a plan decision. `client.ts` gained
  `createAdminAccount()`; `api/types.ts` gained `AdminAccountCreate`
  (mirrors `models/admin.py` verbatim, U4.1's contract). Currency/language
  `<option>` lists reuse `settings.ts::CURRENCY_ORDER`/`currencyName` and
  `language.ts::LANGUAGE_ORDER`/`languageName` verbatim — no new list or
  copy, per the screen doc's Components section. 20 new `admin.create.*`
  catalogue keys shipped in all three languages in this same change (D700);
  `confirm.yes`/`confirm.cancel`-shaped dead keys are skipped, same
  reasoning U4.8 already gave `showConfirm`'s lack of custom button text.
  New CSS (`app.css`): `.admin-create-form`/`.admin-create-header`/
  `.admin-create-field` mirror `budget-form-screen`'s own 20px-gap/24px-above
  rhythm; `.admin-input`/`.admin-select` are a new plain-text/select input
  pair for `.card.field` (`.amount-input`/`.comment-input` are both sized
  for their own specific roles, neither fits a generic field) — no new
  design-system token, and no custom select-arrow glyph (the screen doc's
  own no-new-glyph rule; the browser/OS supplies the native arrow).
  BackButton and the in-screen Cancel button share the same dirty-check
  mechanism (`requestCloseCreate`) but differ in destination exactly as the
  screen doc's Interactions table states: BackButton always ends at Home in
  both modes, Cancel returns to List mode only — `mount` now owns
  `setBackButtonHandler`/`mainButton` directly (previously the unused,
  now-superseded `applyAdminChrome` static call), since BackButton's
  behaviour depends on mode, which only `mount` has visibility into.
  `webapp/tests/admin.test.ts` gained 24 new cases (73 total): the three
  field-error functions, `createFormValid`/`isCreateFormDirty`,
  `createAccountConfirmMessage`, `createAdminCreateController`'s
  blocked/success/409/generic-error/duplicate-tap-guard behaviour (mirroring
  `createAdminBlockController`'s own duplicate-tap test), `renderCreateForm`
  covering the header/fields/action buttons, the default-selected currency/
  language options, the attempted-gated field errors, the submit-error
  banner and value preservation, plus an RU/UK translation spot check.
  `bash scripts/verify.sh` green end to end (809 backend unit tests,
  unchanged — no backend file touched; 947 webapp tests, up from 923;
  typecheck/lint/build clean, including the secret-grep). **Reviewer pass
  (round 1) returned REQUEST_CHANGES**, no blockers, three findings fixed in
  this same unit: (1) the Saving state didn't disable the form/buttons —
  the controller's own guard already made "exactly one POST" hold, but
  `10-admin.md`'s States table explicitly also says "form and buttons
  disabled"; `renderCreateForm` gained a `saving` param that adds `disabled`
  to every field and both buttons, set by `mount`'s `handleCreateSubmit`
  around the `submit()` call. (2) `.admin-select`'s `appearance: none`
  stripped the native dropdown arrow with no replacement glyph, directly
  contradicting the screen doc's own stated "no custom select-arrow glyph...
  the browser/OS supplies the native arrow" — removed. (3)
  `createOwnerTgIdError` had no upper bound on digit count, so an absurdly
  long id could silently lose precision through `Number(...)` in `submit()`
  with no error surfaced; added a `Number.isSafeInteger` check to the same
  function (same error copy, no new key). Two non-blocking NITs fixed
  alongside: the Currency/Language fields no longer render an always-empty
  `.field-error` node (the screen doc's Layout table has no 3a/4a error
  region for them, only 2a/5a/6a — `renderCreateField` gained a
  `withError` flag); `createAccountConfirmMessage` now trims every value
  the same way `submit()` trims the POST body, so the popup can't diverge
  from the request by whitespace. `webapp/tests/admin.test.ts` gained 5 more
  cases (78 total) covering the safe-integer bound, the trimmed confirm
  message, the removed error nodes, and the saving-disabled state.
  Re-verified green (952 webapp tests, typecheck/lint/build clean).
- **Next:** `/clear`, then **U4.10** (the eighth side-menu row, gated on the
  role, plus the docs).
