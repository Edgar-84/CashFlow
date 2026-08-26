/** Component: Colour picker (docs/ui/components/color-picker.md). Two views
 * of one value: a quick row of 7 fixed circles + a "+", always visible on the
 * category form, and a full 72-slot sheet behind that "+". The sheet reuses
 * the date-range picker's scrim/sheet shell (`drp-*` classes in app.css) so
 * no second `slide-up` keyframe exists — see that component doc's Anatomy
 * §Part 2. Pure render + thin mount, the same shape as `category-picker.ts`.
 *
 * `renderColorSheet` takes no callbacks and `mountColorPicker` only wires the
 * quick row: the component owns neither the sheet's open/closed flag nor the
 * draft (component doc's Inputs) — the host screen renders the sheet from
 * its own state and wires its circles itself, the way `screens/
 * categories.ts::mountCategoryForm`'s `openColorSheet` (U2.2) does.
 */

import { categorySlotCssVar, categorySlotName, PALETTE_SLOT_COUNT, QUICK_SLOTS } from "../lib/category-colors";
import { nextGridFocusIndex } from "../screens/categories";
import { t } from "../lib/i18n";
import { haptics } from "../lib/telegram";

export interface ColorPickerProps {
  selectedSlot: number | null;
  quickSlots?: readonly number[];
  disabled?: boolean;
  onSelect: (slot: number) => void;
  onMore: () => void;
}

const SHEET_COLUMNS = 6;

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

const CHECK_SVG =
  '<svg width="10" height="8" viewBox="0 0 10 8" aria-hidden="true" focusable="false">' +
  '<path d="M1 4l2.5 2.5L9 1" stroke="currentColor" stroke-width="1.6" fill="none" ' +
  'stroke-linecap="round" stroke-linejoin="round" /></svg>';

const PLUS_SVG =
  '<svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true" focusable="false">' +
  '<line x1="8" y1="2" x2="8" y2="14" stroke="currentColor" stroke-width="2" stroke-linecap="round" />' +
  '<line x1="2" y1="8" x2="14" y2="8" stroke="currentColor" stroke-width="2" stroke-linecap="round" /></svg>';

// A private, non-escaping template filler — `label` is wrapped in this file's
// own `escapeHtml` at its one call site below, so `t()`'s auto-escaping vars
// mechanism would escape the interpolated (untranslated, `lib/category-
// colors.ts`-owned) slot name twice (same reasoning as `period-selector.ts`'s
// copy of this helper, U3.9's gotcha; "pure modules don't share helpers",
// U3.5+).
function fillTemplate(template: string, vars: Record<string, string>): string {
  return template.replace(/\{(\w+)\}/g, (match, name: string) => (name in vars ? vars[name] : match));
}

// Doubles the selected state in the accessible name on top of `aria-checked`
// (component doc's Copy table, `swatch.aria.selected`) — deliberate, for
// clients that announce one but not the other. `categorySlotName` itself
// stays untranslated (`lib/category-colors.ts` is out of scope for this
// unit, same "only chrome is translated" line the plan draws around
// formatting — see `date-range-picker.ts`'s own note).
function renderCircle(slot: number, selected: boolean, disabled: boolean): string {
  const name = categorySlotName(slot);
  const label = selected ? fillTemplate(t("colorPicker.selected"), { name }) : name;
  return `<button type="button" class="clp-circle${selected ? " selected" : ""}" role="radio" aria-checked="${selected}" aria-label="${escapeHtml(label)}" data-testid="clp-circle" data-slot="${slot}" style="background:${categorySlotCssVar(slot)}"${disabled ? " disabled" : ""}>${
    selected ? `<span class="clp-badge" aria-hidden="true">${CHECK_SVG}</span>` : ""
  }</button>`;
}

/** Anatomy Part 1, items 2–3: the row and its overflow circle. Item 1 (the
 * "Colour" section label) is the host form's own field-label markup, the
 * same split `screens/categories.ts::renderCategoryForm` already uses for
 * the swatch grid it replaces. */
