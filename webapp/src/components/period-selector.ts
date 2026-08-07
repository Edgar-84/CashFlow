/** Component: Period selector (docs/ui/components/period-selector.md). Pure
 * render + thin mount — no fetching, no state, the first module in
 * `src/components/`. Two stacked rows: five tabs choosing the unit, and a
 * `‹ label ›` row moving the offset within it. It never computes a period —
 * it only names one and reports taps; the host resolves it via the API and
 * clamps the offset (this component validates nothing, per its own spec).
 */

import { describe as describePeriod, type PeriodUnit, type PeriodValue } from "../lib/period";
import { haptics } from "../lib/telegram";

export interface PeriodSelectorProps {
  value: PeriodValue;
  /** Anchors the rendered label (`describe`) — injected so the component
   * stays a pure function of its inputs and never reads the clock itself
   * (D327; the same reasoning `date-range-picker.ts`'s `maxDate` follows). */
  now: Date;
  disabled?: boolean; // offline
  onUnitChange(unit: PeriodUnit): void; // host resets offset to 0
  onOffsetChange(offset: number): void; // host clamps at 0
  onOpenPicker(): void; // "Period" tab, or a label tap
}

interface TabDef {
  unit: PeriodUnit;
  label: string;
}

// Order and wording per docs/ui/components/period-selector.md's Copy table.
const TABS: readonly TabDef[] = [
  { unit: "day", label: "Day" },
  { unit: "week", label: "Week" },
  { unit: "month", label: "Month" },
  { unit: "year", label: "Year" },
  { unit: "custom", label: "Period" },
];

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function renderTabs(value: PeriodValue, disabled: boolean): string {
  const tabs = TABS.map((tab) => {
    const active = tab.unit === value.unit;
    return `<button type="button" role="tab" class="period-tab${active ? " active" : ""}" aria-selected="${active}" data-unit="${tab.unit}" data-testid="period-tab-${tab.unit}"${disabled ? " disabled" : ""}><span class="period-tab-text">${escapeHtml(tab.label)}</span></button>`;
  }).join("");
  return `<div class="period-tabs" role="tablist">${tabs}</div>`;
}

function renderArrow(direction: "prev" | "next", value: PeriodValue, disabled: boolean): string {
  const isNext = direction === "next";
  const atPresent = isNext && value.offset === 0;
  const ariaLabel = isNext ? `Next ${value.unit}` : `Previous ${value.unit}`;
  const glyph = isNext ? "›" : "‹"; // › ‹
  return `<button type="button" class="period-arrow" data-action="${direction}" aria-label="${escapeHtml(ariaLabel)}"${atPresent ? ' aria-disabled="true"' : ""}${disabled ? " disabled" : ""} data-testid="period-arrow-${direction}">${glyph}</button>`;
}

// design-system.md Iconography: "two `›` chevrons + a 2px vertical bar at the
// right edge, 20px box — the skip-to-end shape, not a plain double chevron."
const JUMP_ICON =
  '<svg width="20" height="20" viewBox="0 0 20 20" aria-hidden="true" focusable="false">' +
  '<path d="M4 4L10 10L4 16" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" fill="none" />' +
  '<path d="M9 4L15 10L9 16" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" fill="none" />' +
  '<line x1="17" y1="4" x2="17" y2="16" stroke="currentColor" stroke-width="2" stroke-linecap="round" />' +
  "</svg>";

// Copy table's per-unit accessible name — "a screen reader user arrowing
// through months should hear the thing they are returning to".
const JUMP_ARIA_LABEL: Record<Exclude<PeriodUnit, "custom">, string> = {
  day: "Back to today",
  week: "Back to this week",
  month: "Back to this month",
  year: "Back to this year",
};

function renderJumpCell(value: PeriodValue, disabled: boolean): string {
  // Reserved cell (component doc's "Why the jump control has a reserved,
  // always-present cell"): present only when offset < 0, but the 44px cell
  // itself always renders so `›` and the label never shift under a tap.
  if (value.unit === "custom" || value.offset === 0) {
    return `<div class="period-jump-cell" aria-hidden="true"></div>`;
  }
  const ariaLabel = JUMP_ARIA_LABEL[value.unit];
  return `<div class="period-jump-cell"><button type="button" class="period-arrow period-jump" data-action="jump" aria-label="${escapeHtml(ariaLabel)}"${disabled ? " disabled" : ""} data-testid="period-jump">${JUMP_ICON}</button></div>`;
}

function renderNav(value: PeriodValue, now: Date, disabled: boolean): string {
  const label = describePeriod(value, now);
  // Custom active: arrows and the jump control absent entirely — an
  // arbitrary range has no next, previous or present (component doc's
  // Variants table).
  const hasArrows = value.unit !== "custom";
  return `<div class="period-nav">
    ${hasArrows ? '<div class="period-spacer" aria-hidden="true"></div>' : ""}
    ${hasArrows ? renderArrow("prev", value, disabled) : ""}
    <button type="button" class="period-label" aria-label="Change period" data-testid="period-label"${disabled ? " disabled" : ""}><span class="period-label-text">${escapeHtml(label)}</span></button>
    ${hasArrows ? renderArrow("next", value, disabled) : ""}
    ${hasArrows ? renderJumpCell(value, disabled) : ""}
  </div>`;
}

export function renderPeriodSelector(props: PeriodSelectorProps): string {
  const disabled = props.disabled ?? false;
  return `<div class="period-selector${disabled ? " disabled" : ""}" data-testid="period-selector">
    ${renderTabs(props.value, disabled)}
    ${renderNav(props.value, props.now, disabled)}
  </div>`;
}

// -- mount (DOM glue; not meaningfully unit-testable under Node, same
//    accepted gap as every screen's mount) ----------------------------------

export function mount(root: HTMLElement, props: PeriodSelectorProps): void {
  if (typeof document === "undefined") {
    return;
  }
  root.innerHTML = renderPeriodSelector(props);

  root.querySelectorAll<HTMLElement>("[data-unit]").forEach((el) => {
    el.addEventListener("click", () => {
      const unit = el.dataset.unit as PeriodUnit;
      haptics.selection();
      if (unit === "custom") {
        // The "Period" tab never sets unit=custom by itself — there is no
        // meaningful state until the picker returns dates.
        props.onOpenPicker();
        return;
      }
      props.onUnitChange(unit);
    });
  });

  root.querySelector<HTMLElement>('[data-testid="period-label"]')?.addEventListener("click", () => {
    haptics.selection();
    props.onOpenPicker();
  });

  root.querySelector<HTMLElement>('[data-action="prev"]')?.addEventListener("click", () => {
    haptics.selection();
    props.onOffsetChange(props.value.offset - 1);
  });

  root.querySelector<HTMLElement>('[data-action="next"]')?.addEventListener("click", () => {
    if (props.value.offset === 0) {
      // Present-end clamp lives here too, not just in aria/CSS — no haptic,
      // no callback (component doc's States table).
      return;
    }
    haptics.selection();
    props.onOffsetChange(props.value.offset + 1);
  });

  root.querySelector<HTMLElement>('[data-action="jump"]')?.addEventListener("click", () => {
    // "Jump to the present" and "arrow forward to the present" are the same
    // state transition — no callback of its own (component doc's Inputs).
    haptics.selection();
    props.onOffsetChange(0);
  });
}
