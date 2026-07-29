/** Donut segment geometry — pure, no DOM. Produces the `stroke-dasharray`/
 * `stroke-dashoffset` inputs for one SVG circle per segment. Categories
 * beyond `maxSlots` are folded into a trailing "Other" segment (design doc
 * §6: "never generate a seventh hue") rather than dropped, so the shares
 * still sum to the whole circle.
 */

export interface CategoryTotal {
  id: string;
  label: string;
  minor: number;
}

export interface DonutOptions {
  circumference: number;
  gap?: number;
  maxSlots?: number;
}

export interface DonutSegment {
  dash: number;
  gap: number;
  offset: number;
  slot: number;
}

const DEFAULT_GAP = 2;
const DEFAULT_MAX_SLOTS = 6;

export function segments(totals: CategoryTotal[], opts: DonutOptions): DonutSegment[] {
  const gap = opts.gap ?? DEFAULT_GAP;
  const maxSlots = opts.maxSlots ?? DEFAULT_MAX_SLOTS;

  if (totals.length === 0) {
    return [];
  }

  const folded =
    totals.length > maxSlots
      ? [
          ...totals.slice(0, maxSlots),
          {
            id: "__other__",
            label: "Other",
            minor: totals.slice(maxSlots).reduce((sum, t) => sum + t.minor, 0),
          },
        ]
      : totals;

  const grandTotal = folded.reduce((sum, t) => sum + t.minor, 0);
  const n = folded.length;
  const available = opts.circumference - gap * n;

  let offset = 0;
  return folded.map((total, slot) => {
    const dash = grandTotal > 0 ? (total.minor / grandTotal) * available : 0;
    const segment: DonutSegment = { dash, gap, offset, slot };
    offset += dash + gap;
    return segment;
  });
}
