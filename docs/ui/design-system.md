# Design system

Canonical values for the Mini App. `webapp/src/styles/tokens.css` implements the
colour table, `webapp/src/lib/telegram.ts` resolves it per theme, and
`webapp/src/styles/app.css` implements the rest. **When a value here changes,
that CSS changes in the same commit.**

Rationale for these choices lives in `docs/design/mini-app-ux.md` §2 —
this file is the implementable form of it. Everything below is `[ref]` unless
marked otherwise: the source is the shipped V2 code, not a screenshot.

Governing rule (mini-app-ux §2.1): **colour belongs to data.** Chrome is ink.
The only saturated colour on any screen is a spending category.

## Colour

Telegram's `themeParams` values are **deliberately not consumed**. `colorScheme`
selects which of the two fixed sets applies; nothing else is read from the
client. This is intentional — the ink chrome is where the app asserts an
identity (§2.3) — and it is why every token below has both values stated.

| Token | Light | Dark | Usage | Source |
|---|---|---|---|---|
| `--app-background` | `#EDF0EF` | `#101415` | Grouped-list ground | [ref] |
| `--card` | `#FFFFFF` | `#1C2123` | Every content surface | [ref] |
| `--ink` | `#0E1416` | `#F1F5F4` | Text, buttons, chrome | [ref] |
| `--ink-secondary` | `#6C7679` | `#97A1A3` | Meta, labels | [ref] |
| `--separator` | `#E4E8E7` | `#272D2F` | Row rules | [ref] |
| `--status-red` | `#e34948` | `#e66767` | Over-budget only | [ref] |
| `--accent` | `#F0B429` | `#E0A42B` | **The Add button on screen 01, and nothing else** | [inferred] |
| `--accent-ink` | `#1A1206` | `#1A1206` | The `+` glyph inside it | [inferred] |

### `--accent` — the one declared exception to "chrome is ink"

The Add button on screen 01 is yellow (`docs/ui/refs/01-home/day-tab.jpg`,
2026-08-04, HUMAN). That is a deliberate, **named and bounded** exception to the
governing rule, not a loosening of it:

- `--accent` may be used by **exactly one element in the app** — that button.
  Any other use is a review failure. It is not a general-purpose highlight
  colour, and "chrome is ink" is otherwise unamended.
- Its hex is deliberately distinct from `--category-slot-4` (`#eda100`) so a
  yellow category slice can never be mistaken for the button, and the button
  never reads as data. `[inferred]` — the two are close; if they prove
  confusable side by side in the donut, move slot 4, not the accent.
- The button carries a `+` glyph, so it survives greyscale exactly like the
  over-budget marker does.
- It sits **inside the chart card** and scrolls with it. It is never
  `position: fixed` — see screen 01's Telegram section for why that constraint
  is what lets it coexist with MainButton.

### Category palette

Colourblind-safe, assigned by **slot index**, and a category keeps its colour for
life. The slot comes from `categories.color_slot` (D301/D308); a `NULL` slot
falls back to position in the account's list sorted `created_at ASC` (D206's
rule, surviving only as the fallback).

**The user picks the slot** on screen 06 — that is why the palette is twelve
wide rather than six. Slots 1–6 are the shipped set and must not move; 7–12 are
new.

| Slot | Name | Light | Dark | Source |
|---|---|---|---|---|
| `--category-slot-1` | Blue | `#2a78d6` | `#3987e5` | [ref] |
| `--category-slot-2` | Orange | `#eb6834` | `#d95926` | [ref] |
| `--category-slot-3` | Aqua | `#1baf7a` | `#199e70` | [ref] |
| `--category-slot-4` | Yellow | `#eda100` | `#c98500` | [ref] |
| `--category-slot-5` | Pink | `#e87ba4` | `#d55181` | [ref] |
| `--category-slot-6` | Green | `#008300` | `#008300` | [ref] |
| `--category-slot-7` | Teal | `#0072a1` | `#0087ac` | [validated] |
| `--category-slot-8` | Violet | `#894ed6` | `#8f54dc` | [validated] |
| `--category-slot-9` | Olive | `#716400` | `#827200` | [validated] |
| `--category-slot-10` | Cyan | `#00a59f` | `#00a59f` | [validated] |
| `--category-slot-11` | Moss | `#739800` | `#6b8f00` | [validated] |
| `--category-slot-12` | Magenta | `#ab37ab` | `#b542b5` | [validated] |

Name is what the colour picker (screen 06b) shows and speaks for each swatch
— a plain English colour word, not a brand name. `[inferred]` (2026-08-05,
confirmed by the user for U2.2 prep) for slots 1–6 (never named before this)
and 7–12 alike.

Rules that survive the palette growing:

- **Two categories may share a slot.** Once the user picks, collisions are
  their choice, not a bug. The picker marks an already-used slot as taken but
  does not forbid it (screen 06). This is exactly why identity is never carried
  by colour alone — every surface pairs the colour with the name.
