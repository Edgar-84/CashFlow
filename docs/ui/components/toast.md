# Component: Toast

## Purpose
A short, self-dismissing message that tells the user something happened as a
**consequence** of what they just did, without interrupting them. V6 introduces
it for exactly one job: a budget that has reached or crossed its notify
threshold because of the expense the user has just saved
(`../screens/01-home.md`, `docs/plans/mini-app-v6.md` D607/D608/D609).

> "If the user is inside the mini-app (which is the primary usage mode, not the
> regular bot chat), we should also surface this as an in-app popup/toast
> notification that can be dismissed immediately." (HUMAN, 2026-08-11)

It is **not** a notification centre, not a queue, and not a confirmation. Its
one trigger is listed under Inputs → Triggers; adding a second is a decision,
not a follow-up.

## Reference
- No screenshot. Verbal brief from the user, 2026-08-11.
- The shape is the standard mobile snackbar: an inverted surface, one line or
  two, anchored to the bottom, gone on its own. `[inferred]`
- Existing in-repo precedent for the *copy*: `../screens/01-home.md`'s
  `alert.over` / `alert.warn` — the toast never composes its own sentence, so the
  strip and the toast cannot disagree about the same budget.

## Delta from reference
- **Taking:** the snackbar idea — bottom-anchored, transient, inverted surface,
  one tap to dismiss.
- **Changing:** no action button ("Undo", "View"). This app has no undo, and a
  "View budgets" affordance would make a transient element the entry point to a
  screen the side menu already owns. Dismissal is the only interaction.
- **Explicitly not taking:** stacking multiple toasts, a queue, swipe-to-dismiss
  (Telegram clients use horizontal swipe themselves — competing with it is how a
  gesture gets eaten), progress/countdown indicators, and any icon vocabulary
  beyond the warning glyph the design system already declares.

## Anatomy
In render order:

