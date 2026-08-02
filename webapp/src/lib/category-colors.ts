/** Client-side category -> colour assignment (D206). There is no
 * `categories.color` column until screen 06 (deferred, D204), so colour is
 * derived from the category's position in the account's list sorted by
 * `created_at ASC`, in the fixed six-slot palette from tokens.css, never
 * cycled. A category keeps its slot across renders; it only shifts if an
 * earlier category is deleted (accepted cost, documented in the plan's
 * Risks). Categories past the sixth get `slot: null` — "Other" everywhere
 * they're shown, same rule `lib/donut.ts::segments()` applies to its tail.
 */

export interface CategoryColor {
  id: string;
  slot: number | null;
}

const DEFAULT_MAX_SLOTS = 6;

export function assignCategoryColors(
  categories: { id: string; created_at: string }[],
  maxSlots = DEFAULT_MAX_SLOTS,
): CategoryColor[] {
  const sorted = [...categories].sort((a, b) => a.created_at.localeCompare(b.created_at));
  return sorted.map((category, index) => ({
    id: category.id,
    slot: index < maxSlots ? index + 1 : null,
  }));
}

/** The neutral colour for a category past the fixed slot count — distinct
 * from every real category slot so it never collides with one. */
export const OTHER_COLOR_VAR = "var(--ink-secondary)";

export function categorySlotCssVar(slot: number | null): string {
  return slot === null ? OTHER_COLOR_VAR : `var(--category-slot-${slot})`;
}
