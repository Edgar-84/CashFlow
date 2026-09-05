# Screen: 08 — Settings

## Purpose
The one place account-level preferences are changed. V4 shipped it with
exactly one setting, the **currency** every amount in the app is labelled
with. V7 adds a second: a **Language** row that navigates to its own screen
(`09-language.md`) rather than growing this one into a second inline list
(D706) — see the new region 4/5 below.

Reached from the side menu's seventh row and from nowhere else.

## Reference
- Verbal brief from the user, 2026-08-07: "Add a 7th item to the side menu:
  Settings. Inside Settings, allow the user to change the currency (default:
  USD), with the ability to switch to other currencies."
- No image reference. Every geometric value is `[inferred]` from the existing
  list screens (`06-categories.md`, `07-tags.md`), whose row rhythm this reuses
  rather than inventing a third one.
- V7 brief, 2026-08-25: "A per-account language, a language picker in the
  menu" — placed here rather than in the side menu itself; see D706 and
  `../components/side-menu.md`'s Resolved section.

## Delta from reference
- **Taking:** n/a — no visual reference exists.
- **Changing:** V7 adds a second section (Language). The original brief's
  "explicitly not taking a screen full of toggles" still holds — this is a
  navigation row to its own screen, not a second inline radiogroup competing
  with Currency's fifteen rows on one page.
- **Explicitly not taking:** a settings screen full of toggles. The original
  V4 brief held this to a single section, and adding a second was a decision,
  not a fill-in — the decision V7 makes is a *navigation row* to its own
  screen, not a toggle or a second inline list competing with Currency.

## Layout
One scroll container, top to bottom.

| # | Region | Geometry |
|---|---|---|
| 1 | Section heading | "Currency", section eyebrow (10px/600, 0.11em, uppercase, `--ink-secondary`), 16px above |
| 2 | Warning line | 12px `--ink-secondary`, above the list, always visible — not only after a change |
| 3 | Currency list | one `--card`, 14px radius, 15 rows of 48px, 1px `--separator` between |
| 3a | ↳ Row | code (14px/600 `--ink`) · name (14px/400 `--ink-secondary`) · `✓` right-aligned on the selected row |
| 4 | Section heading **(V7)** | "Language", same eyebrow style as region 1, 24px above — the between-sections spacing value, not the 16px a heading uses above its own list |
| 5 | Language row **(V7)** | one `--card`, 14px radius, single 48px row: current language's endonym (14px/600 `--ink`) · ISO code (12px/400 `--ink-secondary`) below it — no `✓` here, this row navigates, it does not select |

The list is **not** searchable and does not scroll internally — 15 rows on one
card, the page scrolls.

Row order is the order `models/enums.py::Currency` declares (USD, EUR, GBP, PLN,
UAH, CZK, CHF, SEK, NOK, DKK, JPY, CNY, CAD, AUD, TRY) — the same order the API
would list them in, so client and server never disagree about what "the
currencies" are `[inferred]`.