export function renderColorQuickRow(props: ColorPickerProps): string {
  const quickSlots = props.quickSlots ?? QUICK_SLOTS;
  const disabled = props.disabled ?? false;
  const overflowSlot =
    props.selectedSlot !== null && !quickSlots.includes(props.selectedSlot) ? props.selectedSlot : null;
  const circles = quickSlots.map((slot) => renderCircle(slot, slot === props.selectedSlot, disabled)).join("");
  const overflow = overflowSlot !== null ? renderCircle(overflowSlot, true, disabled) : "";
  const plus = disabled
    ? ""
    : `<button type="button" class="clp-plus" aria-label="${escapeHtml(t("colorPicker.more"))}" data-testid="clp-more">${PLUS_SVG}</button>`;
  return `<div class="clp-row${disabled ? " clp-disabled" : ""}" data-testid="clp-row">
    <div class="clp-radiogroup" role="radiogroup" aria-label="${escapeHtml(t("colorPicker.colour"))}" data-testid="clp-radiogroup">${circles}${overflow}</div>
    ${plus}
  </div>`;
}

/** Anatomy Part 2: the full sheet, reusing `drp-root`/`drp-scrim`/`drp-sheet`/
 * `drp-title` verbatim so `prefers-reduced-motion` and the slide-up animation
 * come for free from `date-range-picker.md`'s existing CSS. */
export function renderColorSheet(selectedSlot: number | null): string {
  const circles = Array.from({ length: PALETTE_SLOT_COUNT }, (_, i) => i + 1)
    .map((slot) => renderCircle(slot, slot === selectedSlot, false))
    .join("");
  const colourLabel = escapeHtml(t("colorPicker.colour"));
  return `<div class="drp-root" data-testid="clp-sheet-root">
    <div class="drp-scrim" data-testid="clp-scrim"></div>
    <div class="drp-sheet" role="dialog" aria-modal="true" aria-label="${colourLabel}" data-testid="clp-sheet">
      <div class="drp-title">${colourLabel}</div>
      <div class="clp-sheet-body" data-testid="clp-sheet-body">
        <div class="clp-grid" role="radiogroup" aria-label="${colourLabel}" data-testid="clp-grid">${circles}</div>
      </div>
    </div>
  </div>`;
}

// -- mount (DOM glue; not meaningfully unit-testable under Node, same
//    accepted gap as every other screen/component's mount) -----------------
//
// Mounts the quick row only — "Not yet wired into any screen" (U2.1's own
// scope). A future host wires `renderColorSheet`'s circles and its scrim
// itself once it owns the open/closed flag (U2.2).

export function mountColorPicker(host: HTMLElement, props: ColorPickerProps): void {
  if (typeof document === "undefined") {
    return;
  }
  host.innerHTML = renderColorQuickRow(props);

  if (props.disabled) {
    return; // no circle is interactive, and "+" isn't even rendered
  }

  const radiogroup = host.querySelector<HTMLElement>('[data-testid="clp-radiogroup"]');
  const circles = radiogroup ? Array.from(radiogroup.querySelectorAll<HTMLElement>(".clp-circle")) : [];

  for (const circle of circles) {
    circle.addEventListener("click", () => {
      haptics.selection();
      const slot = Number(circle.dataset.slot);
      props.onSelect(slot);
    });
  }

  host.querySelector('[data-testid="clp-more"]')?.addEventListener("click", () => {
    haptics.selection();
    props.onMore();
  });

  // A single row: `columns = circles.length` makes ArrowUp/ArrowDown a
  // no-op by construction (component doc's Accessibility section).
  radiogroup?.addEventListener("keydown", (e) => {
    const from = circles.indexOf(document.activeElement as HTMLElement);
    if (from === -1) {
      return;
    }
    const nextIndex = nextGridFocusIndex(circles.length, from, e.key, circles.length);
    if (nextIndex === from) {
      return;
    }
    e.preventDefault();
    circles[nextIndex]?.focus();
  });
}

// Exported for the future sheet host (U2.2) to reuse the same wrapping
// arithmetic as this component's own quick row, so both grids share one
// keyboard-navigation primitive end to end.
export { SHEET_COLUMNS };
