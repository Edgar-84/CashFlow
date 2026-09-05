# Screen: 10 — Admin

## Purpose
Where a **System Admin** — and only a system admin — creates new accounts and
blocks or unblocks any account or user across the whole product. It is the one
screen that deliberately steps outside `account_id` isolation (D711); every
other screen in this app shows the caller's own account only.

## Reference
No screenshot. Built entirely from written intent:
- `docs/plans/mini-app-v7.md`, item 2 and D710–D715 — the role model, the
  block semantics and the M4 units this file gates (U4.7–U4.10).
- `08-settings.md` — the `--card` list / section-eyebrow rhythm this screen
  reuses rather than inventing a third one (the plan's own Constraints say
  so explicitly).
- `06c-category-delete.md` — the Telegram-native-`showConfirm` +
  optimistic-patch pattern, reused here for block/unblock.
- `04b-budget-form.md` — the in-screen Save/Cancel pattern (MainButton
  hidden) for the create-account form, because Cancel again has no native
  equivalent to pair with a MainButton.
- `../components/side-menu.md` — the eighth row this screen is reached from.

## Delta from reference
- **Taking:** `08-settings.md`'s `--card` list, section eyebrows and row
  rhythm for the two lists; `06c-category-delete.md`'s confirm-popup +
  optimistic-patch shape for block/unblock; `04b-budget-form.md`'s
  in-screen Save/Cancel (no MainButton) for the create form, and its
  header-line pattern.
- **Changing:** there is no single outside reference to change against — this
  screen is an original composition of the three patterns above, not a delta
  from one source.
- **Explicitly not taking:** an audit log of admin actions (plan Non-goals);
  a delete affordance for accounts or users — this screen only blocks and
  unblocks, `DELETE /users/{id}` is untouched and out of this screen's scope
  (plan Non-goals); a self-registration flow (plan Non-goals); any icon —
  this screen introduces no new glyph, matching the design system's
  no-icon-set rule.

## Layout
Two modes on one screen: **List** (default, on open) and **Create account**
(opened by MainButton, replaces the list in place — no navigation, same
screen instance). Nothing here is `position: fixed`, matching every
non-Home screen; BackButton is native chrome.

### List mode
One scroll container, top to bottom.

| # | Region | Geometry |
|---|---|---|
| 1 | Section heading "Accounts" | section eyebrow (10px/600, 0.11em, uppercase, `--ink-secondary`), 16px above — matches `08-settings.md` region 1 |
| 2 | Accounts list | one `--card`, 14px radius, one row per account, auto height, 1px `--separator` between rows |
| 3 | Section heading "Users" | same eyebrow style, 24px above — the between-sections spacing value, matching `08-settings.md` region 4 |
| 4 | Users list | one `--card`, 14px radius, one row per user, auto height, 1px `--separator` between rows |

Neither list is searchable or paginated in this unit (see Open questions);
both scroll with the page, the same "no internal scroll" rule
`08-settings.md`'s currency list follows.

#### Account row anatomy (region 2)
`10px 13px` padding (`.row`'s existing pairing, reused verbatim from
`07-tags.md`), two text lines on the left and one trigger on the right:
1. **Name** — 13.5px/600 `--ink` (Row title role), single line, ellipsis.
   `4px` under it:
2. **Meta** — 12px/400 `--ink-secondary`: `{currency} · {language endonym} ·
   {n} user(s)` (see Copy for the singular/plural split).
3. **Trigger** — right-aligned, vertically centred across both lines:
   "Block" (`--status-red`, the same token `06c` uses for a destructive text
   action) or "Unblock" (`--ink`, restorative, not destructive) depending on
   the account's current `is_blocked`. Disabled (50% opacity) for the
   caller's **own** account — see States and Edge cases.

A blocked account's row additionally shows a **"Suspended"** badge (11px/400
`--status-red`, matches the Caption role) directly under the meta line, and
the whole row renders at 60% opacity — the same "historical/inert, not
interactive" treatment `06-categories.md`'s archived rows use.

