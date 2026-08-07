# Component: Side menu

## Purpose
The app's navigation, as a panel that slides in from the left over screen 01 and
covers it until dismissed. It replaces the six-tile bottom row that screen 01
carried until V4 (2026-08-07, HUMAN: "6 buttons are always visible at the
bottom… cluttering the UI"), and it is the only place the seven destinations are
listed.

**Used by `../screens/01-home.md` only.** Every other screen reaches Home
through BackButton and has no menu button of its own — a drawer available from
everywhere would give this app two competing navigation models (see Resolved).

## Reference
- `../refs/side-menu/menu-button.jpg` — the ☰ glyph: three horizontal bars,
  square ends, roughly as wide as they are tall in total.
- `../refs/side-menu/panel-open.jpg` — the open drawer over a dimmed page.
- Verbal brief from the user, 2026-08-07: "a hamburger icon (☰, three
  horizontal lines) that opens a side menu sliding in from the left, overlaying
  the main screen, containing these same 6 items as a list", plus Settings as a
  seventh.

Measurements below are taken off `panel-open.jpg` at 588px wide for a 390pt
viewport — a scale of ~1.51 image-px per CSS px. Every `[ref]` figure is
approximate at that precision.

## Delta from reference
- **Taking:** the full-height panel pinned to the left edge, covering **~80% of
  the width** (`~468/588 [ref]`) with the dimmed page visible beside it; an
  **identity header** in a distinct band at the top, separated from the list by
  a single rule; a plain vertical list of rows with **no separators between
  them** `[ref]`; a **footer line at the bottom-left** showing when the data was
  last synced `[ref]`; the panel reaching under the status bar.
- **Changing:**
  - **No icons on the rows.** The reference gives every row a 24px outline
    glyph; this app has no icon set (design-system Iconography, resolved
    2026-08-04) and adding seven would take the icon inventory from 8 to 15,
    triggering the consolidation review that file describes. Seven text rows
    are legible without them.
  - Row pitch goes from `~39px [ref]` to **48px**, because 39 is under the 44px
    touch-target floor this project holds everywhere else.
  - The header carries the **account name and currency**, not an avatar and a
    balance: this app has no avatars and no balance concept.
  - Panel colour is `--card` over `--scrim`, not the reference's brand green,
    and it is **opaque** — the reference's panel is translucent with a gradient,
    which would put page content behind menu text.
- **Explicitly not taking:** the brand green; the circular logo/avatar; the
  "Balance: zł0" line; the reference's own row set — **Accounts**, **Regular
  Payments**, **Reminders**, **Turn off ads**, **Share with friends**, **Rate
  the app** and **Contact the support team** all name features this app does not
  have. Its **"Home"** row is also dropped: this menu opens from Home and from
  nowhere else, so a row returning there would be a no-op.

## Anatomy
In render order:

1. **Scrim** — full viewport, `--scrim`, sits above the page and below the
   panel. Tapping it closes the menu.
2. **Panel** — `min(80vw, 320px)` wide `[ref]`, full viewport height, `--card`
   background, **opaque**, no radius on the left corners (it meets the screen
   edge), 14px radius on the right corners `[inferred]`, extending under the
   status bar and honouring `env(safe-area-inset-top)` /
   `env(safe-area-inset-bottom)` as padding.
3. **Header** — a `--app-background` band `[ref: a distinct band]`, `16px`
   padding, holding two lines:
   - the **account name**, 15px/600 `--ink`;
   - the **currency code**, 12px/400 `--ink-secondary`, on the line below.

   Both come from `GET /users/me`, which Home has already loaded — the menu
   never fetches. One 1px `--separator` rule under the band, and only there.
4. **Rows** — seven, in this order: Add expense · Expenses · Budgets ·
   Statistics · Categories · Tags · Settings. 48px tall, `0 16px` padding,
   14px/500 `--ink`, left-aligned, **no rule between them** `[ref]`.
5. **Footer** — pinned to the bottom of the panel, `16px` padding, 11.5px/400
   `--ink-secondary`: the last-synced line `[ref]`. Rendered only when the host
   has a cache timestamp to show; absent otherwise, never showing a placeholder.

