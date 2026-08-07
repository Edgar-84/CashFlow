/** Screen 07 — Tags. "07a" (docs/ui/screens/07-tags.md), the list: a plain
 * row list of every active tag (name, a small "{count} · {amount}" caption)
 * plus an "Add tag" row, and a collapsible archived section below. Tapping an
 * active row or the "Add tag" row navigates to "07b" — the
 * create/rename/delete-or-hide form (docs/ui/screens/07b-tag-form.md, plan
 * unit U2.5), also in this file below the "-- form --" marker.
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
 * single-column list's native tab order is enough. 07b mirrors this same
 * no-colour absence: its form has no swatch picker either
 * (docs/ui/screens/07b-tag-form.md's Delta).
 *
 * `GET /statistics/by-tag` only returns tags with at least one expense in
 * the period (`services/statistics_service.py::by_tag` builds its result
 * from a `defaultdict` over actual expenses) — a tag absent from that
 * response has spent 0 this month, not "unknown"; see `monthTotalFor` below.
 */

import { formatAmount } from "../lib/money";
import { confirmAction, confirmDiscard, haptics, mainButton, setBackButtonHandler } from "../lib/telegram";
import { ApiError, ForbiddenError } from "../api/client";
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

// -- delete/hide (screen 07b, docs/ui/screens/07b-tag-form.md) --------------
// Pure copy/state helpers shared by 07a's failure banner and 07b's trigger +
// confirm popup. The `DELETE /tags/{id}` call itself and the optimistic
// navigation are orchestrated in main.ts, not here — same split as
// categories.ts's own "-- delete/hide --" section, which this mirrors with
// no colour and no last-remaining-tag warning (tags are optional/multi-valued,
// unlike `expenses.category_id`).

export type TagDeleteOutcomeKind = "deleted" | "archived";

/** Zero expenses hard-deletes; any usage archives (D302, mirrored from
 * categories in `services/tag_service.py::delete`). */
export function tagDeleteOutcomeKind(expenseCount: number): TagDeleteOutcomeKind {
  return expenseCount > 0 ? "archived" : "deleted";
}

/** Region 4's own label previews the branch before the popup even opens
 * (docs/ui/screens/07b-tag-form.md). */
export function tagDeleteTriggerLabel(expenseCount: number): string {
  return expenseCount > 0 ? "Hide tag" : "Delete tag";
}

function tagExpenseCountPhrase(expenseCount: number): string {
  return expenseCount === 1 ? "1 expense keeps it tagged." : `${expenseCount} expenses keep it tagged.`;
}

/** The Telegram `showConfirm` message. Unlike categories' equivalent, there is
 * no last-remaining-tag suffix — deleting the last tag has no consequence
 * comparable to a category-less expense (docs/ui/screens/07b-tag-form.md's
 * Delta). */
export function tagDeleteConfirmMessage(input: { name: string; expenseCount: number }): string {
  return input.expenseCount > 0
    ? `Hide ${input.name}? ${tagExpenseCountPhrase(input.expenseCount)}`
    : `Delete ${input.name}?`;
}

/** The retryable-failure banner's message on 07a — names the tag and which
 * action failed, never a status code. The 403 case uses `error.readonly`
 * instead (see main.ts's delete-outcome handling). */
export function tagDeleteFailureMessage(name: string, expenseCount: number): string {
  return expenseCount > 0 ? `Couldn't hide ${name}.` : `Couldn't delete ${name}.`;
}

/** Optimistic forward transform for a confirmed delete/hide: moves the row
 * out of `active` and, for an archive outcome, into `archived`. Pure — the
 * caller (main.ts) keeps the pre-mutation `TagsData` around to restore on a
 * failed `DELETE` rather than computing an inverse here. A `tagId` not found
 * among `active` is a no-op (defensive; should not happen since the trigger
 * only exists for an already-loaded active row). */
export function applyTagDeleteOutcome(data: TagsData, tagId: Uuid, outcome: TagDeleteOutcomeKind): TagsData {
  const row = data.active.find((r) => r.id === tagId);
  if (!row) {
    return data;
  }
  const active = data.active.filter((r) => r.id !== tagId);
  return outcome === "deleted" ? { ...data, active } : { ...data, active, archived: [...data.archived, row] };
}

/** Inverse of `applyTagDeleteOutcome`, for a failed `DELETE` — reinserts `row`
 * into `active` and, for a reverted archive, removes it from `archived`.
 * Applied to whatever `data` the caller passes (main.ts passes the
 * **current** cache, not a snapshot captured before the attempt) so it
 * composes correctly if another delete/hide completed on a different tag in
 * the meantime. */
