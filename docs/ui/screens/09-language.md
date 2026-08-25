# Screen: 09 — Language

## Purpose
Where the account's UI language is changed. V7 ships three: English, Russian,
Ukrainian (D702). Reached from **Settings' new "Language" row** and from
nowhere else — this drawer stays at seven rows (D706, see
`../components/side-menu.md`'s Resolved section).

## Reference
- Verbal brief from the user, 2026-08-25 (V7): "The whole UI can be shown in
  the account's language." No image reference — every geometric value below is
  `[inferred]` from `08-settings.md`'s currency list, whose row rhythm this
  reuses rather than inventing a third one, per the plan's Constraints.
- `docs/plans/mini-app-v7.md`'s Contracts section — `Language` enum,
  `AccountResponse.language`, `AccountUpdate.language`,
  `UserMeResponse.language`, and `webapp/src/lib/i18n.ts`'s `setLanguage`/`t`
  (U3.1/U3.3). This spec does not restate those; it only relies on them.
- U0.4's own acceptance criterion (`mini-app-v7.md`) — this file is written to
  satisfy it directly, and U3.11's acceptance criterion, which this spec's
  Interactions/States sections implement.

## Delta from `08-settings.md`'s currency list
The two screens share a shape (a `--card` list of an enum, admin-gated,
`✓` on the current value) but the **interaction model differs on purpose**:

- **Taking:** the row shape, the `--card`/48px/`--separator` list geometry,
  the `radiogroup` accessibility pattern, the non-admin read-only rule, the
  offline/error states — all copied from `08-settings.md` verbatim except
  where noted below.
- **Changing — no MainButton, no confirm popup, no discard flow.** Currency
  is select-then-save because relabelling every amount in the account is a
  financial-adjacent action worth a second tap. Language is not: it is pure
  chrome relabelling (Non-goals: "Translating stored data" is explicitly out
  — category names, tag names, the account name and comments never change).
  U3.11's acceptance criterion says it plainly — **"picking a language
  PATCHes the account"** — so a row tap *is* the commit. There is nothing to
  discard, so `BackButton` never asks first (unlike `08-settings.md`'s
  unsaved-currency case).
- **Changing — the row's primary/secondary emphasis is swapped.** Currency
  shows the code first (14px/600) because a code is what every screen in this
  app already prints next to an amount. Language shows the **endonym** first
  (14px/600) and the ISO code second (12px/400) — a reader picking their own
  language recognises "Русский", not "ru".
- **Explicitly not taking:** currency's warning line about non-conversion —
  there is no equivalent risk here. In its place, one explain line states what
  does and does not change (Layout, region 1).

## Layout
One scroll container, top to bottom — the same shape `08-settings.md` uses.

| # | Region | Geometry |
|---|---|---|
| 1 | Section heading | "Language", section eyebrow (10px/600, 0.11em, uppercase, `--ink-secondary`), 16px above — same style token as `08-settings.md`'s "Currency" heading |
| 2 | Explain line | 12px `--ink-secondary`, above the list, always visible |
| 3 | Language list | one `--card`, 14px radius, **3** rows of 48px (design-system.md Sizing: the same 48px value `08-settings.md`'s currency row and the side menu row both use), 1px `--separator` between |
| 3a | ↳ Row | endonym (14px/600 `--ink`) · ISO code (12px/400 `--ink-secondary`) below it · `✓` right-aligned on the selected row |

The list is not searchable and does not scroll internally — three rows on one
card, same as currency's fifteen.

Row order is the order `models/enums.py::Language` declares: EN, RU, UK
(Contracts, U3.1) — the same order the API lists them in, mirroring
`08-settings.md`'s own reasoning for following `Currency`'s enum order.

## Components used
None. Rows reuse `app.css`'s existing list-row rules, same as `08-settings.md`.

## Telegram
- **Theme:** every colour from `tokens.css`. The `✓` is `--ink`; no accent,
  no category colour.
- **MainButton:** **hidden.** See Delta — a row tap is the commit, so there is
  no separate save action for a MainButton to trigger.
- **BackButton:** shown; always returns to Settings (08). No unsaved state
  exists on this screen, so it never asks first — unlike `08-settings.md`'s
  own BackButton.
- **Haptics:** `selection` on a tap that changes the selection (a different
  row than the current one); none on a tap that re-taps the already-selected
  row (no-op, see Interactions); `notificationOccurred('success')` when a
  PATCH resolves, `('error')` on failure.
- **Viewport:** no keyboard on this screen.

## Reload/re-render behaviour after a change
The moment a PATCH resolves, the client calls `i18n.setLanguage()` (Contracts,
U3.3) with the confirmed value directly — it does **not** wait for a refetch
of `/users/me` the way currency's Home refetch does. That call re-renders
every mounted piece of chrome across the app (this screen, Settings behind it,
the side menu next time it opens) in place, with **no `location.reload()` and
no full-page navigation**. This is a different rule from D709's cache-first
boot behaviour: D709 governs the very first paint, before any server response
exists; here the server has just confirmed the value, so there is nothing to
reconcile against later.

Numbers and dates are unaffected — `formatAmount` and the period selector's
`describe` keep formatting in the browser's default locale (Open question
below, plan-level, resolved as out of scope for V7).

## States

| State | Trigger | What the user sees |
|---|---|---|
| Loading | opened | The 3 rows render immediately (a static list); only the `✓` waits on `GET /users/me`, shown as a skeleton on no row |
| Empty | n/a | Unreachable — the language list is a constant |
| Error | `GET /users/me` fails and there is no cache | "Couldn't load your language setting." + "Try again". No row is marked selected |
| **403 / non-admin** | the caller's role is not `admin` | The list renders with the current language marked, **every row inert**, and one line above the list: "Only an account admin can change the language." Nothing is hidden — a member can see what the account is set to |
| Offline | fetch fails, cache exists | Cached language marked, last-synced banner, rows inert — this is a write, and there is no write queue |
| Ready | loaded, admin | Current language marked; tapping a different row commits immediately |
| Saving | a different row tapped | Rows disabled; exactly one PATCH regardless of taps; the `✓` moves to the tapped row optimistically |
| Saved | PATCH resolved | Success haptic; `setLanguage()` runs (see above); back to Settings |
| Save failed | 403/network | Back to `ready`; the `✓` **stays on the tapped row** (kept, same rule `08-settings.md`'s Save-failed state uses for its selection) with "Couldn't change the language." under the list; tapping any row — including the one just attempted — retries |

## Interactions

| Element | Action | Result |
|---|---|---|
| A row that is **not** the current selection | tap | selection haptic; `✓` moves optimistically; rows disable; PATCH fires |
| The row that **is** the current selection | tap | nothing — no haptic, no request (avoids a redundant PATCH) |
| BackButton | tap | Settings (08), always — no discard prompt (see Delta) |
| Retry (error state) | tap | re-fetch |

## Copy

| Key | String | Notes |
|---|---|---|
| `title` | "Language" | this screen's accessible name; also Settings' new row label |
| `section.language` | "Language" | section eyebrow |
| `explain.chrome` | "Changes what language the app's menus and buttons use. Category names, tag names, your account name and any comments are never translated." | always visible above the list |
| `readonly.admin` | "Only an account admin can change the language." | non-admin |
| `err.load` | "Couldn't load your language setting." | |
| `err.save` | "Couldn't change the language. Tap a language to try again." | no separate retry button — a row tap is the retry |
| `error.retry` | "Try again" | existing string, reused verbatim (load-error state) |
| `offline.banner` | "Offline — showing data from {time}" | existing string, reused verbatim (Home, 06, 07) |

### Language names
All three, in enum order. Endonyms are `[inferred]` — drafted here so the
unit is not blocked on copy, and meant to be overwritten rather than trusted,
same disclaimer `08-settings.md` gives its currency names.

| Code | Endonym |
|---|---|
| en | English |
| ru | Русский |
| uk | Українська |

These are **client-side copy**, not an API field, for the same reason
`08-settings.md`'s currency names are: adding a name to `Language` would put
presentation in an enum the backend uses for validation. Unlike currency, this
name IS itself localised chrome text under D702's own rule — each catalogue
states its own language's endonym for itself (i.e. the RU catalogue's entry
for `en` is still "English" in Latin script, but its entry for `ru` is
"Русский" not a translated description of it) — this is drafted in EN's
catalogue voice here since the three-way table above is enum-ordered, not
per-catalogue; the actual `webapp/src/lib/i18n.ts` catalogues (U3.4) are
where each language names itself.

## Data

| Call | Notes |
|---|---|
| `GET /users/me` | the account's current `language`; already contracted (U3.1's `UserMeResponse.language`) |
| `PATCH /accounts/me` | **no new route** — the same route `08-settings.md` specs for `currency`, already contracted to also accept `language` (U3.1's `AccountUpdate.language`). One call changes one field; the other is untouched either direction (U3.2's AC) |

