/** Screen 07 — Tags (docs/ui/screens/07-tags.md). "07a", the list: a plain
 * row list of every active tag (name, a small "{count} · {amount}" caption)
 * plus an "Add tag" row, and a collapsible archived section below. Tapping
 * an active row or the "Add tag" row is a stub — U2.5 wires them to the
 * rename/delete-or-hide surface ("07b") and the create form.
 *
 * Same three-layer split as `categories.ts`'s 06a section:
 *  - data: `loadTags`/`buildTagsData` — orchestrates the ApiClient calls and
 *    turns them into a `TagsState`. Never throws, same never-throws/
 *    cache-fallback contract as `loadCategories`/`loadHome`.
 *  - presentation: `renderTags`/`renderTagsView` (pure, HTML strings).
 *  - mount: thin DOM glue, the one part with no meaningful unit test (same
 *    accepted gap as every other screen's `mount`). Owns the one piece of
 *    in-screen state this unit has — whether the archived section is
 *    expanded — since that's a pure client-side toggle, not a fetch.
 *
 * Unlike 06a, this is a row list, not a 4-column grid — tags carry no
 * `color_slot`, so there is no swatch to justify a grid (docs/ui/screens/
 * 07-tags.md's Delta). No custom arrow-key grid navigation either: a
 * single-column list's native tab order is enough.
 *
 * `GET /statistics/by-tag` only returns tags with at least one expense in
 * the period (`services/statistics_service.py::by_tag` builds its result
 * from a `defaultdict` over actual expenses) — a tag absent from that
 * response has spent 0 this month, not "unknown"; see `monthTotalFor` below.
 */

import { formatAmount } from "../lib/money";
import { haptics, mainButton, setBackButtonHandler } from "../lib/telegram";
import { ForbiddenError } from "../api/client";
import type { Currency, TagResponse, TagTotal, Uuid } from "../api/types";

// -- data ---------------------------------------------------------------

export interface TagRow {
  id: Uuid;
  name: string;
  expenseCount: number;
  monthTotalMinor: number;
}

export interface TagsData {
  currency: Currency;
  active: TagRow[];
  archived: TagRow[];
}

function monthTotalFor(tagId: Uuid, totals: TagTotal[]): number {
  return totals.find((t) => t.tag_id === tagId)?.total ?? 0;
}

export function buildTagsData(input: { tags: TagResponse[]; monthTotals: TagTotal[]; currency: Currency }): TagsData {
  const ordered = [...input.tags].sort((a, b) => a.created_at.localeCompare(b.created_at));

  const active: TagRow[] = [];
  const archived: TagRow[] = [];
  for (const tag of ordered) {
    const row: TagRow = {
      id: tag.id,
      name: tag.name,
      expenseCount: tag.expense_count ?? 0,
      monthTotalMinor: monthTotalFor(tag.id, input.monthTotals),
    };
    (tag.is_active === false ? archived : active).push(row);
  }

  return { currency: input.currency, active, archived };
}

export interface TagsApi {
  getMe(): Promise<{ currency: Currency }>;
  listTags(opts: { includeUsage?: boolean; includeArchived?: boolean }): Promise<TagResponse[]>;
  statisticsByTag(query: { period: "month"; offset: number }): Promise<TagTotal[]>;
}

export interface TagsSnapshot {
  data: TagsData;
  syncedAt: string;
}

export interface TagsCache {
  get(): TagsSnapshot | null;
  set(snapshot: TagsSnapshot): void;
}

export function createMemoryCache(): TagsCache {
  let snapshot: TagsSnapshot | null = null;
  return {
    get: () => snapshot,
    set: (next) => {
      snapshot = next;
    },
  };
}

export type TagsState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "forbidden" }
  | ({ status: "ready" } & TagsData)
  | ({ status: "offline"; lastSyncedAt: string } & TagsData);

/** Never throws — every failure resolves to a `TagsState` the caller can
 * render directly, same contract as `loadCategories`/`loadHome`. There is no
 * top-level "empty" status: zero tags is a `ready` sub-case (`active.length
 * === 0`) so the "Add tag" row still renders alongside the empty copy
 * (docs/ui/screens/07-tags.md's Empty state). */
