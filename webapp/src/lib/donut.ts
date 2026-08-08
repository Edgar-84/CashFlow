/** Donut segment geometry — pure, no DOM. Produces the `stroke-dasharray`/
 * `stroke-dashoffset` inputs for one SVG circle per segment. Categories
 * beyond `maxSlots` are folded into a trailing "Other" segment
 * (docs/ui/design-system.md: "never generate a seventh hue") rather than
 * dropped, so the shares
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

/** Shared by `segments()` (donut) and `barSegments()` (collapsed stacked bar,
 * U5.1/D414) so the two geometries can never fold differently — "if the two
 * ever disagree, the bar is wrong" (docs/ui/screens/01-home.md). */
function foldIntoOther(totals: CategoryTotal[], maxSlots: number): CategoryTotal[] {
  if (totals.length <= maxSlots) {
    return totals;
  }
  return [
    ...totals.slice(0, maxSlots),
    {
      id: "__other__",
      label: "Other",
      minor: totals.slice(maxSlots).reduce((sum, t) => sum + t.minor, 0),
    },
  ];
}

export function segments(totals: CategoryTotal[], opts: DonutOptions): DonutSegment[] {
  const gap = opts.gap ?? DEFAULT_GAP;
  const maxSlots = opts.maxSlots ?? DEFAULT_MAX_SLOTS;

  if (totals.length === 0) {
    return [];
  }

  const folded = foldIntoOther(totals, maxSlots);
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

export interface BarSegment {
  widthPct: number;
  slot: number;
}

export interface BarOptions {
  /** Gap between segments, as a percent of the bar's total width — the
   * caller converts its real px gap using the same reference width it uses
   * for `minPct` (home.ts's `BAR_REFERENCE_WIDTH`), since a straight bar,
   * unlike the donut's fixed 200-unit viewBox, has no width of its own to
   * measure gaps in directly. */
  gapPct: number;
  /** Minimum segment width, as a percent of the bar's total width — how
   * design-system.md's "3px minimum segment" is expressed once there is no
   * real rendered width to clamp against yet (pure render, no DOM layout). */
  minPct: number;
  maxSlots?: number;
}

/** Stacked-bar geometry for the collapsed chart header (D414/U5.1) — the
 * linear counterpart to `segments()`. Widths are percentages of the bar
 * summing to at most 100 (`available`, after reserving room for the
 * inter-segment gaps): proportional to amount, any non-zero segment below
 * `minPct` clamped up to it, with the resulting surplus taken off the
 * largest segment(s) — largest first, moving to the next-largest only if the
 * biggest alone can't absorb it all without going below its own floor —
 * never spread evenly across every segment regardless of size, and never
 * pushing the total past `available` (docs/ui/screens/01-home.md's
 * "Mechanics" and Edge cases sections: "the surplus comes off the largest
 * segment"). A zero-amount category (still present so colour slots stay
 * stable, mirroring `segments()`) stays at exactly 0, never clamped up —
 * only a real, non-zero sliver gets the floor. If every segment's own
 * `minPct` floor together would already exceed `available` (more segments
 * than the bar can give a floor to), the total unavoidably exceeds
 * `available` — a contradiction in the caller's own `minPct`/segment count,
 * not something this function can resolve. */
export function barSegments(totals: CategoryTotal[], opts: BarOptions): BarSegment[] {
  const maxSlots = opts.maxSlots ?? DEFAULT_MAX_SLOTS;

  if (totals.length === 0) {
    return [];
  }

  const folded = foldIntoOther(totals, maxSlots);
  const grandTotal = folded.reduce((sum, t) => sum + t.minor, 0);
  const n = folded.length;
  const available = Math.max(0, 100 - opts.gapPct * Math.max(0, n - 1));

  if (grandTotal <= 0) {
    return folded.map((_, slot) => ({ widthPct: 0, slot }));
  }

  const raw = folded.map((t) => (t.minor / grandTotal) * available);
  const minPct = Math.min(opts.minPct, available);
  const clamped = raw.map((w) => (w > 0 ? Math.max(w, minPct) : 0));

  let overage = clamped.reduce((sum, w) => sum + w, 0) - available;
  if (overage > 1e-9) {
    const largestFirst = clamped.map((_, i) => i).sort((a, b) => raw[b] - raw[a]);
    for (const i of largestFirst) {
      if (overage <= 1e-9) {
        break;
      }
      const room = clamped[i] - minPct;
      if (room <= 0) {
        continue;
      }
      const take = Math.min(room, overage);
      clamped[i] -= take;
      overage -= take;
    }
  }

  return clamped.map((widthPct, slot) => ({ widthPct, slot }));
}