No backend delta belongs to this unit — U3.1/U3.2 already contract and
implement it. This screen only consumes what those units produce.

## Accessibility
- The language list is a `radiogroup`; each row is a `radio` with
  `aria-checked`. The `✓` is decorative and `aria-hidden` — same rule
  `08-settings.md` states for its own `✓`.
- Rows are 48px, above the 44px floor.
- The explain line is associated with the group via `aria-describedby`.
- For a non-admin the group is `aria-readonly` and the explanation is in the
  group's accessible description.
- Focus order: rows in list order. BackButton is native chrome.
- `prefers-reduced-motion`: nothing on this screen animates.

## Edge cases
- **The account's stored language is somehow not in the list** — impossible
  via the API (it is the same enum) but if it happens, no row is marked,
  mirroring `08-settings.md`'s equivalent case for currency.
- **Tapping the already-selected row** — no-op; explicitly not a re-send of
  the same PATCH.
- **Two admins change it at once** — last write wins. No concurrency token,
  same as currency.
- **Changed while another family member has the app open** — their chrome
  keeps the old language until their own next boot or reconciliation; D709's
  cache-first rule already accepts this kind of staleness for one render.
- **A member (non-admin) opens this screen** — sees the current language and
  why they cannot change it. Never a blank screen.
- **Back-navigating during `Saving`** — allowed; the PATCH continues in the
  background and its result reaches the account on the next fetch even though
  this screen is gone. There is no write queue anywhere else in the app
  either.

