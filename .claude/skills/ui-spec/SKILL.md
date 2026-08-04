---
name: ui-spec
description: Turns visual references (screenshots, reference apps, verbal descriptions) into written UI specs under docs/ui/ that later skills implement from. Use whenever the user describes a screen, a component, a layout, or any frontend appearance or interaction — pastes a screenshot and says "make it like this", asks "what colours should we use", asks for a design system, or starts any Telegram Mini App UI work. Run BEFORE task-methodology on frontend work: task-methodology decomposes the spec files, never the raw screenshots.
---

# UI spec protocol (CashFlow)

A screenshot lives only in the session it was pasted into. The unit implemented
an hour later cannot see it and will invent values — different values each unit,
so the UI drifts. This skill converts references + spoken intent into versioned
markdown under `docs/ui/`. From that point the spec, not the screenshot, is the
source of truth.

```
screenshots + intent → ui-spec → docs/ui/*.md (user corrects) →
task-methodology → units → /unit → code
```

Templates: `references/templates.md` — copy them verbatim, headings included.
Mini App target: read `references/telegram-miniapp.md` BEFORE writing the file.

## Output layout
```
docs/ui/design-system.md          canonical tokens; webapp/src/styles/tokens.css tracks it
docs/ui/screens/<nn>-<name>.md    numbered as in docs/design/mini-app-ux.md §3
docs/ui/components/<name>.md      reusable pieces
docs/ui/refs/<screen-name>/*.png  committed reference images
```
Screen numbering and naming follow the UX brief's inventory (`01-home`,
`03-expenses`, …) so a spec, its screen module in `webapp/src/screens/`, and
its plan unit are all obviously the same thing.

`docs/design/mini-app-ux.md` is the **why** — principles, flows, backend
deltas, screen→unit map. `docs/ui/` is the **what to build**. A value that an
implementer types into CSS belongs here, not there.

## Step 0 — Identify the mode
- **`system`** — establishing or updating the project-wide design language.
  → `docs/ui/design-system.md`. Written once, extended as patterns appear.
- **`screen`** — one screen. → `docs/ui/screens/<nn>-<name>.md`.
- **`component`** — one reusable component. → `docs/ui/components/<name>.md`.

If frontend work is starting and `docs/ui/design-system.md` does not exist, do
`system` first and say so. A screen spec that references undefined tokens is
not implementable.

## Step 1 — Read what already exists
Before writing anything, read `docs/ui/design-system.md` and every sibling spec
in the folder you are about to write into. Reuse existing tokens and components;
never introduce a parallel name for a value that already has one.

If the screen needs something the design system does not cover, **extend the
design system in the same pass** — do not hardcode a one-off. A hex literal in
a screen spec is a bug in the spec.

Also worth reading when they bear on the spec: `docs/design/mini-app-ux.md`
(intent and states), `webapp/CLAUDE.md` (ironclad rules), and the actual
`webapp/src/styles/` when specifying something that already partly exists.

## Step 2 — Extract from the references
For each reference, extract observable facts: layout structure, spacing rhythm,
type sizes and weights, colours, corner radii, iconography style, control
placement, what is fixed vs what scrolls.

**Mark every value with provenance.** This is the most important rule in the
skill: it makes the user's review fast, and it stops guessed numbers from
silently hardening into requirements.

| Marker | Meaning |
|---|---|
| `[ref]` | directly observable in the provided reference |
| `[inferred]` | derived by reasoning — spacing snapped to the scale, a colour role deduced from usage |
| `[?]` | unknown; the user must decide |

Values read off a screenshot are approximate. Write `~16px [ref]`, never a bare
`16px`, unless the user gave an exact figure or it was read out of the repo.

Save the reference images to `docs/ui/refs/<screen-name>/` and link them from
the spec's `## Reference` section by relative path. An unsaved screenshot makes
the spec unreviewable six weeks later.

## Step 3 — Capture the delta explicitly
Nobody wants a copy; they want "like this, but…". Record all three halves in the
`## Delta from reference` section:
- **Taking** — what carries over
- **Changing** — what differs, and to what
- **Explicitly not taking** — brand colours, logo, unrelated features

Omit the third and an implementer will drag the reference app's branding in.

## Step 4 — Ask, in one batch
Collect every open question and ask once, numbered. Do not interrogate turn by
turn. Good candidates: what a tap does, behaviour with no data, behaviour with
very long text, what happens on error, fixed or scrolling.

Only ask what changes the implementation. If it does not, pick a sensible
default, mark it `[inferred]`, and move on.

**Exact copy is always material.** Units quote user-visible strings verbatim,
so "some empty-state text" is not a spec. Either get the string or write one
and mark it `[inferred]` for the user to overwrite.

## Step 5 — Write the file
Use `references/templates.md` verbatim. Consistent headings matter more than
prose quality here: task-methodology reads these files, and predictable
structure is what makes decomposition reliable.

## Step 6 — Report back in chat
Do not bury this in the file. State:
- the file path
- every `[?]` still open
- every `[inferred]` value worth sanity-checking
- anything in the reference deliberately ignored

Then stop. The user reviews and edits the file directly; **corrections in the
file win over anything said in chat.**

## Acceptance criteria — the contract with task-methodology
Each criterion must be checkable by a person looking at the running UI for five
seconds, without asking anyone's opinion. One concrete observable property each.

- Bad: "The card looks clean and modern."
  Good: "Card has 16px internal padding, 12px corner radius, and a 1px border
  in `--separator`."
- Bad: "Handle the empty state nicely."
  Good: "With zero transactions the list area shows the empty illustration
  centred with the caption from the copy table, and the Add button stays
  enabled."
- Bad: "Bottom navigation like the reference."
  Good: "Bottom navigation is fixed, 56px tall, sits above
  `env(safe-area-inset-bottom)`, has 4 evenly distributed items, and the active
  item uses `--accent` for both icon and label."

A criterion that fails the five-second test is a wish. Move it to Purpose.

## Telegram Mini App
Whenever the target is the Mini App — which in this repo is every screen —
read `references/telegram-miniapp.md` first. A Mini App screen spec is **not
finished** until it answers all three:
1. which Telegram theme variables each colour maps to, and what light *and*
   dark look like;
2. `MainButton` or a custom in-screen button — never both competing for the
   bottom of the screen;
3. what BackButton does from this screen.

## Out of scope
- Writes no code and creates no component files.
- Picks no framework and no styling approach.
- Produces no images, mockups, or design assets.

Its only output is markdown (and committed reference images) under `docs/ui/`.
