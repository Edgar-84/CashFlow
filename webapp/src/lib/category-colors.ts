/** Category -> colour assignment. `categories.color_slot` (D301, supersedes
 * D206) is authoritative when set: a category keeps that slot for life,
 * independent of any other category's position or deletion. A `null` (or
 * missing) slot falls back to the D206 position rule — 1-based position in
 * the account's list sorted `created_at ASC` — capped at the shipped six
 * slots, not the full twelve-slot palette (D317's 7-12 range is picker-only,
 * never auto-assigned). This is independent of `lib/donut.ts::segments()`'s
 * six-slice fold, which is about chart readability, not palette size.
 */

export interface CategoryColor {
  id: string;
  slot: number | null;
}

const FALLBACK_MAX_SLOT = 6;

/** Total addressable slots (D500) — the named set (1-12) plus the ramp (13-72). */
export const PALETTE_SLOT_COUNT = 72;

/** The picker's quick row (D504) — design-system.md's named slots 1-7. */
export const QUICK_SLOTS = [1, 2, 3, 4, 5, 6, 7] as const;

export function assignCategoryColors(
  categories: { id: string; created_at: string; color_slot?: number | null }[],
  fallbackMaxSlot = FALLBACK_MAX_SLOT,
): CategoryColor[] {
  const sorted = [...categories].sort((a, b) => a.created_at.localeCompare(b.created_at));
  return sorted.map((category, index) => ({
    id: category.id,
    slot: category.color_slot ?? (index < fallbackMaxSlot ? index + 1 : null),
  }));
}

/** The neutral colour for a category past the fixed slot count — distinct
 * from every real category slot so it never collides with one. */
export const OTHER_COLOR_VAR = "var(--ink-secondary)";

export function categorySlotCssVar(slot: number | null): string {
  return slot === null ? OTHER_COLOR_VAR : `var(--category-slot-${slot})`;
}

/** `design-system.md`'s Category palette `Name` column, 1-indexed (D338,
 * confirmed 2026-08-05) — the word the screen 06b picker shows and speaks
 * for each swatch. Not a CSS token; this array's order must track the design
 * doc's slot order exactly. */
const SLOT_NAMES = [
  "Blue",
  "Orange",
  "Aqua",
  "Yellow",
  "Pink",
  "Green",
  "Teal",
  "Violet",
  "Olive",
  "Cyan",
  "Moss",
  "Magenta",
];

/** `design-system.md`'s ramp (slots 13-72, D500/D501) — ten hue families of
 * six lightness steps each, in the exact order `scripts/gen_palette.py`
 * generates them. Positional naming ("Olive 3"), not a lookup table: the
 * ramp is sixty slots and the family/step math is the whole point. */
const RAMP_FIRST_SLOT = 13;
const RAMP_STEP_COUNT = 6;
const RAMP_FAMILIES = [
  "Olive",
  "Green",
  "Teal",
  "Blue",
  "Violet",
  "Magenta",
  "Red",
  "Orange",
  "Brown",
  "Slate",
];
const RAMP_LAST_SLOT = RAMP_FIRST_SLOT + RAMP_FAMILIES.length * RAMP_STEP_COUNT - 1;

export function categorySlotName(slot: number): string {
  const named = SLOT_NAMES[slot - 1];
  if (named) return named;
  if (slot >= RAMP_FIRST_SLOT && slot <= RAMP_LAST_SLOT) {
    const rampIndex = slot - RAMP_FIRST_SLOT;
    const family = RAMP_FAMILIES[Math.floor(rampIndex / RAMP_STEP_COUNT)];
    const step = (rampIndex % RAMP_STEP_COUNT) + 1;
    return `${family} ${step}`;
  }
  return `Slot ${slot}`;
}