1. **Root** — `position: fixed`, bottom-anchored (see Sizing), `--ink`
   background, `--card` text, 12px radius, **no shadow** (design-system: "no
   shadows — surfaces are separated by background contrast"). The inverted pair
   is what separates it from whatever it floats over, including a white card.
2. **Warning glyph** — the design system's warning icon at 16px `[inferred]`,
   `currentColor` (so it inverts with the surface), `aria-hidden`.
3. **Message** — one pre-composed string, 14px / 400 (Body role), `--card`,
   wrapping to at most **three lines** then ellipsis `[inferred]`. The component
   never formats money, a percentage or a category name — it receives a finished
   sentence.

There is no close button: the whole toast is the dismiss target, which keeps one
44px-tall element from having to hold a second 44px control.

## Variants

| Variant | When used | What differs |
|---|---|---|
| `warning` | the only variant V6 ships — a budget at or over its threshold | As Anatomy above |

A second variant (`success`, `error`) is deliberately **not** specified. Success
after a write is already a haptic (`notificationOccurred('success')`) plus a
navigation, and errors are rendered in-screen with a retry, never thrown away
after five seconds.

## States

| State | Trigger | What the user sees |
|---|---|---|
| Default | shown | The toast, fully opaque, over the page |
| Entering | on show | Slides up from its own height + fades in, 200ms `ease-out` (design-system's bottom-sheet curve) |
| Pressed | finger down | 0.7 opacity, the same press feedback the picker's swatches use |
| Leaving | tap, or the dwell elapsing | Fades out over 160ms `ease-in`, then the node is removed |
| Replaced | a second toast is shown while one is up | The first is removed **immediately, without its leave animation**, and the second enters normally — never two at once, never a queue |
| Disabled | n/a | A toast is not interactive except to dismiss; there is no disabled form |
| Loading | n/a | A toast never waits for data — its host has the data before it shows one |
| Error | n/a | A toast never reports its own failure |

## Copy
The component renders **no string of its own** — `message` arrives composed. The
two strings V6 passes it are `../screens/01-home.md`'s, verbatim:

| Key | String | Notes |
|---|---|---|
| (host) `alert.over` | "{Category} is over budget by {amount} {currency}" | from screen 01's Copy table; the toast adds nothing to it |
| (host) `alert.warn` | "{Category} is at {pct}% — {spent} of {limit} {currency}" | same |

One sentence, two places, one source. If the toast ever needs its own wording,
that wording goes in the host screen's Copy table, not here.

## Sizing and spacing
Design-system values only:

| Property | Value | Source |
|---|---|---|
| Width | `calc(100% - 24px)`, centred (12px inset each side) | [inferred] — 12px is the app's card inset |
| Min height | 44px | [inferred] — the touch-target floor, since the whole toast is the target |
| Padding | `12px 14px` | design-system spacing pairings |
| Radius | 12px | design-system Radii ("Field, button") — not the 14px card radius: this is not a card |
| Bottom anchor | `calc(16px + env(safe-area-inset-bottom))` | [inferred] — see Open questions; iOS inset is mandatory (Telegram constraints) |
| Gap, glyph → text | 8px | design-system inline gap |
| Dwell before auto-dismiss | 5s | [inferred] — long enough for a two-number sentence, short enough not to sit in the way |
| Enter / leave | 200ms `ease-out` / 160ms `ease-in` | design-system Motion (bottom sheet in, side menu out) |

**Theme:** `--ink` and `--card` are both two-value tokens, so the toast inverts
correctly in dark without a rule of its own: near-black-on-white in light,
light-on-dark-card in dark. No new colour token is introduced, and no Telegram
`themeParams` value is read (design-system Colour: `colorScheme` selects the set,
nothing else is consumed).

## Telegram
- **MainButton:** **untouched.** The toast never shows, hides, enables or
  relabels it. Whatever screen is underneath keeps its own primary action — a
  transient message must not change what the primary button does.
- **BackButton:** **untouched.** The toast is not a dismissible *screen*: Back
  from Home with a toast up does what Home's BackButton always does. This is the
  line between a toast and the sheets in `date-range-picker.md` /
  `color-picker.md`, which do own BackButton while open.
- **Not a Telegram popup.** `showPopup`/`showAlert` are reserved for
  confirmations the user must answer (the delete flows). Reusing that idiom for
  an unsolicited notification would train the user to dismiss confirmations
  without reading them.
- **Haptics:** none of its own. The write that triggered it already fires
  `notificationOccurred('success')`, and two feedbacks for one event is noise.
- **Viewport:** bottom-anchored against `env(safe-area-inset-bottom)`; it never
  participates in page scroll, and it must never overlap MainButton or screen
  01's yellow Add button (see Open questions — the one geometry this spec cannot
  settle without a device).

## Accessibility
- Root is `role="status"` with `aria-live="polite"`: it announces itself once,
  after the screen it appears over has rendered, and never interrupts.
- **Not focusable and never focus-trapping.** Focus stays where the user left
  it; nothing is stolen and nothing has to be restored.
- The message carries the whole meaning in text — the glyph is `aria-hidden` and
  colour carries nothing. Removing the glyph would lose nothing for a screen
  reader and the greyscale case, which is why the word matters more than the
  icon here.
- Because it is not focusable, keyboard users cannot dismiss it; the 5s dwell is
  what guarantees it goes away. That is the reason the dwell is not optional in
  the `warning` variant.
- `prefers-reduced-motion: reduce`: it appears and disappears **instantly** at
  full opacity — a state change, not an animation (design-system Motion's
  standing rule).

## Inputs
Pure render + thin DOM glue. No fetching, no state, no timers owned by the
caller.

```ts
interface ToastProps {
  /** Pre-composed line. The component never formats money or a percentage. */
  message: string;
  kind: "warning";
  /** ms before auto-dismiss; `null` never auto-dismisses. Default 5000. */
  autoDismissMs?: number | null;
}

function renderToast(props: ToastProps): string;
/** Appends its own root to `host`, wires tap-to-dismiss and the dwell timer.
 *  Returns a dismiss function; calling it twice, or after the toast has already
 *  gone, is a no-op. */
function showToast(host: HTMLElement, props: ToastProps): () => void;
```

### Triggers (the closed list)
1. **An expense the user just saved** (screen 02 create or 02b edit) whose
   category is at or over its budget's `notify_threshold`, shown on the return
   leg to Home. The message is the same line screen 01's strip shows for that
   category.

Everything else is out of scope by decision: a partner's expense crossing a
threshold (no push channel exists — `webapp/CLAUDE.md`), a threshold crossed by
*editing a budget* rather than spending, and any "you're on track" positive
message. The bot's chat notification continues unchanged and is not replaced by
this (D608).

## Acceptance criteria
- [ ] Saving an expense that puts its category at 82% of a 70%-threshold budget
      lands on Home and shows one toast reading exactly what Home's strip reads
      for that category.
- [ ] The toast sits at the bottom of the screen, 12px in from each side, and
      covers neither MainButton nor the yellow Add button.
- [ ] Its background is `--ink` and its text `--card` — dark-on-light in light
      theme, light-on-dark in dark theme — with no shadow and a 12px radius.
- [ ] Tapping it removes it immediately.
- [ ] Left alone, it removes itself after 5 seconds.
- [ ] It never appears twice at once: triggering a second toast replaces the
      first rather than stacking.
- [ ] With the toast up, Telegram's BackButton and MainButton behave exactly as
      they do without it, and the page underneath still scrolls.
- [ ] A screen reader announces the message once, politely, and focus does not
      move when the toast appears or disappears.
- [ ] With `prefers-reduced-motion: reduce` it appears and disappears with no
      slide or fade.
- [ ] Saving an expense in a category with no budget, or one below its
      threshold, shows no toast at all.

## Open questions
- [?] **The bottom anchor, and whether 16px is enough.** The app shell reserves
      `96px` of bottom padding "to clear MainButton", which implies the client
      can draw MainButton over the bottom of the viewport. If it does, a toast at
      `16px` is underneath it. The fallback is to anchor at
      `calc(96px + env(safe-area-inset-bottom))` on any screen where MainButton
      is shown — but that then floats oddly high on a screen where it is hidden.
      **This is the CP2 check** in `docs/plans/mini-app-v6.md`; measure before
      choosing.
- [?] **5 seconds.** `[inferred]`. A three-number sentence in a second language
      may want 6–7s; a user who reads it in one glance may want 3s.
- [?] **Getting both a toast and a Telegram chat message for the same expense.**
      Intended (D608): the toast tells whoever is in the app, the chat message
      tells whoever is not. If it reads as duplication rather than redundancy,
      the change is to the *bot's* behaviour and belongs in its own plan — not in
      this component.
- [?] **Whether an over-budget toast should differ from an approaching one.**
      V6 ships one `warning` variant for both, distinguished only by the
      sentence. A red-tinted variant for exceeded is possible, but `--status-red`
      on an inverted surface is a new colour pair, and the strip already carries
      that distinction two lines below.
