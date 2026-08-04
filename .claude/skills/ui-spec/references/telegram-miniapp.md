# Telegram Mini App constraints

Read before writing any Mini App spec. Design copied from a normal mobile app
does not transfer directly — these are the things that break.

## Theming
Colours come from Telegram's `themeParams` and the matching CSS variables, not
from a fixed palette. In this repo `src/lib/telegram.ts::applyTheme()`
overwrites the custom properties in `tokens.css` at runtime from Telegram's
`colorScheme`, and sets `data-theme`.

The spec must map **every** colour token to either a Telegram param or an
explicit project colour, and state what both light and dark look like.
Hardcoding light-theme colours is the single most common failure. A token with
one value is an unfinished token.

Note which colours deliberately do **not** follow the theme — in this project
the category palette is fixed per slot and never cycled, and status red is
reserved for over-budget.

## Native chrome — MainButton and BackButton
The client provides both. A custom primary button pinned to the bottom of the
screen **conflicts** with `MainButton`: two primary actions, one of them
covered. Decide per screen which is used and write it down.

- `MainButton` — the screen's primary action. Its label should restate what
  will happen (`Add €38.40 to Groceries`), and its disabled rule is part of the
  spec, not an implementation detail.
- `BackButton` — always wired; hidden only at the root. Where it goes is
  per-screen, and whether it confirms before discarding a dirty draft is a
  separate decision that must be written.

Confirmations use Telegram's own popup, not a custom modal.

## Viewport
Height is dynamic. It changes when the keyboard opens, and there is an expanded
vs collapsed state. Any "full height", "stick to bottom", or "fill remaining
space" instruction must say how it behaves when the viewport shrinks —
otherwise the keyboard covers the field being typed into.

## Safe areas
iOS has a bottom inset. Every fixed bottom element accounts for it explicitly
(`env(safe-area-inset-bottom)`); "fixed to the bottom" alone is under-specified
and lands under the home indicator.

## Navigation
There is no browser history. Back behaviour is explicit per screen — write it
down, including what happens on the root screen.

## Haptics
Available and cheap. If the reference app uses tactile feedback, note where:
selection on tap, success after a write, error on a failed one.

## Closing confirmation
`enableClosingConfirmation()` exists. Worth specifying on any screen holding an
unsaved draft.

## Completion gate
A Mini App screen spec is **not finished** until it answers:
1. which theme variables each colour maps to, and what dark looks like;
2. `MainButton` or a custom button;
3. what BackButton does from this screen.

Do not report a spec as done with any of the three unanswered. If the user has
not decided, they go in `## Open questions` as `[?]` and are named explicitly
in the chat report.