#### User row anatomy (region 4)
Same `10px 13px` padding, same two-line-plus-trigger shape:
1. **Name** — 13.5px/600 `--ink`, single line, ellipsis.
2. **Meta** — 12px/400 `--ink-secondary`: `{account name} · {role} · tg_id
   {tg_id}`.
3. **Trigger** — "Block"/"Unblock", same colour rule as the account row.
   Disabled for the caller's own user row, **and** for any user whose
   account is currently blocked (see States — blocking a user inside an
   already-blocked account has no observable effect and D714 keeps the two
   flags independent, so the control is disabled rather than offering a
   toggle that changes nothing visible).

A user is shown **Suspended** (same badge and 60% opacity as the account
row) when **either** their own `is_blocked` is true **or** their
`account_name` matches a currently-blocked row in the Accounts list already
loaded above — computed client-side from the two lists this screen already
has, no extra fetch. This is load-bearing: D714 deliberately never writes
`users.is_blocked` when an account is blocked, so reading `AdminUserRow.
is_blocked` alone would show a blocked account's members as active.

### Create-account mode
Single scroll container, replacing the list. No `96px` MainButton reserve —
MainButton is hidden here, same reasoning `04b-budget-form.md` gives.

| # | Region | Geometry |
|---|---|---|
| 1 | Header | "New account", 15px/600 `--ink`, `20px` top padding — mirrors `04b`'s header line |
| 2 | Account name field | label "Account name" (12px `--ink-secondary`); `card field` text input, `20px` above |
| 2a | Name error | one line, `--status-red`, 12.5px; collapses to zero height when empty |
| 3 | Currency field | label "Currency"; a `card field` `<select>` listing the 15 currencies in `08-settings.md`'s enum order, defaulting to USD, `20px` above |
| 4 | Language field | label "Language"; a `card field` `<select>` listing the three languages by endonym (`09-language.md`'s order), defaulting to English, `20px` above |
| 5 | Owner Telegram ID field | label "Owner's Telegram ID"; `card field` numeric text input, `20px` above |
| 5a | Owner ID error | as region 2a |
| 6 | Owner name field | label "Owner's name"; `card field` text input, `20px` above |
| 6a | Owner name error | as region 2a |
| 7 | Submit error banner | only after a failed create; existing `.submit-error` treatment |
| 8 | Actions | "Create account" (primary) and "Cancel", 44px tall, `24px` above — same pairing `04b` uses |

## Components used
None from `../components/`. Both lists reuse `08-settings.md`'s existing
`--card`/row/eyebrow rules; the form reuses `app.css`'s `.card.field` markup
(`04b-budget-form.md`'s regions 3/5) plus two `<select>` elements styled the
same way, which is new to this screen (see Open questions — every other
picker in this app is a full-screen radiogroup or sheet, and a plain
`<select>` is a deliberate scope-saving choice for a screen only the
system admin ever opens).

## Telegram
- **Theme:** every colour from `tokens.css`, both themes. `--status-red` is
  used for "Block" triggers and the "Suspended" badge — both already covered
  by that token's documented usage ("destructive text actions"). No new
  token, no `--accent`, no category colour anywhere on this screen.
- **MainButton:**
  - **List mode:** "Create account" — the screen's one persistent primary
    action, always enabled, always visible. Tapping switches to Create mode;
    no confirm needed just to open a blank form.
  - **Create mode:** **hidden** — same reasoning as `04b-budget-form.md`:
    Cancel has no native equivalent, so pairing a native MainButton with an
    in-screen Cancel would split one choice across two places. The primary
    action is the in-screen "Create account" button (region 8).
- **BackButton:** shown in both modes; returns one step
  (`../navigation.md`). List mode's one step is **screen 01** — this screen
  is reached only from the side menu, Home-only, like every other menu
  destination. Create mode's one step is **back to List mode**, since
  Create is pushed onto List, not onto Home; a dirty draft (any field
  differs from its empty/default value) asks first via Telegram's own
  popup — the same `confirmDiscard` flow Add Expense and the
  category/budget forms use.
- **Haptics:**
  - `medium` impact the instant a block/unblock popup is **confirmed** (not
    on the tap that opens it) — matches `06c`'s rule exactly; the visible
    change is optimistic, so no second haptic on the background PATCH
    resolving.
  - `success` after `POST /admin/accounts` resolves; `error` on failure.
  - Nothing while typing in the create form.
- **Viewport:** Create mode autofocuses the account-name field on open
  (mirrors `04b`'s create-mode autofocus), opening the keyboard over regions
  3–8; those stay reachable by scrolling. The owner-Telegram-ID field uses
  `inputmode="numeric"` so the numeric keyboard shows for that field
  specifically. List mode has no text entry.

## States
The five-state framework applies per mode.

### List mode
| State | Trigger | What the user sees |
|---|---|---|
| Loading | first open | 4 skeleton rows in each section, real row height, no reflow when data lands |
| Empty | n/a | **Unreachable in practice** — the system admin belongs to an account and is themself a user, so neither list can ever be truly empty (same "unreachable" status `08-settings.md`'s currency list has) |
| Error | `GET /admin/accounts` or `GET /admin/users` rejects, no cache | `err.load` + `err.retry`. Never a raw status code |
| **403** | the caller's role is not `system_admin` | Neither list renders. `admin.forbidden` shown alone, no retry — this is a permission wall, not a transient failure |
| Offline | either fetch rejects, no cache | Same as Error — **this screen never caches its data locally.** It is cross-account, sensitive data; persisting every family's account list on a system admin's device for an offline view is not a feature this needs, unlike Home's own-account snapshot |
| Populated | both fetches succeed | Both lists render as specced above |

### Create-account mode
| State | Trigger | What the user sees |
|---|---|---|
| Idle | opened via MainButton | blank form, defaults per the Layout table |
| Saving | "Create account" tapped and confirmed | form and buttons disabled; exactly one `POST` regardless of taps |
| 409 | duplicate `owner_tg_id` | region 7: `create.error.duplicateOwner`; draft preserved |
| Error | any other failure | region 7: `create.error.generic`; draft preserved |
| Success | `POST` resolves | `success` haptic; returns to List mode, which **refetches** both lists so the new account and its owner appear immediately |

## Interactions

| Element | Action | Result |
|---|---|---|
| Side menu "Admin" row | tap | selection haptic; navigates here (system admin only — see `side-menu.md`) |
| BackButton | tap | List mode: one step back — Home, its only opener. Create mode: dirty → discard popup; clean → one step back — List mode (`../navigation.md`) |
| Account/user "Block"/"Unblock" trigger, enabled | tap | opens Telegram's `showConfirm` naming the target and the action (see Copy) |
| Account/user "Block"/"Unblock" trigger, disabled | tap | nothing — a real `disabled` control; the reason is in its accessible description |
| Confirm popup | cancel | closes; no request sent |
| Confirm popup | confirm | `medium` haptic; the row's badge/opacity/trigger label flip immediately (optimistic); the matching `PATCH` fires in the background |
| PATCH resolves | — | nothing visibly changes — the optimistic state was already correct |
| PATCH fails | — | the row reverts to its prior state; a banner above the affected list names the target and offers "Try again", which re-issues the same `PATCH` |
| MainButton "Create account" (list mode) | tap | switches to Create mode |
| Create-mode "Create account" button, enabled | tap | opens Telegram's confirm popup restating the owner and account name |
| Create-mode "Cancel" | tap | identical to BackButton: discard popup if dirty, else back to List mode with no write |
| Create confirm popup | confirm | `POST /admin/accounts`; see States |
| Create confirm popup | cancel | closes; form unchanged, no request |
| Retry (list load error) | tap | re-fetch both lists |

**Dirty** (create mode): any field differs from its empty/default value
(empty name, default currency/language, empty owner fields).

## Copy

| Key | String | Notes |
|---|---|---|
| `title` | "Admin" | the side-menu row and this screen's accessible name |
| `section.accounts` | "Accounts" | section eyebrow |
| `section.users` | "Users" | section eyebrow |
| `account.meta.one` | "{currency} · {language} · 1 user" | account row meta, singular |
| `account.meta.many` | "{currency} · {language} · {n} users" | account row meta, `n ≥ 2` (or `0`, grammatically fine as "0 users") |
| `account.suspended` | "Suspended" | badge, account row |
| `user.meta` | "{accountName} · {role} · tg_id {tgId}" | user row meta — `{role}` is a localized label (`admin.role.system_admin`/`admin.role.admin`/`admin.role.member`/`admin.role.viewer`, U4.7), not the raw enum value; a role name is as user-visible as any other string on a catalogue-native (D700) screen |
| `user.suspended` | "Suspended" | badge, user row — shown for both an individually-blocked user and one whose account is blocked |
| `trigger.block` | "Block" | both rows, `--status-red` |
| `trigger.unblock` | "Unblock" | both rows, `--ink` |
| `disabled.self.account` | "You can't block your own account." | account row, caller's own account |
| `disabled.self.user` | "You can't block yourself." | user row, caller's own user entry |
| `disabled.accountBlocked` | "This account is suspended — unblock the account to change this user." | user row, when the account is already blocked |
| `confirm.block.account` | "Block \"{accountName}\"? Every user in this account loses access immediately." | popup |
| `confirm.unblock.account` | "Unblock \"{accountName}\"? Every user who isn't individually blocked regains access immediately." | popup |
| `confirm.block.user` | "Block {userName}? They lose access immediately; the rest of their account stays active." | popup |
| `confirm.unblock.user` | "Unblock {userName}? They regain access immediately." | popup |
| `confirm.yes.block` | "Block" | popup primary, block direction |
| `confirm.yes.unblock` | "Unblock" | popup primary, unblock direction |
| `confirm.cancel` | "Cancel" | popup, both directions |
| `block.failed` | "Couldn't update {name}." | retry banner over the affected list |
| `err.load` | "Couldn't load the admin panel." | list-mode load failure |
| `err.retry` | "Try again" | existing string, unchanged |
| `admin.forbidden` | "This page is for system admins only." | 403 state, no retry |
| `create.mainButton` | "Create account" | MainButton, list mode |
| `create.header` | "New account" | region 1 |
| `create.field.name.label` | "Account name" | |
| `create.field.name.placeholder` | "e.g. The Kims" | |
| `create.field.name.error` | "Enter an account name." | |
| `create.field.currency.label` | "Currency" | |
| `create.field.language.label` | "Language" | |
| `create.field.ownerTgId.label` | "Owner's Telegram ID" | |
| `create.field.ownerTgId.placeholder` | "e.g. 123456789" | |
| `create.field.ownerTgId.error` | "Enter a numeric Telegram ID." | |
| `create.field.ownerName.label` | "Owner's name" | |
| `create.field.ownerName.placeholder` | "e.g. Anna Kim" | |
| `create.field.ownerName.error` | "Enter the owner's name." | |
| `create.action.create` | "Create account" | in-screen primary |
| `create.action.cancel` | "Cancel" | |
| `create.confirm.title` | "Create this account?" | popup title |
| `create.confirm.message` | "{ownerName} (Telegram ID {tgId}) will be added as the first admin of \"{accountName}\"." | popup body |
| `create.confirm.yes` | "Create account" | popup primary |
| `create.confirm.cancel` | "Cancel" | popup |
| `create.error.duplicateOwner` | "That Telegram user already has an account." | 409, region 7 |
| `create.error.generic` | "Couldn't create the account. Try again." | any other failure, region 7 |
| `discard.title` | existing discard-draft popup copy | reused from `02b-edit-expense.md` |
| `discard.confirm` | "Discard" | reused |
| `discard.cancel` | "Keep editing" | reused |

### The suspended state (cross-screen, defined here — not a region on this screen)
A system admin can never see this copy on themself (U4.5's server-side rule
and this screen's own disabled-self trigger both prevent a system admin
blocking their own account or user), so it can only ever be seen by a
**blocked caller elsewhere in the app** — most likely on Home, the first
screen to call `GET /users/me` after boot. This spec is the one that owns
block semantics, so the copy is defined here; **which screen renders it is
not decided here** (see Open questions) — the natural candidate is Home's
existing Error/403-shaped state, extended with a distinguishable branch for
the 403's suspended detail (D713).

| Key | String | Notes |
|---|---|---|
| `suspended.title` | "This account has been suspended" | `[inferred]` |
| `suspended.body` | "Contact your family's account owner if you think this is a mistake." | `[inferred]` |

## Data

| Call | Notes |
|---|---|
| `GET /users/me` | gates this screen (`role === "system_admin"`) and supplies the caller's own `account_id`/user id, used to disable the two self-block triggers |
| `GET /admin/accounts` | U4.3, new. Returns `AdminAccountRow[]` (id, name, currency, language, is_blocked, user_count, created_at) |
| `GET /admin/users` | U4.3, new. Returns `AdminUserRow[]` (id, tg_id, name, role, account_id, account_name, is_blocked) |
| `PATCH /admin/accounts/{id}/block` | U4.5, new. Body `{ is_blocked }` |
| `PATCH /admin/users/{id}/block` | U4.5, new. Body `{ is_blocked }` |
| `POST /admin/accounts` | U4.4, new. Body is `AdminAccountCreate` (name, currency, language, owner_tg_id, owner_name); `409` on a duplicate `owner_tg_id` |

All five admin routes and their request/response shapes are already fixed in
`docs/plans/mini-app-v7.md`'s Contracts section (`models/admin.py`) — nothing
here introduces a new field or a new shape.

## Accessibility
- Neither list is a `radiogroup` — rows are informational; the Block/Unblock
  trigger inside each is the only interactive element per row, a real
  `<button>` with an accessible name that states the target and the action
  ("Block The Kims", "Unblock Anna Kim") rather than the bare word alone.
- A disabled trigger carries its reason as `aria-describedby`
  (`disabled.self.account` / `disabled.self.user` /
  `disabled.accountBlocked`), so a screen-reader user hears *why*, not just
  that it does nothing.
- The "Suspended" badge is text, not colour alone — `--status-red` on the
  badge is reinforcement, matching this app's identity-never-by-colour-alone
  rule everywhere else.
- Create-mode fields have real `<label for>` elements, matching
  `04b-budget-form.md`'s accessibility fix over the shipped budget form.
  Inline errors are `aria-live="polite"`.
- Focus order, list mode: BackButton (native) → account rows top to bottom →
  user rows top to bottom → MainButton (native chrome). Create mode: name →
  currency → language → owner Telegram ID → owner name → Create → Cancel.
- `prefers-reduced-motion`: nothing on this screen animates beyond the
  optimistic row updates, which are instant state changes, not transitions.

## Edge cases
- **Zero accounts or zero users** — unreachable (see States, Empty); the
  system admin is themself a user in an account.
- **A very long account or owner name** — ellipses on its single line,
  matching every other row in this app.
- **Non-numeric owner Telegram ID** — caught client-side before any request
  (U4.9 AC); the field's inline error, never a Telegram popup.
- **Duplicate `owner_tg_id`** — server 409, rendered as
  `create.error.duplicateOwner`, draft preserved so the admin can pick a
  different `tg_id` without retyping the rest.
- **A system admin tries to block their own account or user** — the trigger
  is disabled client-side (see Anatomy); the backend's own 422 (U4.5's AC)
  is a defence-in-depth backstop this UI should never actually trigger.
- **Blocking a user whose account is already blocked** — the trigger is
  disabled with `disabled.accountBlocked`; nothing to toggle would change
  what the user actually experiences (D714 — blocking is account-scoped or
  user-scoped, never both for the same suspension).
- **Two system admins act on the same account at once** — last write wins,
  same "no concurrency token" acceptance `08-settings.md` states for
  currency changes.
- **Unblocking an account that has individually-blocked users** — those
  users stay suspended (D714: "unblocking restores exactly the users who
  were not individually blocked"); their rows keep the Suspended badge
  after the account's clears, because their own `is_blocked` is still true.

## Acceptance criteria
- [ ] The screen renders two stacked `--card` lists, "Accounts" then "Users"
      (24px below), each row auto-height with a name, a meta line and a
      Block/Unblock trigger.
- [ ] A blocked account's row shows a "Suspended" badge and renders at 60%
      opacity; a user's row shows the same badge when either their own
      `is_blocked` is true or their account's row (already loaded above) is
      blocked — computed client-side with no extra fetch.
- [ ] Tapping any enabled Block/Unblock trigger opens Telegram's native
      confirm popup naming the target and the action before any request is
      sent; cancelling sends nothing.
- [ ] Confirming issues exactly one `PATCH`; the row's badge/opacity/trigger
      label update immediately without a full reload of either list; a
      failed `PATCH` reverts the row and shows a banner naming the target.
- [ ] The caller's own account row and own user row have a disabled Block
      trigger with a visible reason.
- [ ] A user row whose account is already blocked has a disabled Block/
      Unblock trigger with `disabled.accountBlocked`.
- [ ] MainButton reads "Create account" in List mode; tapping it switches to
      Create mode, where MainButton is hidden and the screen shows in-screen
      "Create account"/"Cancel" buttons instead.
- [ ] The create form requires account name, currency, language, owner
      Telegram ID and owner name; a non-numeric Telegram ID is rejected
      before any request reaches the network.
- [ ] Tapping the create form's "Create account" button opens a Telegram
      confirm popup naming the owner and the account before the `POST`
      fires.
- [ ] A `409` from `POST /admin/accounts` shows "That Telegram user already
      has an account." with every field exactly as typed, not a generic
      failure message.
- [ ] On success, the screen returns to List mode and both lists refetch,
      showing the new account and its owner without a manual reload.
- [ ] A caller whose role is not `system_admin` who reaches this screen's
      route directly sees only `admin.forbidden`, never the lists or a
      blank screen.
- [ ] Rendering is correct in both light and dark, every colour resolved
      from `tokens.css`, and no element uses `--accent` or a category
      colour.

## Open questions
- [?] **Currency/Language as plain `<select>`s.** Every other picker in this
      app is a full-screen radiogroup (`08-settings.md`) or a bottom sheet
      (`06b-category-form.md`'s colour picker); this form uses a native
      `<select>` styled with the existing field chrome instead, to avoid
      building a third picker pattern for a screen only one persona ever
      opens. Flag if the inconsistency reads badly next to the rest of the
      app.
- [?] **List ordering.** Accounts `created_at DESC` (newest first) and users
      sorted by account name then user name, both `[inferred]` — not stated
      by the plan. Confirm, or specify differently.
- [?] **No pagination** on `GET /admin/accounts` / `GET /admin/users`. Fine
      at this product's family-account scale; would need revisiting if the
      account count grows into the hundreds.
- [?] **Where the suspended-state copy (see Copy) actually renders.** This
      spec defines the strings because block semantics live here, but the
      screen that shows them to a blocked caller (most likely Home, extending
      its existing Error/403 states with the suspended branch) is not
      decided in this file — it belongs to whichever M4 unit wires the
      403 detail through, or a decision of its own if that turns out to be
      non-trivial.
- [?] **`account.meta`/`user.meta` exact separators and field order** are
      `[inferred]` — easy to adjust in the Copy table.
- [?] **Pre-existing gap, found during U4.7's review, not fixed there:**
      `UserResponse.role`/`UserMeResponse.role` pass the DB column through
      verbatim (`api/deps.py::get_current_user_with_currency`) — a real
      system admin's own `GET /users/me` reads `role: "system_admin"`, not
      `"admin"`. D712 only makes `system_admin` behave as `admin` inside the
      *permission matrix* (`resolve_permission`/`require_admin`), not in the
      field's value. `settings.ts`/`language.ts`/`expense-detail.ts` all gate
      on strict `role === "admin"`, so a system admin viewing their own
      account's Settings/Language screen, or editing another user's expense,
      is today treated as a non-admin/non-owner — contradicting D712. Not
      this screen's file list to fix; needs its own unit or a fix folded
      into whichever unit next touches one of those three files.