- `--status-red` is reserved for over-budget and is **never** a category slot.
  It always ships with an icon and a word, so the state survives greyscale and
  colourblind readers.
- More than **six** categories in one donut: fold the tail into "Other" and keep
  the full list in the ranked rows below. The donut's six-slice fold limit is
  about readability of the chart and is unrelated to the twelve-slot palette.
- Never generate a hue. Twelve is the closed set.

**Validated (2026-08-05, U2.2 prep).** Slots 7–12 were re-picked and run through
`dataviz`'s `validate_palette.js` against the app's real card surfaces
(`#FFFFFF` light / `#1C2123` dark): all 12 slots pass lightness band, chroma
floor, adjacent-pair CVD separation (≥8 target) and the normal-vision floor
(≥15) in both modes; light-mode slots 3–5 keep their pre-existing sub-3:1
contrast relief (mitigated by the mandatory colour+name pairing below), slots
7–12 all clear 3:1. The original by-eye slots 7–12 failed validation (a
chroma-floor fail and a normal-vision-floor fail in light, plus a lightness-
band, chroma-floor and CVD fail in dark) and were replaced outright, not
tuned. Known limitation: the check is *adjacent-slot-order* only, matching how
1–6 were validated — it does not cover every non-adjacent pair (e.g. slots 9
and 11 are both olive-family, distinguished mainly by lightness), which is
why colour is never the only identity channel (see below).

## Spacing

Base unit **2px**. Closed set actually in use — pick from it, do not invent:

`2 · 4 · 6 · 8 · 9 · 10 · 12 · 13 · 14 · 16` px, plus `96px` bottom padding on
the app shell to clear `MainButton`.

Common pairings: card padding `14px 12px`, row padding `10px 13px`, chip padding
`9px 14px`, card gap `12px`, inline gap `8px`.

`[inferred]` — this is denser than an 8pt grid and 9/13 exist only because chips
and rows were tuned by eye. New work should prefer `4 · 8 · 12 · 16` and reach
for the odd values only to match an existing component.

The reference is looser than the shipped screens: it breathes at roughly `20 ·
24 · 28` between sections where V2 uses `12 · 14` `[ref]`. The scale therefore
extends to:

`2 · 4 · 6 · 8 · 9 · 10 · 12 · 13 · 14 · 16 · 20 · 24 · 28 · 32` px

Still closed. `20+` is for **between sections** (the gap under the donut card,
the gap between the category grid and the date row); inside a component the
existing dense values stand.

## Sizing

Component dimensions, kept separate from spacing so an implementer never reaches
into the spacing scale for a diameter. All `[ref]` values are measured off the
reference screenshots at ~0.73 image-px-to-CSS-px and are approximate.

| Element | Size | Source |
|---|---|---|
| Add button (screen 01) | 56px diameter, `+` glyph 24px, 2.5px stroke | `~60px [ref]` → snapped [inferred] |
| Category swatch, picker grid (02) | 64px diameter | `~68px [ref]` |
| Category swatch, ranked row (01) | 36px diameter | `~37px [ref]` |
| Donut outer diameter | 200px | `~234px [ref]`, kept at V2's value — see below |
| Donut stroke | 30px | `~45px [ref]` → thickened from V2's 26px [inferred] |
| Period tab row | 44px tall | `~44px [ref]` |
| Period arrow hit target | 44 × 44px | [inferred] — minimum touch target |
| Date shortcut pill (02) | 88 × 44px | `~88 × 45px [ref]` |
| Tag chip (02) | 32px tall | `~32px [ref]` |
| Bottom nav tile (01) | 32px tall, text only | [inferred] — see screen 01 |
| Date-range picker cell | 40 × 40px, 6-row grid | `docs/ui/components/date-range-picker.md` |
| Date-range picker quick chip | 32px tall, 8px radius | reuses Tag chip's values |
| Date-range picker sheet | max 85% `viewportStableHeight`, 16px padding | `docs/ui/components/date-range-picker.md` |
| Date-range picker footer button | 44px tall | reuses Period tab row's value |

The donut **does not grow to the reference's size**. The reference has no bottom
navigation and no over-budget strip competing for the fold; this app does. Its
stroke thickens to 30px to pick up the reference's weight without the diameter.
`[inferred]` — the single most likely value to want correcting after seeing it
on a real device.

## Typography

System UI stack throughout — whatever Telegram renders in. No webfont.