No icons anywhere in the panel — see Delta.

**Settings is separated from the six** by a 12px gap `[inferred]` — the first
six are places money is looked at or entered, Settings is not, and the brief
added it as a distinct seventh item rather than a seventh peer. A gap, not a
rule: the reference's list has no rules between rows and adding one only here
would read as a heading boundary rather than a grouping.

## Variants

| Variant | When used | What differs |
|---|---|---|
| Default | a member or admin opens the menu | All seven rows enabled |
| Read-only | `ForbiddenError` on Home's writes, i.e. a viewer | "Add expense" is **disabled, not hidden**, at 50% opacity — the same rule the bottom-nav tile followed. The other six stay enabled |

## States

| State | Trigger | What the user sees |
|---|---|---|
| Closed | default | Nothing. The panel is not in the accessibility tree and not focusable |
| Opening | menu button tapped | Panel slides `translateX(-100%)` → `0` over 200ms `ease-out`; scrim fades in over the same duration |
| Open | animation finished | Panel at rest; the page behind it is dimmed, inert and not scrollable |
| Closing | scrim tap, row tap, BackButton, or Escape | Reverse, 160ms `ease-in`. A row's navigation starts **immediately**, not after the animation |
| Pressed | tap on a row | Row background `--app-background` for the press duration |
| Disabled row | read-only viewer, "Add expense" | 50% opacity, no haptic, no navigation |
| Loading | — | n/a. The menu renders from a static list and never fetches |
| Error | — | n/a. Nothing here can fail |

## Copy

| Key | String | Notes |
|---|---|---|
| `menu.aria` | "Menu" | the ☰ button's accessible name — the glyph is not one |
| `menu.title` | "Menu" | the panel's `aria-label`; **not rendered as visible text** |
| `header.account` | "{account name}" | from `GET /users/me`; no label word above it |
| `header.currency` | "{code}" | e.g. "USD"; the code alone, no "Currency:" prefix |
| `footer.synced` | "Synced {date} {time}" | e.g. "Synced 8/7/2026 17:18" `[ref]` — omitted entirely when unknown |
| `item.addExpense` | "Add expense" | existing string, unchanged from the tile row |
| `item.expenses` | "Expenses" | existing |
| `item.budgets` | "Budgets" | existing |
| `item.statistics` | "Statistics" | existing |
| `item.categories` | "Categories" | existing |
| `item.tags` | "Tags" | existing |
| `item.settings` | "Settings" | new |

The six existing labels are carried over verbatim from `HOME_TILES` in
`webapp/src/screens/home.ts`, so the change is where they live, not what they
say.

## Sizing and spacing
From the design system's Sizing table: panel `min(80vw, 320px)`, row 48px,
menu button 44×44 with a 20px glyph. Row padding `0 16px`, header and footer
padding `16px`, gap above Settings 12px. Panel radius 14px on the right corners
only.

The ☰ glyph itself, off `menu-button.jpg`: three bars of equal length, square
ends, stroke `~2.5px [ref]` at our 20px box, spaced so the whole stack is about
as tall as it is wide. Drawn inline in the module that renders it, like every
other icon in this app.

## Accessibility
- The panel is `role="dialog"` `aria-modal="true"` with `aria-label="Menu"`.
- **Focus moves into the panel** when it opens (first row) and returns to the
  menu button when it closes. Focus is trapped inside while open — nothing
  behind the scrim is reachable by tab.
- Escape closes it, as does Telegram's BackButton (see the host screen's spec:
  BackButton is *shown while the menu is open* and hidden again on close — this
  is the one thing on screen 01 that gives the root screen a BackButton).
- The scrim is `aria-hidden` and not focusable; it is a tap target, not a
  control.
- Every row is a `button` with a 48px hit target — above the 44px floor.
- Identity is text alone; no colour is used to distinguish rows.
- `prefers-reduced-motion`: no slide and no fade — the panel and scrim appear
  and disappear instantly.

## Inputs
Pure render function plus a thin mount, no fetching and no state — the
`webapp/src/components/` rule.