export async function loadTags(api: TagsApi, cache: TagsCache): Promise<TagsState> {
  try {
    const [me, tags] = await Promise.all([api.getMe(), api.listTags({ includeUsage: true, includeArchived: true })]);
    const monthTotals = await api.statisticsByTag({ period: "month", offset: 0 });
    const data = buildTagsData({ tags, monthTotals, currency: me.currency });
    cache.set({ data, syncedAt: new Date().toISOString() });
    return { status: "ready", ...data };
  } catch (err) {
    if (err instanceof ForbiddenError) {
      return { status: "forbidden" };
    }
    const cached = cache.get();
    if (cached) {
      return { status: "offline", lastSyncedAt: cached.syncedAt, ...cached.data };
    }
    const message = err instanceof Error ? err.message : "Something went wrong.";
    return { status: "error", message };
  }
}

// -- chrome ---------------------------------------------------------------

/** BackButton always returns to Home. No MainButton on this screen — the
 * "Add tag" row is the add affordance, and a MainButton would be a second,
 * not-yet-built entry point to the same action (mirrors `applyCategoriesChrome`). */
export function applyTagsChrome(onBack: () => void): void {
  setBackButtonHandler(onBack);
  mainButton.hide();
}

// -- presentation -----------------------------------------------------------

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function captionText(row: TagRow): string {
  return `${row.expenseCount} · ${formatAmount(row.monthTotalMinor)}`;
}

function captionAriaLabel(row: TagRow): string {
  const expenseWord = row.expenseCount === 1 ? "1 expense" : `${row.expenseCount} expenses`;
  return `${row.name}, ${expenseWord}, ${formatAmount(row.monthTotalMinor)} this month`;
}

function renderRow(row: TagRow): string {
  return `<div class="card row tag-row" data-testid="tag-row" data-tag-id="${row.id}" role="button" tabindex="0" aria-label="${escapeHtml(captionAriaLabel(row))}">
    <span class="nm" aria-hidden="true">${escapeHtml(row.name)}</span>
    <span class="tag-row-caption" aria-hidden="true">${escapeHtml(captionText(row))}</span>
  </div>`;
}

function renderAddRow(): string {
  return `<div class="card row tag-row tag-row-add" data-testid="tag-row-add" role="button" tabindex="0" aria-label="Add tag">
    <span class="tag-row-add-icon" aria-hidden="true">
      <svg width="24" height="24" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
        <line x1="12" y1="4" x2="12" y2="20" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" />
        <line x1="4" y1="12" x2="20" y2="12" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" />
      </svg>
    </span>
    <span class="nm" aria-hidden="true">Add tag</span>
  </div>`;
}

function renderList(active: TagRow[]): string {
  return `<div class="tag-list" data-testid="tag-list">
    ${active.map(renderRow).join("")}
    ${renderAddRow()}
  </div>`;
}

/** `role="button"`/`tabindex="0"` on the `.row` div — same convention as
 * `categories.ts::renderArchivedRow`, not a native `<button>` (which would
 * need its own border/background/font resets `.row` doesn't carry). */
function renderArchivedRow(row: TagRow): string {
  return `<div class="row tag-archived-row" data-testid="tag-archived-row" role="button" tabindex="0" aria-label="${escapeHtml(captionAriaLabel(row))}">
    <span class="nm" aria-hidden="true">${escapeHtml(row.name)}</span>
    <span class="tag-row-caption" aria-hidden="true">${escapeHtml(captionText(row))}</span>
  </div>`;
}

function renderArchivedSection(archived: TagRow[], expanded: boolean): string {
  if (archived.length === 0) {
    return "";
  }
  return `<div class="tag-archived" data-testid="tag-archived">
    <button type="button" class="tag-archived-header" data-action="toggle-archived" aria-expanded="${expanded}">
      <span>Archived (${archived.length})</span>
      <span class="tag-archived-chevron${expanded ? " tag-archived-chevron--open" : ""}" aria-hidden="true"></span>
    </button>
    ${
      expanded
        ? `<p class="tag-archived-explain">Archived tags keep their history in reports, but you can't pick them for new expenses.</p>
    ${archived.map(renderArchivedRow).join("")}`
        : ""
    }
  </div>`;
}

