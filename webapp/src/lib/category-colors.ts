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
