# Spec templates

Copy verbatim, headings included. task-methodology decomposes these files —
a renamed or missing heading breaks that. Sections that do not apply get
"n/a" plus one line of why, never deletion.

Every value carries provenance: `[ref]` · `[inferred]` · `[?]`.
Screenshot-derived numbers are approximate: `~16px [ref]`.

---

## `docs/ui/design-system.md`

```markdown
# Design system

Canonical values for the Mini App. `webapp/src/styles/tokens.css` implements
the colour table; `webapp/src/styles/app.css` implements the rest. When a value
here changes, that CSS changes in the same commit.

## Colour
Every token maps to a Telegram theme param or is an explicit project colour.
Both themes are stated — a token with only a light value is incomplete.

| Token | Light | Dark | Telegram param | Usage | Source |
|---|---|---|---|---|---|
| `--app-background` | ... | ... | `bg_color` | ... | [ref] |

## Spacing
Base unit and the allowed scale, stated as a **closed set**. Implementers pick
from the scale; they do not invent values.

## Typography
| Role | Size | Weight | Line height | Tracking | Source |

## Radii, borders, shadows

## Iconography
Style, size, stroke weight, source library.

## Motion
Durations and easing for the transitions that actually occur in this app, and
what `prefers-reduced-motion` disables.

## Open questions
- [?] ...
```

---

## `docs/ui/screens/<nn>-<name>.md`

```markdown
# Screen: <nn> — <Name>

## Purpose
One or two sentences. Who opens this and what they do here.

## Reference
What this is based on and where it lives:
- `../refs/<screen-name>/<file>.png` — what it shows
- Live app / URL / "verbal description from the user, <date>"

## Delta from reference
- **Taking:** ...
- **Changing:** ...
- **Explicitly not taking:** ...

## Layout
Top to bottom. Per region: fixed or scrollable, height, padding, alignment.

## Components used
Links to `../components/*.md`. A component that does not exist yet is listed
here as needing its own spec — that is a unit dependency.

## Telegram
- **Theme:** which tokens, and what differs in dark.
- **MainButton:** used or not; if used, its label and disabled rule. If not,
  what occupies the bottom of the screen instead.
- **BackButton:** shown or hidden; where it navigates; whether it confirms
  before discarding.
- **Haptics:** which events fire which feedback.
- **Viewport:** behaviour when the keyboard opens or the viewport collapses.

## States
Five are mandatory in this project (webapp/CLAUDE.md); add screen-specific rows.

| State | Trigger | What the user sees |
|---|---|---|
| Loading | ... | skeleton in the final layout, no reflow |
| Empty | ... | specific to the filter in force |
| Error | ... | what failed + retry, never a status code |
| 403 | ... | read-only surface, not broken buttons |
| Offline | ... | last loaded data + last-synced marker |
| Populated | ... | ... |

## Interactions
Element → action → result. Include navigation targets.

## Copy
Every user-visible string, verbatim. Units quote these directly, so a string
invented at implementation time is a spec bug.

| Key | String | Notes |
|---|---|---|
| `empty.today` | "Nothing today" | names the period in force, never generic |

## Data
Endpoints this screen reads and writes, as in the UX brief's inventory.
**Flag any field this screen needs that the API does not return yet** — that is
a backend unit the screen unit depends on, and it must be visible here.

## Accessibility
Per-screen, beyond the design system's global rules:
- what identity is carried by besides colour (a dot plus a name, always)
- focus order and what has a visible focus state
- what `prefers-reduced-motion` changes on this screen

## Edge cases
Long text, many items, exactly one item, zero items, offline, slow network.

## Acceptance criteria
Checkable by looking at the running UI for five seconds. One observable
property each.
- [ ] ...

## Open questions
- [?] ...
```

---

## `docs/ui/components/<name>.md`

```markdown
# Component: <Name>

## Purpose
What it is for, and where it is used (link the screen specs).

## Reference
- `../refs/<name>/<file>.png` — what it shows

## Delta from reference
- **Taking:** ...
- **Changing:** ...
- **Explicitly not taking:** ...

## Anatomy
The parts, in render order, with their tokens.

## Variants
| Variant | When used | What differs |

## States
| State | Trigger | What the user sees |
|---|---|---|
| Default | ... | ... |
| Pressed | ... | ... |
| Disabled | ... | ... |
| Loading | ... | ... |
| Error | ... | ... |

## Copy
Every user-visible string this component renders, verbatim.

| Key | String | Notes |

## Sizing and spacing
Values from the design system scale only.

## Accessibility
Focus state, hit-target size, what identity is carried by besides colour, and
what `prefers-reduced-motion` changes.

## Inputs
What the render function receives. Types, and what each does to the output.
No fetching, no state — `webapp/src/components/` is pure render functions.

## Acceptance criteria
- [ ] ...

## Open questions
- [?] ...
```