```ts
type MenuItem =
  | "add-expense" | "expenses" | "budgets"
  | "statistics" | "categories" | "tags" | "settings";

interface SideMenuProps {
  open: boolean;
  accountName: string | null;  // header line 1; the band renders without it
  currency: string | null;     // header line 2
  lastSyncedAt?: string;       // footer; omitted → no footer
  readOnly?: boolean;          // disables "Add expense" only
  onSelect(item: MenuItem): void;   // host navigates AND closes
  onClose(): void;                  // scrim tap, BackButton, Escape
}
```

`accountName`/`currency`/`lastSyncedAt` are **passed in, never fetched** — Home
already holds all three. A component that fetched would break the
`webapp/src/components/` rule and put a spinner inside a navigation menu.

`open` is owned by the host (screen 01), not by this component — the same
division `period-selector.md` uses for `value`. The component renders a state
and reports taps; it never decides whether it is open.

`onSelect` does **not** close the menu by itself. The host closes it as part of
navigating, so there is one place where "the menu is no longer open" is decided.

## Acceptance criteria
- [ ] Tapping ☰ on screen 01 slides a panel in from the left edge over 200ms
      and dims the rest of the screen.
- [ ] The panel lists exactly seven rows in the order Add expense, Expenses,
      Budgets, Statistics, Categories, Tags, Settings.
- [ ] The panel is at most 320px wide and leaves the dimmed page visible beside
      it on a phone.
- [ ] The header shows the account name over its currency code, on a band
      separated from the list by exactly one rule.
- [ ] No rule is drawn between any two rows.
- [ ] No row renders an icon.
- [ ] With a cached snapshot the footer reads "Synced …" at the bottom-left;
      with none, no footer is rendered.
- [ ] Tapping the dimmed area closes the menu and navigates nowhere.
- [ ] Telegram's BackButton appears while the menu is open, closes it, and
      disappears again — it never navigates away from Home.
- [ ] Tapping a row navigates to that screen and leaves no scrim or panel behind
      when the destination renders.
- [ ] The page behind the open menu does not scroll when dragged.
- [ ] For a read-only viewer "Add expense" is visibly dimmed and does nothing;
      the other six rows still work.
- [ ] With `prefers-reduced-motion: reduce` the panel appears with no slide.
- [ ] Every colour in the panel resolves from `tokens.css`, and no row renders a
      category colour or `--accent`.

## Resolved
- **Home only** (2026-08-07). The brief places the menu button beside screen
  01's Add button; every other screen owns its BackButton, and a drawer
  reachable from a sub-screen would put two different "go somewhere else"
  gestures on the same surface. If the menu is later wanted app-wide, that is a
  decision with its own units, not an implementation detail of this one.
- **"Add expense" stays in the list** even though screen 01 has both the yellow
  Add button and MainButton. It was in the six the brief said to keep, and the
  three-entrances-one-action arrangement was already accepted in
  `../screens/01-home.md`'s Telegram section.

## Open questions
- ~~[?] **Panel header.**~~ — **answered by the reference (2026-08-07)**: the
      drawer has an identity band, so ours does too, carrying account name and
      currency instead of avatar and balance. See Anatomy.
- ~~[?] Every geometric value until the refs exist.~~ — **answered
      (2026-08-07)**: both images are saved under `../refs/side-menu/` and the
      measurements are in Anatomy. What stays `[inferred]` is the 48px row
      height (raised from the reference's ~39px for the touch floor), the
      Settings gap and the panel's right-corner radius.
- [?] **Icons on the rows.** The reference has one per row; this spec has none,
      on the design system's no-icon-set rule. If they turn out to be missed,
      the cost is seven new glyphs and the icon-consolidation review that
      `design-system.md` describes — a decision, not a tweak.
- [?] **Swipe to open / close.** The brief says the button opens it. A
      left-edge swipe-to-open gesture would conflict with Telegram's own
      horizontal swipes in a webview, so it is **not** specified here; a
      swipe-left-to-close on the panel itself is safe but unspecified.