export interface TagsViewState {
  data: TagsData;
  lastSyncedAt?: string;
  archivedExpanded: boolean;
}

export function renderTagsView(state: TagsViewState): string {
  const { active, archived } = state.data;
  return `<div class="tags-ready" data-testid="ready">
    ${state.lastSyncedAt ? `<div class="offline-banner" data-testid="offline">Offline — showing data from ${escapeHtml(state.lastSyncedAt)}</div>` : ""}
    ${active.length === 0 ? `<p class="tags-empty-note" data-testid="empty-note">Tags cut across categories — add #vacation to a café, a flight and a hotel, and see it as one thing.</p>` : ""}
    ${renderList(active)}
    ${renderArchivedSection(archived, state.archivedExpanded)}
  </div>`;
}

function renderSkeleton(): string {
  const rows = Array.from({ length: 6 }, () => `<div class="tag-row-skeleton"></div>`).join("");
  return `<div class="tags-skeleton" data-testid="loading">
    <div class="tag-list">${rows}</div>
  </div>`;
}

function renderError(message: string): string {
  return `<div class="tags-error" data-testid="error">
    <p>${escapeHtml(message)}</p>
    <button type="button" data-action="retry">Try again</button>
  </div>`;
}

function renderForbidden(): string {
  return `<div class="tags-readonly" data-testid="forbidden">
    <p>You have read-only access to this account.</p>
  </div>`;
}

export function renderTags(state: TagsState, archivedExpanded = false): string {
  switch (state.status) {
    case "loading":
      return renderSkeleton();
    case "error":
      return renderError(state.message);
    case "forbidden":
      return renderForbidden();
    case "ready":
      return renderTagsView({ data: state, archivedExpanded });
    case "offline":
      return renderTagsView({ data: state, lastSyncedAt: state.lastSyncedAt, archivedExpanded });
  }
}

// -- mount (DOM glue; not meaningfully unit-testable under Node, same
//    accepted gap as every other screen's mount) ---------------------------

export interface TagsHandlers {
  onRetry: () => void;
  onBack: () => void;
  /** Opens the 07b rename/delete-or-hide surface (an active row tap). U2.5. */
  onSelectTag: (id: Uuid) => void;
  /** Opens the 07b create form (the "Add tag" row tap). U2.5. */
  onAddTag: () => void;
}

export function mount(root: HTMLElement, state: TagsState, handlers: TagsHandlers): void {
  if (typeof document === "undefined") {
    return;
  }

  let archivedExpanded = false;

  const render = (): void => {
    root.innerHTML = renderTags(state, archivedExpanded);
    wire();
  };

  function wire(): void {
    root.querySelector('[data-action="retry"]')?.addEventListener("click", handlers.onRetry);
    root.querySelector('[data-action="toggle-archived"]')?.addEventListener("click", () => {
      haptics.selection();
      archivedExpanded = !archivedExpanded;
      render();
    });
    // Row/"Add tag" taps stay stubs — U2.5 wires the rename/delete-or-hide
    // and create destinations. `role="button"`/`tabindex="0"` (render side)
    // need a manual Enter/Space handler alongside click — unlike a native
    // <button>, a div doesn't activate on keydown by itself (design-system.md's
    // Accessibility rule; matches `home.ts::renderRankedRows`'s pairing).
    root.querySelectorAll<HTMLElement>('[data-testid="tag-row"]').forEach((el) => {
      const tagId = el.getAttribute("data-tag-id");
      const activate = (): void => {
        if (tagId) {
          handlers.onSelectTag(tagId);
        }
      };
      el.addEventListener("click", activate);
      el.addEventListener("keydown", (e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          activate();
        }
      });
    });
    const addRow = root.querySelector<HTMLElement>('[data-testid="tag-row-add"]');
    addRow?.addEventListener("click", () => handlers.onAddTag());
    addRow?.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        handlers.onAddTag();
      }
    });
  }

  render();
}