export function revertTagDeleteOutcome(data: TagsData, row: TagRow, outcome: TagDeleteOutcomeKind): TagsData {
  const archived = outcome === "archived" ? data.archived.filter((r) => r.id !== row.id) : data.archived;
  return { ...data, active: [...data.active, row], archived };
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

/** A pending delete/hide failure to show above the list (07b) — `null` when
 * none is in flight. `retryable` is `false` for a 403 (no point retrying the
 * same request; the message is `error.readonly` instead in that case). */
export interface TagDeleteFailure {
  tagId: Uuid;
  message: string;
  retryable: boolean;
}

export interface TagsViewState {
  data: TagsData;
  lastSyncedAt?: string;
  archivedExpanded: boolean;
  deleteFailure?: TagDeleteFailure | null;
}

function renderDeleteFailureBanner(failure: TagDeleteFailure): string {
  return `<div class="cat-delete-failed" data-testid="tag-delete-failed" aria-live="polite">
    <p>${escapeHtml(failure.message)}</p>
    ${failure.retryable ? `<button type="button" data-action="retry-delete" data-tag-id="${failure.tagId}">Try again</button>` : ""}
  </div>`;
}

export function renderTagsView(state: TagsViewState): string {
  const { active, archived } = state.data;
  return `<div class="tags-ready" data-testid="ready">
    ${state.deleteFailure ? renderDeleteFailureBanner(state.deleteFailure) : ""}
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

export function renderTags(
  state: TagsState,
  archivedExpanded = false,
  deleteFailure: TagDeleteFailure | null = null,
): string {
  switch (state.status) {
    case "loading":
      return renderSkeleton();
    case "error":
      return renderError(state.message);
    case "forbidden":
      return renderForbidden();
    case "ready":
      return renderTagsView({ data: state, archivedExpanded, deleteFailure });
    case "offline":
      return renderTagsView({ data: state, lastSyncedAt: state.lastSyncedAt, archivedExpanded, deleteFailure });
  }
}

// -- mount (DOM glue; not meaningfully unit-testable under Node, same
//    accepted gap as every other screen's mount) ---------------------------

export interface TagsHandlers {
  onRetry: () => void;
  onBack: () => void;
  /** Opens the 07b rename/delete-or-hide surface pre-filled (an active row
   * tap). */
  onSelectTag: (id: Uuid) => void;
  /** Opens the 07b create form empty (the "Add tag" row tap). */
  onAddTag: () => void;
  /** "Try again" on the delete-failure banner (07b) — re-issues the same
   * `DELETE /tags/{id}`, never a fresh `GET /tags`. */
  onRetryDelete: (tagId: Uuid) => void;
}

/** `deleteFailure` is a snapshot from main.ts (the outcome of a delete/hide
 * attempted from 07b), not local UI state — unlike `archivedExpanded`, it
 * originates from a cross-screen event, so the caller re-mounts with a new
 * value rather than this function owning it. */
export function mount(
  root: HTMLElement,
  state: TagsState,
  handlers: TagsHandlers,
  deleteFailure: TagDeleteFailure | null = null,
): void {
  if (typeof document === "undefined") {
    return;
  }

  let archivedExpanded = false;

  const render = (): void => {
    root.innerHTML = renderTags(state, archivedExpanded, deleteFailure);
    wire();
  };

  function wire(): void {
    root.querySelector('[data-action="retry"]')?.addEventListener("click", handlers.onRetry);
    root.querySelector('[data-action="toggle-archived"]')?.addEventListener("click", () => {
      haptics.selection();
      archivedExpanded = !archivedExpanded;
      render();
    });
    const retryDeleteButton = root.querySelector<HTMLElement>('[data-action="retry-delete"]');
    const retryDeleteId = retryDeleteButton?.getAttribute("data-tag-id");
    if (retryDeleteId) {
      retryDeleteButton?.addEventListener("click", () => handlers.onRetryDelete(retryDeleteId));
    }
    // `role="button"`/`tabindex="0"` (render side) need a manual Enter/Space
    // handler alongside click — unlike a native <button>, a div doesn't
    // activate on keydown by itself (design-system.md's Accessibility rule;
    // matches `home.ts::renderRankedRows`'s pairing).
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

// -- form (screen 07b, docs/ui/screens/07b-tag-form.md) ---------------------
// One form surface for both create and rename/delete-or-hide — own draft/
// controller/chrome/presentation/mount, parallel to `categories.ts`'s own
// "-- form --" section but with no colour picker and no duplicate-name check
// (see 07b-tag-form.md's Delta for why neither applies to tags).

export interface TagFormDraft {
  /** `null` = create mode (POST); set = edit mode (PATCH this id). */
  id: Uuid | null;
  name: string;
}

export function emptyTagFormDraft(): TagFormDraft {
  return { id: null, name: "" };
}

export function tagFormDraftFromRow(row: Pick<TagRow, "id" | "name">): TagFormDraft {
  return { id: row.id, name: row.name };
}

/** Trimmed-name comparison so trailing/leading whitespace alone never counts
 * as a change (docs/ui/screens/07b-tag-form.md's dirty-check rule, mirrors
 * 06b's). */
export function isTagFormDirty(draft: TagFormDraft, original: TagFormDraft): boolean {
  return draft.name.trim() !== original.name.trim();
}

/** The inline name error — never a popup, per the AC. `null` while the
 * trimmed name is non-empty. */
export function tagNameError(name: string): string | null {
  return name.trim() === "" ? "Give this tag a name." : null;
}

/** MainButton's enabled rule: dirty alone, per the spec — a blank name stays
 * *tappable* (not silently disabled); `submit()` below is what actually
 * blocks it and surfaces the inline error. */
export function tagFormMainButtonEnabled(draft: TagFormDraft, original: TagFormDraft): boolean {
  return isTagFormDirty(draft, original);
}

export interface TagFormApi {
  createTag(data: { name: string }): Promise<TagResponse>;
  updateTag(id: Uuid, data: { name?: string }): Promise<TagResponse>;
}

export type TagFormOutcome =
  | { status: "success"; tag: TagResponse }
  | { status: "blocked"; reason: "invalid" | "submitting" }
  | { status: "error"; message: string };

function tagFormErrorMessage(err: unknown): string {
  if (err instanceof ForbiddenError) {
    return "You have read-only access to this account.";
  }
  if (err instanceof ApiError) {
    return err.message;
  }
  return "Couldn't save this tag.";
}

export interface TagFormController {
  getDraft(): TagFormDraft;
  setName(value: string): void;
  submit(): Promise<TagFormOutcome>;
}

/** Owns the in-progress draft and the double-submit guard — same shape as
 * `categories.ts::createCategoryFormController` (D118/D123): `submitting`
 * flips synchronously before the first `await`, so a real double-tap's
 * second call is rejected before either resolves, and only the first reaches
 * the API. */
export function createTagFormController(api: TagFormApi, original: TagFormDraft): TagFormController {
  let draft = { ...original };
  let submitting = false;

  return {
    getDraft: () => draft,
    setName(value) {
      draft = { ...draft, name: value };
    },
    async submit(): Promise<TagFormOutcome> {
      if (submitting) {
        return { status: "blocked", reason: "submitting" };
      }
      if (!isTagFormDirty(draft, original) || tagNameError(draft.name) !== null) {
        return { status: "blocked", reason: "invalid" };
      }
      submitting = true;
      try {
        const name = draft.name.trim();
        const tag = draft.id ? await api.updateTag(draft.id, { name }) : await api.createTag({ name });
        return { status: "success", tag };
      } catch (err) {
        return { status: "error", message: tagFormErrorMessage(err) };
      } finally {
        submitting = false;
      }
    },
  };
}

// -- form chrome ----------------------------------------------------------

export function applyTagFormChrome(draft: TagFormDraft, original: TagFormDraft): void {
  mainButton.show("Save");
  mainButton.setEnabled(tagFormMainButtonEnabled(draft, original));
}

/** BackButton on a dirty draft confirms before discarding — Telegram's own
 * popup, never a custom modal (webapp/CLAUDE.md), same shape as
 * `categories.ts::wireCategoryFormBackButton`. */
export function wireTagFormBackButton(
  getDraft: () => TagFormDraft,
  original: TagFormDraft,
  onClose: () => void,
): void {
  setBackButtonHandler(() => {
    void (async () => {
      if (!isTagFormDirty(getDraft(), original)) {
        onClose();
        return;
      }
      const discard = await confirmDiscard("Discard changes to this tag?");
      if (discard) {
        onClose();
      }
    })();
  });
}

// -- form presentation ------------------------------------------------------

function renderNameField(draft: TagFormDraft, error: string | null): string {
  return `<div>
    <div class="cat-form-field">
      <label class="cat-form-label" for="tag-name-input">Name</label>
      <input id="tag-name-input" class="cat-form-input" type="text" data-testid="tag-name-input" placeholder="Tag name" value="${escapeHtml(draft.name)}" />
    </div>
    <p class="cat-form-message${error ? " cat-form-message--error" : ""}" data-testid="tag-form-message" aria-live="polite">${error ? escapeHtml(error) : ""}</p>
  </div>`;
}

export interface TagFormViewState {
  draft: TagFormDraft;
  nameInteracted: boolean;
  submitError?: string | null;
  /** All-time expense count, from the row this form was opened for — decides
   * region 4's label and the confirm-popup branch (07b). Irrelevant in create
   * mode (`draft.id === null`), where region 4 doesn't render. */
  expenseCount: number;
}

export function renderTagForm(state: TagFormViewState): string {
  const { draft } = state;
  const error = tagNameError(draft.name);
  const message = state.nameInteracted ? error : null;

  return `<div class="cat-form" data-testid="tag-form">
    ${renderNameField(draft, message)}
    ${state.submitError ? `<p class="submit-error" data-testid="tag-form-submit-error">${escapeHtml(state.submitError)}</p>` : ""}
    ${draft.id ? renderDeleteTrigger(state.expenseCount) : ""}
  </div>`;
}

/** Region 4 (07b) — edit mode only, wired in `mountTagForm`. */
function renderDeleteTrigger(expenseCount: number): string {
  return `<button type="button" class="cat-delete-trigger" data-testid="tag-delete-trigger" data-action="delete-tag">${escapeHtml(tagDeleteTriggerLabel(expenseCount))}</button>`;
}

// -- form mount (DOM glue; not meaningfully unit-testable under Node, same
//    accepted gap as every other screen's mount) ---------------------------

export interface TagFormHandlers {
  onClose: () => void;
  /** The created or updated tag — U3.4's add-expense "+ Add tag" flow needs
   * the id to pre-select a just-created tag on return; a rename's caller
   * simply ignores it. */
  onSaved: (tag: TagResponse) => void;
  /** Fires once the user has confirmed Telegram's delete/hide popup (07b).
   * main.ts owns the actual `DELETE` call and the optimistic navigation back
   * to 07a — this handler is just the signal that the confirmation happened. */
  onDelete: (id: Uuid) => void;
}

export function mountTagForm(
  root: HTMLElement,
  api: TagFormApi,
  original: TagFormDraft,
  handlers: TagFormHandlers,
  expenseCount = 0,
): void {
  if (typeof document === "undefined") {
    return;
  }

  const controller = createTagFormController(api, original);
  let nameInteracted = false;
  let submitError: string | null = null;

  const render = (): void => {
    root.innerHTML = renderTagForm({
      draft: controller.getDraft(),
      nameInteracted,
      submitError,
      expenseCount,
    });
    wire();
    applyTagFormChrome(controller.getDraft(), original);
  };

  function wire(): void {
    const input = root.querySelector<HTMLInputElement>('[data-testid="tag-name-input"]');
    input?.addEventListener("input", () => {
      controller.setName(input.value);
      applyTagFormChrome(controller.getDraft(), original);
      if (nameInteracted) {
        rerenderMessage();
      }
    });
    input?.addEventListener("blur", () => {
      if (!nameInteracted) {
        nameInteracted = true;
        rerenderMessage();
      }
    });

    root.querySelector('[data-action="delete-tag"]')?.addEventListener("click", () => {
      const id = original.id;
      if (!id) {
        return;
      }
      const message = tagDeleteConfirmMessage({ name: original.name, expenseCount });
      void (async () => {
        const confirmed = await confirmAction(message);
        if (confirmed) {
          haptics.impact("medium");
          handlers.onDelete(id);
        }
      })();
    });
  }

  function rerenderMessage(): void {
    const error = tagNameError(controller.getDraft().name);
    const el = root.querySelector<HTMLElement>('[data-testid="tag-form-message"]');
    if (!el) {
      return;
    }
    el.textContent = error ?? "";
    el.className = `cat-form-message${error ? " cat-form-message--error" : ""}`;
  }

  wireTagFormBackButton(controller.getDraft, original, handlers.onClose);

  mainButton.onClick(() => {
    void (async () => {
      const outcome = await controller.submit();
      if (outcome.status === "success") {
        haptics.notification("success");
        handlers.onSaved(outcome.tag);
      } else if (outcome.status === "error") {
        submitError = outcome.message;
        render();
      } else if (outcome.status === "blocked" && outcome.reason === "invalid") {
        nameInteracted = true;
        rerenderMessage();
      }
      // "submitting" is the double-submit guard itself firing — the request
      // is already in flight; no UI change needed.
    })();
  });

  render();
  root.querySelector<HTMLInputElement>('[data-testid="tag-name-input"]')?.focus();
}