**Region 5 is a navigation row, not a picker** — tapping it opens
`09-language.md`, where the actual three-row radiogroup lives (see that file's
Delta section for why the interaction model differs from Currency's). This row
never carries its own `✓`, `radiogroup`, or MainButton state; it is a single
button whose accessible name is "Language, {endonym}".

## Components used
None. Rows reuse `app.css`'s existing list-row rules.

## Telegram
- **Theme:** every colour from `tokens.css`. The `✓` is `--ink`; there is no
  accent and no category colour anywhere on this screen.
- **MainButton:** this screen's primary action.
  - Label: `Save currency`.
  - **Disabled until the selection differs** from the account's current
    currency. Hidden entirely for a non-admin (see States).
  - On tap: Telegram's confirm popup first — this changes what every amount in
    the account, for every member, is labelled — then `PATCH`.
- **BackButton:** shown; returns one step, to **screen 01** — the only
  screen that opens this one (`../navigation.md`). With an unsaved selection
  it asks first, via Telegram's popup, using the same discard flow the
  composer uses.
- **Haptics:** `selection` on a currency row tap;
  `notificationOccurred('success')` after the PATCH resolves, `('error')` on
  failure.
- **Viewport:** no keyboard on this screen.

## States

| State | Trigger | What the user sees |
|---|---|---|
| Loading | opened | The 15 rows render immediately (they are a static list); only the `✓` waits on `GET /users/me`, shown as a skeleton on no row |
| Empty | n/a | Unreachable — the currency list is a constant |
| Error | `GET /users/me` fails and there is no cache | "Couldn't load your settings." + "Try again". No row is marked selected; MainButton hidden |
| **403 / non-admin** | the caller's role is not `admin` | The list renders with the current currency marked, **every row inert**, MainButton hidden, and one line above the list: "Only an account admin can change the currency." Nothing is hidden — a member can see what the account is set to |
| Offline | fetch fails, cache exists | Cached currency marked, last-synced banner, rows inert, MainButton hidden — this is a write, and there is no write queue |
| Ready | loaded, admin | Current currency marked; tapping another enables MainButton |
| Confirming | MainButton tapped | Telegram popup naming the target currency and restating that amounts are not converted |
| Saving | popup confirmed | Rows and MainButton disabled; exactly one PATCH regardless of taps |
| Saved | PATCH resolved | Success haptic; back to screen 01, which **refetches** so every amount is relabelled immediately |
| Save failed | 403/network | Back to `ready` with "Couldn't change the currency." under the list; the selection is kept so the user can retry |

The Language row **(V7)** has no states of its own beyond loading with the
rest of the screen — it always navigates, for every role, admin or not (the
read-only rule lives on `09-language.md` itself, the same way a member can
open Categories read-only rather than the row being hidden).

## Interactions

| Element | Action | Result |
|---|---|---|
| Currency row | tap | selection haptic; moves the `✓`; MainButton enables (or disables again if the original is re-picked) |
| MainButton | tap | confirm popup |
| Popup "Change currency" | tap | `PATCH`; on success back to Home |
| Popup "Cancel" | tap | nothing; the selection stays where the user put it, unsaved |
| BackButton | tap | unsaved selection → discard popup; otherwise one step back — Home, its only opener (`../navigation.md`) |
| Language row **(V7)** | tap | selection haptic; navigates to `09-language.md` for every role — no confirm, nothing to discard here |

## Copy

| Key | String | Notes |
|---|---|---|
| `title` | "Settings" | the side-menu row and the screen's accessible name |
| `section.currency` | "Currency" | section eyebrow |
| `warn.noConversion` | "Changing the currency relabels existing amounts. It does not convert them — 50.00 stays 50.00." | always visible above the list |
| `confirm.title` | "Change currency?" | popup title |
| `confirm.message` | "Every amount in this account will be shown in {code}. Existing amounts are not converted." | popup body, names the target |
| `confirm.yes` | "Change currency" | destructive-ish primary |
| `confirm.cancel` | "Cancel" | |
| `mb.save` | "Save currency" | MainButton |
| `readonly.admin` | "Only an account admin can change the currency." | non-admin |
| `err.load` | "Couldn't load your settings." | |
| `err.save` | "Couldn't change the currency." | |
| `error.retry` | "Try again" | existing string |
| `discard.title` | "Discard changes?" | reused from 02b |
| `discard.confirm` | "Discard" | reused |
| `discard.cancel` | "Keep editing" | reused |
| `section.language` **(V7)** | "Language" | section eyebrow, region 4 |
| `row.language.aria` **(V7)** | "Language, {endonym}" | the row's accessible name — see `09-language.md`'s Copy for `{endonym}` values |

### Currency names
All fifteen, in enum order. Every one is `[inferred]` — drafted here so the unit
is not blocked on copy, and meant to be overwritten rather than trusted.

| Code | Name |
|---|---|
| USD | US Dollar |
| EUR | Euro |
| GBP | British Pound |
| PLN | Polish Złoty |
| UAH | Ukrainian Hryvnia |
| CZK | Czech Koruna |
| CHF | Swiss Franc |
| SEK | Swedish Krona |
| NOK | Norwegian Krone |
| DKK | Danish Krone |
| JPY | Japanese Yen |
| CNY | Chinese Yuan |
| CAD | Canadian Dollar |
| AUD | Australian Dollar |
| TRY | Turkish Lira |

English names, no localisation — the rest of the app is English-only. The names
are **client-side copy**, not an API field: adding a name to `Currency` would
put presentation in an enum the backend uses for validation.

## Data

| Call | Notes |
|---|---|
| `GET /users/me` | the account's current `currency`; already returned (D211) |
| `PATCH /accounts/me` | **new** — see below |
| `GET /users/me` **(V7)** | this same call also returns `language` (U3.1's `UserMeResponse.language`) — no second fetch for region 5's row label |

### Backend deltas this screen needs

**One new route, and it is the only backend work V4's Settings needs.**

```
PATCH /accounts/me      body: { "currency": "EUR" }      → AccountResponse
```

- Guarded by `require_admin` (api/CLAUDE.md's third tier). `accounts` is not in
  the `Resource` enum and gets no per-user override row — the same shape
  `users` and `permissions` already use. A non-admin gets 403, which is the
  state above.
- The account is derived from the caller's `account_id`, never from the body.
  There is no `/accounts/{id}`.
- `currency` validates against `models.enums.Currency`; anything else is 422
  from Pydantic, not a hand-written check.
- **No conversion, no migration, no audit row** (2026-08-07, HUMAN). The column
  is a display label; `expenses.amount` is untouched minor units. This is the
  whole decision, and the warning copy above exists because of it.
- `services/account_service.py` is new and thin (get + update currency);
  `repositories/account_repo.py` already exists and needs only what
  `BaseRepository.update` gives it.

### The minor-unit exponent problem, stated so it is not discovered later
`lib/money.ts` formats every amount with **two decimal places**, and the backend
stores minor units on the same assumption. Three of the fifteen currencies do
not have two-decimal minor units in ISO 4217 — JPY has none.

This is **pre-existing**, not introduced here: `accounts.currency` has been
settable to JPY since D211, by SQL at account creation, and an amount of `5000`
in a JPY account already renders as `50.00` when it should be `5,000`. V4 makes
it reachable from the UI, which is the first time anyone is likely to hit it.

Not fixed in V4 (the fix is an exponent per currency in `lib/money.ts` **and**
in every place the backend parses an amount, including the bot). It is named
here, and in the plan's Risks, so the choice to defer it is deliberate.

## Accessibility
- The currency list is a `radiogroup`; each row is a `radio` with
  `aria-checked`. The `✓` is decorative and `aria-hidden` — selection is carried
  by the ARIA state and the row's 600-weight code, not by the glyph alone.
- Rows are 48px, above the 44px floor.
- The warning line is associated with the group via `aria-describedby`, so it is
  read before a selection is made, not after.
- For a non-admin the group is `aria-readonly` and the explanation is in the
  group's accessible description.
- Focus order: rows in list order. MainButton is native chrome.
- `prefers-reduced-motion`: nothing on this screen animates.
- **(V7)** The Language row (region 5) is a plain `button`, not part of the
  currency `radiogroup` — it navigates, it does not select. Its accessible
  name is "Language, {endonym}" so a screen-reader user hears the current
  value without opening the sub-screen. Focus order: currency rows → Language
  row (region 5 sits after region 3 in both visual and DOM order).

## Edge cases
- **The account's stored currency is somehow not in the list** — impossible via
  the API (it is the same enum) but if it happens, no row is marked and
  MainButton stays disabled rather than silently selecting USD.
- **Two admins change it at once** — last write wins. No concurrency token.
- **Changed while another family member has the app open** — their screen keeps
  the old label until it refetches. Acceptable: it is a label, not a number.
- **A member (non-admin) opens Settings** — sees the current currency and why
  they cannot change it. Never a blank screen and never a broken control.
- **Back-navigating mid-change** — the discard popup; the selection is not
  persisted anywhere.
- **(V7) A non-admin taps the Language row** — it still navigates; the
  read-only behaviour is on `09-language.md`, not gated here. Consistent with
  how a member reaches this very screen read-only rather than the Settings
  row being hidden from them in the side menu.

## Acceptance criteria
- [ ] The side menu's Settings row opens this screen, and its heading reads
      "Currency".
- [ ] All 15 currencies are listed with their code and name, in the enum's
      order.
- [ ] The account's current currency is the only row with a `✓`, and its code is
      600 weight.
- [ ] The no-conversion warning is visible **before** any selection is made.
- [ ] MainButton reads "Save currency" and is disabled until a different
      currency is selected.
- [ ] Tapping "Save currency" opens Telegram's popup naming the target currency;
      cancelling it fires no request.
- [ ] Confirming it returns to Home (this screen's only opener,
      `../navigation.md`), where the donut's total and every amount now
      render with the new code — without closing and reopening the app.
- [ ] After the change, an expense of 5000 minor units still reads 50.00 — the
      number did not move.
- [ ] For a non-admin the rows are inert, MainButton is absent, and the
      admin-only line is visible.
- [ ] Renders correctly in light and dark from `tokens.css` only.
- [ ] **(V7)** A "Language" section renders below Currency with one row
      showing the account's current language by endonym and code; tapping it
      navigates to `09-language.md` for every role, admin or not.

## Open questions
- ~~[?] **The 15 currency names** are drafted above and `[inferred]`. Worth one
      read-through — "Złoty" carries a diacritic and "Krone"/"Krona" differ by
      one letter between Denmark, Norway and Sweden.~~ — **read through and kept
      as drafted (2026-08-08, U3.3)**. All fifteen names checked against ISO
      4217 common usage; no correction needed.
- ~~[?] **Symbol or code?**~~ — **resolved as codes (2026-08-08, U3.3)**, per
      this doc's own recommendation: consistent with every other screen's
      "38.40 EUR" rendering, and the first symbol in the app would have been a
      net-new precedent for one screen only.
- ~~[?] **Anything else in Settings.**~~ — **answered (2026-08-25, V7, D706)**:
      Language, in `09-language.md`, reached via the new row above. `family_tz`
      is still a backend env var and deliberately not exposed; notification
      preferences still do not exist.
