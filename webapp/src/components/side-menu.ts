/** Component: Side menu (docs/ui/components/side-menu.md). Pure render + thin
 * mount, same shape as `period-selector.ts`/`date-range-picker.ts` — no
 * fetching, no state. The app's only navigation surface; U3.2 wires it into
 * Home behind the ☰ button. This unit implements every acceptance criterion
 * that doesn't require the host, so the ☰ button, BackButton wiring, and the
 * closing animation's timed unmount (the panel would need to outlive a
 * `root.innerHTML` replace to animate out, which only the host controls) are
 * deliberately out of scope here.
 */

import { haptics } from "../lib/telegram";
import { t, type Catalogue } from "../lib/i18n";

export type MenuItem =
  | "add-expense"
  | "expenses"
  | "budgets"
  | "statistics"
  | "categories"
  | "tags"
  | "settings";

export interface SideMenuProps {
  open: boolean;
  accountName: string | null; // header line 1; the band renders without it
  currency: string | null; // header line 2
  lastSyncedAt?: string; // footer; omitted -> no footer
  readOnly?: boolean; // disables "Add expense" only
  onSelect(item: MenuItem): void; // host navigates AND closes
  onClose(): void; // scrim tap, BackButton, Escape
}

interface RowDef {
  id: MenuItem;
  labelKey: keyof Catalogue;
  gap?: boolean; // Settings' 12px gap above it (component doc's Anatomy)
}

// Order and catalogue keys per docs/ui/components/side-menu.md's Copy table.
// Looked up via `t()` at render time (never baked into this module-level
// list), so a language change re-renders in the new language.
const ROWS: readonly RowDef[] = [
  { id: "add-expense", labelKey: "item.addExpense" },
  { id: "expenses", labelKey: "item.expenses" },
  { id: "budgets", labelKey: "item.budgets" },
  { id: "statistics", labelKey: "item.statistics" },
  { id: "categories", labelKey: "item.categories" },
  { id: "tags", labelKey: "item.tags" },
  { id: "settings", labelKey: "item.settings", gap: true },
];

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// Copy table's `footer.synced`: "Synced {date} {time}", e.g.
// "Synced 8/7/2026 17:18" — local wall-clock, same reasoning every date
// helper in this codebase follows (no `toISOString`/`Date.UTC`).
function formatSyncedAt(iso: string): string {
  const d = new Date(iso);
  const date = `${d.getMonth() + 1}/${d.getDate()}/${d.getFullYear()}`;
  const time = `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
  return t("footer.synced", { date, time });
}

function renderHeader(accountName: string | null, currency: string | null): string {
  return `<div class="side-menu-header" data-testid="side-menu-header">
    ${accountName ? `<div class="side-menu-account" data-testid="side-menu-account">${escapeHtml(accountName)}</div>` : ""}
    ${currency ? `<div class="side-menu-currency" data-testid="side-menu-currency">${escapeHtml(currency)}</div>` : ""}
  </div>`;
}

function renderRow(row: RowDef, readOnly: boolean): string {
  const disabled = readOnly && row.id === "add-expense";
  const cls = `side-menu-row${row.gap ? " side-menu-row-settings" : ""}`;
  return `<button type="button" class="${cls}" data-item="${row.id}" data-testid="side-menu-row-${row.id}"${disabled ? " disabled" : ""}>${escapeHtml(t(row.labelKey))}</button>`;
}

function renderFooter(lastSyncedAt: string | undefined): string {
  if (!lastSyncedAt) {
    return "";
  }
  return `<div class="side-menu-footer" data-testid="side-menu-footer">${escapeHtml(formatSyncedAt(lastSyncedAt))}</div>`;
}

export function renderSideMenu(props: SideMenuProps): string {
  if (!props.open) {
    // Closed state (component doc's States table): "nothing focusable and
    // nothing in the accessibility tree" — rendering nothing at all.
    return "";
  }
  const readOnly = props.readOnly ?? false;
  const rows = ROWS.map((row) => renderRow(row, readOnly)).join("");
  return `<div class="side-menu-root" data-testid="side-menu-root">
    <div class="side-menu-scrim" aria-hidden="true" data-testid="side-menu-scrim"></div>
    <div class="side-menu-panel" role="dialog" aria-modal="true" aria-label="${escapeHtml(t("menu.title"))}" data-testid="side-menu-panel">
      ${renderHeader(props.accountName, props.currency)}
      <nav class="side-menu-rows" data-testid="side-menu-rows">${rows}</nav>
      ${renderFooter(props.lastSyncedAt)}
    </div>
  </div>`;
}

// -- mount (DOM glue; not meaningfully unit-testable under Node, same
//    accepted gap as period-selector.ts/date-range-picker.ts's mount) ------

export function mount(root: HTMLElement, props: SideMenuProps): void {
  if (typeof document === "undefined") {
    return;
  }
  root.innerHTML = renderSideMenu(props);
  if (!props.open) {
    return;
  }

  const close = (): void => {
    haptics.selection();
    props.onClose();
  };

  root.querySelector('[data-testid="side-menu-scrim"]')?.addEventListener("click", close);

  root.querySelectorAll<HTMLButtonElement>("[data-item]").forEach((el) => {
    el.addEventListener("click", () => {
      haptics.selection();
      // `onSelect` never closes the menu itself (component doc's Inputs) —
      // the host closes it as part of navigating.
      props.onSelect(el.dataset.item as MenuItem);
    });
  });

  const panel = root.querySelector<HTMLElement>('[data-testid="side-menu-panel"]');
  // Disabled rows carry the `disabled` attribute, so this selector already
  // excludes "Add expense" under `readOnly` — the same set a browser would
  // skip on its own Tab order.
  const rows = Array.from(root.querySelectorAll<HTMLButtonElement>(".side-menu-row:not([disabled])"));

  panel?.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      close();
      return;
    }
    if (event.key !== "Tab" || rows.length === 0) {
      return;
    }
    const first = rows[0];
    const last = rows[rows.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  });

  // Focus moves to the first row on open (component doc's Accessibility
  // section); returning it to the menu button on close is the host's job —
  // it owns that element, this component never does.
  rows[0]?.focus();
}