## Acceptance criteria
- [ ] The picker lives on its own screen, reached only from a new "Language"
      row inside Settings (08) — not a side-menu destination (D706).
- [ ] All three languages are listed by endonym — English, Русский,
      Українська — with their ISO code below, in the enum's order (en, ru,
      uk).
- [ ] The account's current language is the only row with a `✓`.
- [ ] Tapping a different row PATCHes `/accounts/me` immediately — no
      MainButton, no confirm popup — and a success haptic follows a resolved
      PATCH.
- [ ] After a successful change, the app's chrome re-renders in the new
      language **without a page reload**, via `setLanguage()`, and the screen
      returns to Settings.
- [ ] Tapping the already-selected row does nothing — no haptic, no request.
- [ ] For a non-admin the rows are inert and the admin-only line is visible;
      the current language is still shown — the same rule the currency list
      follows.
- [ ] A failed PATCH keeps the attempted selection visible and shows
      "Couldn't change the language."; tapping a row retries.
- [ ] Renders correctly in light and dark from `tokens.css` only.

## Open questions
- [?] **Locale-aware number and date formatting** — resolved **out of scope
      for V7** (this unit's call, per the plan's own open question asking
      U0.4 to decide it). `formatAmount` and the period selector's `describe`
      keep the browser's default locale regardless of the account's language
      setting; the plan's Non-goals already draw this line for stored data,
      and this extends the same "only chrome is translated" rule to
      formatting. Revisit as its own plan if ever wanted — it touches every
      screen that renders a number or a date, not just this one.
- [?] **The three endonyms** are drafted above and `[inferred]`. Worth a
      read-through before U3.4 writes the actual catalogues, same as
      `08-settings.md`'s currency names got one read-through before being
      kept as drafted.
