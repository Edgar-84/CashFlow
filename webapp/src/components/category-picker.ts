/** Component: Category picker (docs/ui/components/category-picker.md). Pure
 * render + thin mount — the 4-column grid on screen 02 (Add expense).
 * Single-select, required: a category is a filled circle in its own colour
 * with its name centred underneath, becoming a rounded square when selected
 * (shape + weight carry the selection, never colour alone — the colour
 * already says which category, so it cannot also say "chosen"). The
 * trailing "More" cell is a navigation button that lives outside the
 * `radiogroup` — it is chrome, not a category, so it keeps the "+" glyph the
 * component doc's Anatomy explicitly gives it even though real category
 * circles hold none (there is no `categories.icon` column; colour is the
 * user-chosen identity instead — component doc's "Delta from reference").
 */

import type { Uuid } from "../api/types";
import { haptics } from "../lib/telegram";

export interface CategoryPickerItem {
  id: Uuid;
  name: string;
  colorVar: string; // e.g. "var(--category-slot-3)", resolved by the caller
  /** Screen 02b's archived-current-category edge case (U1.4): rendered
   * selected and dimmed, never tappable, regardless of the grid's own
   * `disabled` prop. The caller is responsible for only ever setting this on
   * the one archived category that happens to be the expense's own —
   * archived categories are otherwise excluded from `items` entirely. */
  archived?: boolean;
}

export interface CategoryPickerProps {
  items: CategoryPickerItem[]; // already sorted created_at ASC, archived excluded
  selectedId: Uuid | null;
  disabled?: boolean;
  onSelect(id: Uuid): void;
  onMore(): void;
}

const GRID_COLUMNS = 4;

/** Pure index arithmetic for the grid's arrow-key navigation, wrapping by
 * row (component doc's Accessibility section). Mirrors
 * `screens/categories.ts::nextGridFocusIndex` (same 4-column shape) — kept
 * local rather than shared, since this component owns no dependency on that
 * screen module. */
export function nextGridFocusIndex(cellCount: number, from: number, key: string): number {
  if (cellCount === 0) {
    return from;
  }
  switch (key) {
    case "ArrowRight":
      return (from + 1) % cellCount;
    case "ArrowLeft":
      return (from - 1 + cellCount) % cellCount;
    case "ArrowDown": {
      const next = from + GRID_COLUMNS;
      return next < cellCount ? next : next % cellCount;
    }
    case "ArrowUp": {
      const prev = from - GRID_COLUMNS;
      return prev >= 0 ? prev : (prev + cellCount) % cellCount;
    }
    default:
      return from;
  }
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function renderCell(item: CategoryPickerItem, selected: boolean, disabled: boolean): string {
  const cellDisabled = disabled || item.archived === true;
  const cellClass = `cp-cell${selected ? " selected" : ""}${item.archived ? " cp-cell-archived" : ""}`;
  return `<button type="button" class="${cellClass}" role="radio" aria-checked="${selected}" aria-label="${escapeHtml(item.name)}" data-testid="cp-cell" data-category-id="${item.id}"${cellDisabled ? " disabled" : ""}>
    <span class="cp-swatch" style="background:${item.colorVar}" aria-hidden="true"></span>
    <span class="cp-name" aria-hidden="true">${escapeHtml(item.name)}</span>
  </button>`;
}

const MORE_PLUS_SVG =
  '<svg width="24" height="24" viewBox="0 0 24 24" aria-hidden="true" focusable="false">' +
  '<line x1="12" y1="4" x2="12" y2="20" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" />' +
  '<line x1="4" y1="12" x2="20" y2="12" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" /></svg>';

function renderMoreCell(): string {
  return `<button type="button" class="cp-cell cp-more" aria-label="Manage categories" data-testid="cp-more">
    <span class="cp-swatch cp-more-swatch" aria-hidden="true">${MORE_PLUS_SVG}</span>
    <span class="cp-name" aria-hidden="true">More</span>
  </button>`;
}

export function renderCategoryPicker(props: CategoryPickerProps): string {
  const disabled = props.disabled ?? false;
  const cells = props.items.map((item) => renderCell(item, item.id === props.selectedId, disabled)).join("");
  const empty =
    props.items.length === 0
      ? `<p class="cp-empty" data-testid="cp-empty">Create your first category to add an expense.</p>`
      : "";
  return `<div class="cp-root${disabled ? " cp-disabled" : ""}" data-testid="category-picker">
    <div class="cp-label">Categories</div>
    <div class="cp-grid">
      <div class="cp-radiogroup" role="radiogroup" aria-label="Categories">${cells}</div>
      ${disabled ? "" : renderMoreCell()}
    </div>
    ${empty}
  </div>`;
}

// -- mount (DOM glue; not meaningfully unit-testable under Node, same
//    accepted gap as every other screen/component's mount) -----------------

export function mount(root: HTMLElement, props: CategoryPickerProps): void {
  if (typeof document === "undefined") {
    return;
  }
  root.innerHTML = renderCategoryPicker(props);

  if (props.disabled) {
    return; // no cell is interactive, and "More" isn't even rendered
  }

  const grid = root.querySelector<HTMLElement>('[data-testid="category-picker"] .cp-grid');
  const cells = grid ? Array.from(grid.querySelectorAll<HTMLElement>(".cp-cell")) : [];

  for (const cell of cells) {
    cell.addEventListener("click", () => {
      haptics.selection();
      const categoryId = cell.getAttribute("data-category-id");
      if (categoryId) {
        props.onSelect(categoryId);
      } else {
        props.onMore();
      }
    });
  }

  grid?.addEventListener("keydown", (e) => {
    const from = cells.indexOf(document.activeElement as HTMLElement);
    if (from === -1) {
      return;
    }
    let nextIndex = nextGridFocusIndex(cells.length, from, e.key);
    // Skip an archived cell (U1.4) — it's a native `disabled` button, which
    // can never receive focus, so landing on one would strand arrow-key
    // navigation instead of moving past it. Bounded by `cells.length` so a
    // grid that somehow ends up all-disabled can't loop forever.
    for (let guard = 0; guard < cells.length && cells[nextIndex]?.hasAttribute("disabled"); guard++) {
      nextIndex = nextGridFocusIndex(cells.length, nextIndex, e.key);
    }
    if (nextIndex === from || cells[nextIndex]?.hasAttribute("disabled")) {
      return;
    }
    e.preventDefault();
    cells[nextIndex]?.focus();
  });
}