| Role | Size | Weight | Tracking | Line height |
|---|---|---|---|---|
| Donut centre amount | 34px | 700 | −0.035em | 1 |
| Amount input (screen 02) | 34px | 600 | −0.03em | 1 |
| Hero amount | 28px | 700 | −0.035em | 1 |
| Period tab | 14px | 400 inactive / 600 active | — | 1 |
| Period label (`Today, August 4`) | 15px | 500 | — | 1 |
| Sheet title (date-range picker) | 17px | 600 | — | default |
| Sheet section heading (date-range picker month name, footer buttons) | 15px | 600 | — | default |
| Body / title | 14px | 400–600 | — | default |
| Row title | 13.5px | 600 | −0.01em | default |
| Meta / secondary | 12–12.5px | 400–600 | — | default |
| Caption | 11–11.5px | 400 | — | default |
| Avatar initial | 10.5px | 700 | — | default |
| Section eyebrow | 10px | 600 | 0.11em, uppercase | default |

Amounts use **tabular numerals** at 700 / −0.035em so columns line up and
decimals do not dance. The section eyebrow is the only mono in the app.

## Radii, borders, shadows

| Element | Radius |
|---|---|
| Card | 14px |
| Field, button | 12px |
| Chip | 9px |
| Date shortcut pill, tag chip | 8px |
| Pill | 999px |
| Avatar, dot, category swatch, FAB | 50% |

Borders: 1px in `--separator`. **No shadows** — surfaces are separated by
background contrast and rules, not elevation.

Donut segments carry a 2px gap so adjacent colours never touch. Bar fills are
rounded on the data end only and anchored to the baseline.

## Iconography

**Resolved (2026-08-04, HUMAN): there is no icon set, and categories have no
icons.** The reference identifies a category with a circular glyph
(`docs/ui/refs/02-add-expense/filled.jpg`); this app identifies it with a **plain
filled circle in the category's chosen slot colour, plus the name**, always
together. No glyph, no letter, no emoji.

What this buys: no `categories.icon` column, no icon-picker UI, no ~30 glyphs to
choose, and no new runtime dependency (webapp/CLAUDE.md). What replaces the
expressiveness the reference gets from glyphs is **user-chosen colour** — the
twelve-slot palette above and the picker on screen 06.

Consequence for the layout: a swatch with no glyph reads as decoration unless it
is close to its name, so the category grid keeps the reference's
circle-above-name arrangement and never separates the two.

The handful of non-category icons the app genuinely needs are drawn as **inline
SVG in the module that uses them**, 24px box, 2px stroke, `currentColor`:

| Icon | Where | Shape |
|---|---|---|
| `+` | Add button (01), Add tag (02), More (02) | two 2.5px strokes, 24px box |
| `‹` `›` | Period arrows (01, 05) | chevron, 2px stroke, 20px box |
| Calendar | Date row (02), Period tab (01) | rounded square + two ticks |
| Warning | Over-budget strip | triangle + bar + dot, in `--status-red` |

No icon file, no sprite sheet, no library. If this list passes about eight
entries, revisit — that is the point at which an in-repo set earns its keep.

## Motion

| Transition | Duration | Easing |
|---|---|---|
| Skeleton pulse | 1.4s, infinite | `ease-in-out`, opacity 1 → 0.6 → 1 |

`prefers-reduced-motion: reduce` disables the skeleton pulse. Any new animation
must sit inside the same `@media (prefers-reduced-motion: no-preference)` guard.

## Accessibility

- Identity is **never** carried by colour alone — always a dot plus a name.
- Visible focus states on every interactive element.
- Over-budget always ships icon + word alongside `--status-red`.

## Open questions

- ~~[?] **Iconography**~~ — **answered (2026-08-04, HUMAN)**: no icon set, no
  category icons; identity is a colour circle plus a name, and the user picks
  the colour. See Iconography above.
- ~~[?] **Category slots 7–12 unvalidated.**~~ — **answered (2026-08-05, U2.2
  prep)**: re-picked and run through the dataviz validator against the app's
  real surfaces; all 12 slots pass in both modes. See Category palette above.
- [?] **Accent vs slot 4.** `--accent` `#F0B429` and `--category-slot-4`
  `#eda100` are close. If the Add button reads as a data colour where it
  overlaps a yellow donut slice, move slot 4 — never the accent. Only judgeable
  on a real device.
- [?] **Safe-area insets — partially resolved for screen 01 (U1.6, D331).**
  The bottom nav row is `position: fixed; bottom: 96px` (docked above the
  flat `96px` MainButton reserve, not inside it) with its own
  `padding-bottom: calc(8px + env(safe-area-inset-bottom, 0px))`; `#app`'s
  own bottom padding also now references `env(safe-area-inset-bottom, 0px)`.
  Verified only against a headless-Chrome mobile-viewport emulation this
  session, where `env()` resolves to `0px` — **still unverified on an actual
  iOS device with a non-zero inset**, and still unverified against a real
  Telegram client's actual MainButton (whether `96px` is the right reserve at
  all is an inherited assumption, not something this unit could confirm).
  Any other fixed-position element added later should follow the same
  pattern rather than reopening this from scratch.
- [?] **Focus states.** Required by webapp/CLAUDE.md but not defined here — no
  focus ring token exists. Needs a colour and width that work on both themes.
