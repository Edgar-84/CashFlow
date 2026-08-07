/** Screen 02 — Add expense (docs/ui/screens/02-add-expense.md). The one-surface
 * composer: amount focused on open (before any fetch resolves), account name,
 * the U3.1 category grid (required, single-select, "More" opens screen 06),
 * tag chips (optional, multi-select), comment, then the Telegram MainButton
 * restates the action and submits.
 *
 * Layers, same split as screens/home.ts:
 *  - data: `loadAddExpenseData` fetches the categories/tags/currency/account
 *    name the form needs, mirroring `loadHome`'s never-throws contract.
 *  - draft: `createController` owns the in-progress `Draft` and the
 *    double-submit guard (D118/D123's shape) — pure aside from the awaited
 *    `createExpense` call, so it's directly unit-testable without a DOM.
 *  - presentation: `renderAddExpense`/`renderForm` (pure, HTML strings) and
 *    `mount` (thin DOM glue, the one part with no meaningful unit test — same
 *    accepted gap as home.ts's `mount`).
 */

import { formatAmount, parseAmount } from "../lib/money";
import {
  confirmDiscard,
  getViewportStableHeight,
  haptics,
  mainButton,
  setBackButtonHandler,
} from "../lib/telegram";
import { ApiError, ForbiddenError, NotFoundError } from "../api/client";
import {
  mount as mountCategoryPicker,
  renderCategoryPicker,
  type CategoryPickerItem,
} from "../components/category-picker";
import { mount as mountDateRangePicker } from "../components/date-range-picker";
import { assignCategoryColors, categorySlotCssVar } from "../lib/category-colors";
import type {
  CategoryResponse,
  Currency,
  ExpenseCreate,
  ExpenseResponse,
  ExpenseUpdate,
  TagResponse,
  Uuid,
} from "../api/types";

// -- data --------------------------------------------------------------------

/** Screen 02 always creates; screen 02b (U1.4) opens the same module in
 * `"edit"` mode with an `initialExpense` to pre-fill from and PATCH back to.
 * `createController` defaults to `"create"`, so every existing call site —
 * including every test in this unit — is unaffected. */
export type AddExpenseMode = "create" | "edit";

export interface AddExpenseApi {
  getMe(): Promise<{ currency: Currency; account_name: string; today: string }>;
  listCategories(): Promise<CategoryResponse[]>;
  listTags(): Promise<TagResponse[]>;
  createExpense(data: ExpenseCreate): Promise<ExpenseResponse>;
  /** Screen 02b's save (U1.4). Optional so a `"create"`-mode caller — every
   * existing fake in this unit's tests — needs no change. */
  updateExpense?(id: Uuid, data: ExpenseUpdate): Promise<ExpenseResponse>;
  /** Screen 02b's archived-current-category lookup (U1.4) — `main.ts`'s edit
   * route only, never called in create mode. Optional for the same reason
   * `updateExpense` is. */
  getCategory?(id: Uuid): Promise<CategoryResponse>;
}

export interface AddExpenseFormData {
  categories: CategoryResponse[];
  tags: TagResponse[];
  currency: Currency;
  /** `UserMeResponse.account_name` (U0.2c) — read-only text on this screen,
   * never a picker (one account per user, docs/ui/screens/02-add-expense.md's
   * Account section). */
  accountName: string;
  /** `UserMeResponse.today` (U3.3), `YYYY-MM-DD` in `family_tz` — the date
   * row's anchor. Never derived from the device clock (D120's bug class). */
  today: string;
}

export interface AddExpenseSnapshot {
  data: AddExpenseFormData;
  syncedAt: string;
}

export interface AddExpenseCache {
  get(): AddExpenseSnapshot | null;
  set(snapshot: AddExpenseSnapshot): void;
}

export function createMemoryCache(): AddExpenseCache {
  let snapshot: AddExpenseSnapshot | null = null;
  return {
    get: () => snapshot,
    set: (next) => {
      snapshot = next;
    },
  };
}

export type AddExpenseLoadState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "forbidden" }
  | { status: "empty" }
  | ({ status: "ready" } & AddExpenseFormData)
  | ({ status: "offline"; lastSyncedAt: string } & AddExpenseFormData);

/** Loads the categories/tags/currency the form's chips need. Never throws —
 * every failure resolves to a state the caller can render directly, same
 * contract as `screens/home.ts::loadHome`. */
export async function loadAddExpenseData(
  api: AddExpenseApi,
  cache: AddExpenseCache,
): Promise<AddExpenseLoadState> {
  try {
    const [me, categories, tags] = await Promise.all([
      api.getMe(),
      api.listCategories(),
      api.listTags(),
    ]);
    const data: AddExpenseFormData = {
      categories,
      tags,
      currency: me.currency,
      accountName: me.account_name,
      today: me.today,
    };
    cache.set({ data, syncedAt: new Date().toISOString() });
    return categories.length === 0 ? { status: "empty" } : { status: "ready", ...data };
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

// -- draft ---------------------------------------------------------------

export interface Draft {
  amountInput: string;
  categoryId: Uuid | null;
  tagIds: Uuid[];
  comment: string;
  /** `YYYY-MM-DD`, or `null` for "no override" — the "today" pill, which is
   * also the server's own default for an omitted `spent_at` (D314), so
   * `null` and an explicit `today` string are equivalent on submit (U3.3). */
  spentAt: string | null;
}

export function emptyDraft(): Draft {
  return { amountInput: "", categoryId: null, tagIds: [], comment: "", spentAt: null };
}

/** Screen 02b's pre-fill (U1.4): the draft an edit opens with, straight from
 * the expense screen 03b already loaded — no refetch. Unlike `emptyDraft`,
 * `spentAt` is always the expense's own date, never `null` — "no override"
 * only means "today" in create mode (see `Draft.spentAt` above); an edit has
 * no such default to fall back on. */
export function draftFromExpense(expense: ExpenseResponse): Draft {
  return {
    amountInput: formatAmount(expense.amount),
    categoryId: expense.category_id,
    tagIds: expense.tags.map((t) => t.id),
    comment: expense.comment ?? "",
    spentAt: expense.spent_at,
  };
}

/** `spentAt` is deliberately excluded — docs/ui/screens/02-add-expense.md's
 * BackButton section: "a changed date alone does not make it dirty". */
export function isDirty(draft: Draft): boolean {
  return (
    draft.amountInput.trim() !== "" ||
    draft.categoryId !== null ||
    draft.tagIds.length > 0 ||
    draft.comment.trim() !== ""
  );
}

/** The inline amount error (never a popup, per the AC). `null` while the
 * field is untouched (empty) or the amount is valid. */
export function amountError(amountInput: string): string | null {
  if (amountInput.trim() === "") {
    return null;
  }
  return parseAmount(amountInput) === null ? "Enter an amount greater than 0." : null;
}

export interface SubmitButtonState {
  label: string;
  enabled: boolean;
}

/** MainButton label/enabled per the AC: disabled and "Choose a category"
 * until one is picked, then restates the action (`Add 38.40 EUR to
 * Groceries`). Fills a gap the AC doesn't name: a category picked before a
 * valid amount keeps the button disabled too, with an "Enter an amount"
 * label — "Add ... to Category" shouldn't promise a submit that would fail
 * validation. */
export function submitButtonState(
  draft: Draft,
  categories: CategoryResponse[],
  currency: Currency,
): SubmitButtonState {
  if (!draft.categoryId) {
    return { label: "Choose a category", enabled: false };
  }
  const category = categories.find((c) => c.id === draft.categoryId);
  const minor = parseAmount(draft.amountInput);
  if (minor === null || !category) {
    return { label: "Enter an amount", enabled: false };
  }
  return { label: `Add ${formatAmount(minor)} ${currency} to ${category.name}`, enabled: true };
}

/** Screen 02b's PATCH payload (U1.4) — only the fields that actually differ
 * from `initialExpense`, per its AC ("the PATCH carries only the changed
 * fields") and its Edge cases ("changing only the date... without touching
 * its amount"). Tags compare as a **set**, not a sequence — re-selecting the
 * tag that was already selected must leave the button disabled, per the
 * screen doc's MainButton section. `today` resolves a `null` `spentAt` (the
 * date row's own "today" pill convention) exactly the way `submit()`'s edit
 * branch already resolves it for the request body, so the diff and the
 * actual PATCH can never disagree about what counts as a change. Returns
 * `{}` when nothing differs; unreachable from the UI once MainButton is
 * disabled on that state (Edge cases: "impossible; no empty PATCH is ever
 * sent"), so `isEditDirty`/`editButtonState` below build directly on this
 * rather than duplicating the comparison. */
export function editChanges(draft: Draft, initialExpense: ExpenseResponse, today: string | null): ExpenseUpdate {
  const changes: ExpenseUpdate = {};
  const minor = parseAmount(draft.amountInput);
  if (minor !== null && minor !== initialExpense.amount) {
    changes.amount = minor;
  }
  if (draft.categoryId && draft.categoryId !== initialExpense.category_id) {
    changes.category_id = draft.categoryId;
  }
  const spentAt = draft.spentAt ?? today ?? initialExpense.spent_at;
  if (spentAt !== initialExpense.spent_at) {
    changes.spent_at = spentAt;
  }
  const draftTagIds = new Set(draft.tagIds);
  const originalTagIds = new Set(initialExpense.tags.map((t) => t.id));
  const tagsMatch =
    draftTagIds.size === originalTagIds.size && [...draftTagIds].every((id) => originalTagIds.has(id));
  if (!tagsMatch) {
    changes.tag_ids = draft.tagIds;
  }
  // Trimmed both sides, same storage convention `submit()`'s create branch
  // already uses. The screen doc's Edge cases separately says "only
  // whitespace added... counts as a change" — appending only whitespace to
  // an already-trimmed comment normalizes to the same stored string either
  // way, so nothing is actually lost by comparing trimmed; this is the same
  // pre-existing ambiguity screen 02's own trim-on-submit already carries,
  // not something new here.
  const comment = draft.comment.trim() === "" ? null : draft.comment.trim();
  if (comment !== (initialExpense.comment ?? null)) {
    changes.comment = comment;
  }
  return changes;
}

export function isEditDirty(draft: Draft, initialExpense: ExpenseResponse, today: string | null): boolean {
  return Object.keys(editChanges(draft, initialExpense, today)).length > 0;
}

/** MainButton chrome for 02b (U1.4). Unlike create's restated-action label,
 * this always reads "Save changes" once valid — the two guard states,
 * "Enter an amount" and "Choose a category", are reused verbatim from
 * `submitButtonState` (screen doc: "the same two guards screen 02 has, same
 * strings"). Deliberately does **not** check that `categoryId` is still in
 * the account's active category list the way `submitButtonState` does: the
 * archived-current-category edge case requires the opposite — that category
 * stays selected and must not block Save on its own. */
export function editButtonState(
  draft: Draft,
  initialExpense: ExpenseResponse,
  today: string | null,
): SubmitButtonState {
  if (!draft.categoryId) {
    return { label: "Choose a category", enabled: false };
  }
  if (parseAmount(draft.amountInput) === null) {
    return { label: "Enter an amount", enabled: false };
  }
  return { label: "Save changes", enabled: isEditDirty(draft, initialExpense, today) };
}

export type SubmitOutcome =
  | { status: "success"; expense: ExpenseResponse }
  | { status: "blocked" }
  | { status: "error"; message: string };

/** `staleExpense` (U1.4): the PATCH's own 404 came from `services/
 * expense_service.py::update`'s `self.get(expense_id, …)` guard rather than
 * its `_validate_category` one — see `isStaleExpenseError`'s doc comment for
 * how the caller tells the two apart. Screen 02b's Copy table gives both the
 * 403 and this 404 their own strings, distinct from screen 02's. */
function submitErrorMessage(
  err: unknown,
  opts: { mode?: AddExpenseMode; staleExpense?: boolean } = {},
): string {
  if (err instanceof ForbiddenError) {
    return opts.mode === "edit"
      ? "You don't have permission to edit this expense."
      : "You don't have permission to add expenses.";
  }
  if (opts.staleExpense) {
    return "That expense no longer exists.";
  }
  if (err instanceof NotFoundError) {
    return "That category no longer exists.";
  }
  // 409 (D302): the category existed when the grid was drawn but was
  // archived before this submit landed. No dedicated error class — the
  // status code is the only signal, same convention as
  // `screens/budgets.ts::saveErrorMessage`'s duplicate-plan 409.
  if (err instanceof ApiError && err.status === 409) {
    return "That category was archived. Choose another.";
  }
  if (err instanceof ApiError) {
    return err.message;
  }
  return "Something went wrong. Please try again.";
}

/** The two failure modes this unit recovers from (docs/ui/screens/02-add-
 * expense.md's Stale/Archived category rows): the category picked at open
 * no longer exists, or was archived between the grid rendering and this
 * submit landing. Both share the same recovery shape — clear the
 * selection, refetch the list — so `err.status === 409` alone (D302) is
 * enough; the message text distinguishes the two for the user. */
function isStaleCategoryError(err: unknown): boolean {
  return err instanceof NotFoundError || (err instanceof ApiError && err.status === 409);
}

/** Screen 02b's "Stale expense" vs "Stale category" states (U1.4) — both are
 * a `NotFoundError` on the same `PATCH /expenses/{id}`, so the HTTP status
 * alone can't tell them apart. `services/expense_service.py::update` raises
 * its expense-missing 404 unconditionally (`self.get(expense_id, …)`, first
 * line of the method) but only reaches `_validate_category`'s 404 when
 * `category_id` is actually **in the payload** — "update skips it when the
 * field is absent" (that method's own doc comment). So: no `category_id` in
 * `changes` means the server never ran the category check at all, and the
 * 404 can only be the expense itself. `category_id` present makes the two
 * genuinely ambiguous from here; falling back to "stale category" in that
 * case matches create mode's own established handling of the same
 * ambiguity (screen 02 always sends `category_id`, so it never had to
 * distinguish). */
function isStaleExpenseError(err: unknown, changes: ExpenseUpdate): boolean {
  return err instanceof NotFoundError && !("category_id" in changes);
}

export interface AddExpenseController {
  getDraft(): Draft;
  /** The category grid's current source list — starts as the `categories`
   * constructor arg, replaced in place by a stale-category recovery
   * (U3.5: a 404/409 on submit refetches so the archived/deleted category
   * drops out of the grid the next render). */
  getCategories(): CategoryResponse[];
  setAmountInput(value: string): void;
  setCategoryId(id: Uuid): void;
  toggleTag(id: Uuid): void;
  setComment(value: string): void;
  /** `null` clears the override — picking the "today" pill again, or a
   * calendar date that happens to equal today. */
  setSpentAt(date: string | null): void;
  submit(): Promise<SubmitOutcome>;
}

/** Owns the in-progress draft and the double-submit guard. `submitting` is
 * flipped synchronously before the first `await`, so two `submit()` calls
 * issued back-to-back (a real double-tap) both run before either resolves —
 * the second sees the flag already set and short-circuits. Only the first
 * reaches `createExpense` (AC: "exactly one POST", same shape as the bot's
 * D118/D123 confirm-step guard: disable/clear before the call). On success
 * the draft resets, so a stray replayed call afterwards is rejected by
 * `submitButtonState` (no category) rather than issuing a second write.
 *
 * A stale-category 404/409 (U3.5) is the other recovering failure: the
 * selection is cleared and `categories` refetched via `api.listCategories`,
 * while the rest of the draft (amount, tags, comment, date) survives —
 * still "pure aside from the awaited API calls", so directly unit-testable.
 *
 * `mode`/`initialExpense` are U1.3's hook, and U1.4 is the unit that uses it
 * for real: one `submit()` serves both screens rather than a second
 * `update()` method, so the double-submit guard and the stale-category
 * recovery need no duplicate. In `"edit"` mode the PATCH carries only what
 * `editChanges` finds different from `initialExpense` (02b's AC), gated by
 * `editButtonState`'s dirty check rather than `submitButtonState`'s
 * always-valid-draft one. A successful edit leaves the draft as-is (screen
 * 02b returns to 03b showing it) rather than resetting to empty, which is
 * create mode's own affordance for "add another". `today` resolves a `null`
 * `spentAt` (the "today" pill's own convention, set by the same date row
 * screen 02b reuses verbatim) back to a real date for both the dirty check
 * and the PATCH — falling back to `initialExpense.spent_at` instead would
 * silently revert a deliberate "move this to today" edit. */
export function createController(
  api: Pick<AddExpenseApi, "createExpense" | "updateExpense" | "listCategories">,
  categories: CategoryResponse[],
  currency: Currency,
  initialDraft: Draft = emptyDraft(),
  mode: AddExpenseMode = "create",
  initialExpense: ExpenseResponse | null = null,
  today: string | null = null,
): AddExpenseController {
  let draft = initialDraft;
  let submitting = false;

  return {
    getDraft: () => draft,
    getCategories: () => categories,
    setAmountInput(value) {
      draft = { ...draft, amountInput: value };
    },
    setCategoryId(id) {
      draft = { ...draft, categoryId: id };
    },
    toggleTag(id) {
      draft = {
        ...draft,
        tagIds: draft.tagIds.includes(id)
          ? draft.tagIds.filter((t) => t !== id)
          : [...draft.tagIds, id],
      };
    },
    setComment(value) {
      draft = { ...draft, comment: value };
    },
    setSpentAt(date) {
      draft = { ...draft, spentAt: date };
    },
    async submit(): Promise<SubmitOutcome> {
      if (submitting) {
        return { status: "blocked" };
      }
      if (mode === "edit" && !initialExpense) {
        // Programmer error, not a user-facing scenario (webapp/CLAUDE.md's
        // rule against validating what can't happen at a system boundary) —
        // a host constructing an edit controller without the expense it
        // edits is a wiring bug, not user input. Fails loud instead of
        // silently falling through to the create branch below and posting a
        // duplicate expense.
        throw new Error("createController: edit mode requires initialExpense");
      }
      const minor = parseAmount(draft.amountInput);
      const { enabled } =
        mode === "edit" && initialExpense
          ? editButtonState(draft, initialExpense, today)
          : submitButtonState(draft, categories, currency);
      if (!enabled || minor === null || !draft.categoryId) {
        return { status: "blocked" };
      }
      const changes = mode === "edit" && initialExpense ? editChanges(draft, initialExpense, today) : null;
      submitting = true;
      try {
        const expense =
          mode === "edit" && initialExpense
            ? await api.updateExpense!(initialExpense.id, changes!)
            : await api.createExpense({
                amount: minor,
                category_id: draft.categoryId,
                tag_ids: draft.tagIds.length > 0 ? draft.tagIds : undefined,
                comment: draft.comment.trim() === "" ? undefined : draft.comment.trim(),
                spent_at: draft.spentAt ?? undefined,
              });
        draft = mode === "edit" ? draft : emptyDraft();
        return { status: "success", expense };
      } catch (err) {
        const staleExpense = mode === "edit" && changes !== null && isStaleExpenseError(err, changes);
        if (!staleExpense && isStaleCategoryError(err)) {
          draft = { ...draft, categoryId: null };
          try {
            categories = await api.listCategories();
          } catch {
            // The refetch itself failing is not this AC's concern — the
            // cleared selection still forces a re-pick, which is the part
            // that matters; the grid just shows the last-known list.
          }
        }
        return { status: "error", message: submitErrorMessage(err, { mode, staleExpense }) };
      } finally {
        submitting = false;
      }
    },
  };
}

// -- chrome ------------------------------------------------------------------

/** Telegram chrome for Add-expense: MainButton is the submit, per
 * `submitButtonState`. */
export function applyAddExpenseChrome(
  draft: Draft,
  categories: CategoryResponse[],
  currency: Currency,
): void {
  const { label, enabled } = submitButtonState(draft, categories, currency);
  mainButton.show(label);
  mainButton.setEnabled(enabled);
}

/** Screen 02b's MainButton chrome (U1.4) — `editButtonState`'s "Save
 * changes"/dirty-gated label instead of create's restated action. */
export function applyEditExpenseChrome(
  draft: Draft,
  initialExpense: ExpenseResponse,
  today: string | null,
): void {
  const { label, enabled } = editButtonState(draft, initialExpense, today);
  mainButton.show(label);
  mainButton.setEnabled(enabled);
}

/** BackButton on a dirty draft confirms before discarding — Telegram's own
 * popup, never a custom modal (webapp/CLAUDE.md). A clean draft closes
 * immediately with no prompt. `isDirtyFn`/`message` default to screen 02's
 * own shape; screen 02b (U1.4) passes its own dirty check (against
 * `initialExpense`, not "any field non-empty") and its own copy ("Discard
 * changes?", not "Discard this expense?" — 02b's Copy table), so the two
 * screens' BackButtons never need separate wiring functions. */
export function wireBackButton(
  getDraft: () => Draft,
  onClose: () => void,
  opts: { isDirtyFn?: (draft: Draft) => boolean; message?: string } = {},
): void {
  const isDirtyFn = opts.isDirtyFn ?? isDirty;
  const message = opts.message ?? "Discard this expense?";
  setBackButtonHandler(() => {
    void (async () => {
      if (!isDirtyFn(getDraft())) {
        onClose();
        return;
      }
      const discard = await confirmDiscard(message);
      if (discard) {
        onClose();
      }
    })();
  });
}

// -- presentation --------------------------------------------------------

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function renderChip(opts: { id: string; label: string; selected: boolean; attr: string }): string {
  return (
    `<button type="button" class="chip${opts.selected ? " active" : ""}" ` +
    `data-${opts.attr}="${opts.id}" aria-pressed="${opts.selected}">${escapeHtml(opts.label)}</button>`
  );
}

// No-op stand-ins for the callbacks `CategoryPickerProps` requires — the pure
// render never invokes them, only `mountCategoryPicker` (in `mount`, below)
// wires the real handlers, same convention as `screens/home.ts`'s own `noop`
// for `renderPeriodSelector`.
const noop = () => {};

function categoryPickerItems(categories: CategoryResponse[]): CategoryPickerItem[] {
  const colors = assignCategoryColors(categories);
  const slotById = new Map(colors.map((c) => [c.id, c.slot]));
  return categories.map((c) => ({
    id: c.id,
    name: c.name,
    colorVar: categorySlotCssVar(slotById.get(c.id) ?? null),
  }));
}

/** Screen 02b's archived-current-category edge case (U1.4): `categories` may
 * (in edit mode) carry one archived row alongside the account's active ones
 * — `main.ts`'s edit route merges it in via `ApiClient.getCategory` when
 * `initialExpense.category_id` isn't in the plain `GET /categories` list.
 * Splits that combined list into the selectable grid (active only, exactly
 * what create mode already offers) plus, if the *selected* id is the
 * archived row, one extra dimmed cell appended after it — never any other
 * archived category, and never a tappable one. `color_slot` is read
 * directly off the archived row rather than through `assignCategoryColors`
 * over the combined list: D301 says a set slot never gets recomputed, and
 * running position-based fallback over a list that mixes active and archived
 * rows would risk shifting an *active* category's own fallback colour, which
 * archiving one of its siblings must never do. */
function categoryGridItems(categories: CategoryResponse[], selectedId: Uuid | null): CategoryPickerItem[] {
  const active = categories.filter((c) => c.is_active !== false);
  const items = categoryPickerItems(active);
  const archived = selectedId ? categories.find((c) => c.id === selectedId && c.is_active === false) : undefined;
  if (archived) {
    items.push({
      id: archived.id,
      name: archived.name,
      colorVar: categorySlotCssVar(archived.color_slot ?? null),
      archived: true,
    });
  }
  return items;
}

function renderCategoryGridSlot(categories: CategoryResponse[], selectedId: Uuid | null): string {
  return `<div class="category-picker-slot">${renderCategoryPicker({
    items: categoryGridItems(categories, selectedId),
    selectedId,
    onSelect: noop,
    onMore: noop,
  })}</div>`;
}

function renderAccountField(accountName: string): string {
  return `<div class="account-field" data-testid="account-field">
    <div class="account-label">Account</div>
    <div class="account-name" data-testid="account-name">${escapeHtml(accountName)}</div>
  </div>`;
}

// -- date row (docs/ui/screens/02-add-expense.md's Date region, U3.3) -------
//
// Pure date-string helpers mirroring `components/date-range-picker.ts`'s own
// private copies — that module's header comment already states the
// convention this file follows too: each pure module owns its own rather
// than sharing. Every `Date` here is local wall-clock and every
// `YYYY-MM-DD` string a plain calendar date (no `Date.UTC`, no
// `toISOString`, no `new Date("YYYY-MM-DD")` — D120's bug class). `today`
// itself always comes from `AddExpenseFormData.today` (`UserMeResponse`,
// resolved server-side in `family_tz`), never `new Date()`.

function parseDateString(s: string): Date {
  const [y, m, d] = s.split("-").map(Number);
  return new Date(y, m - 1, d);
}

function toDateString(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function addDays(d: Date, days: number): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + days);
}

/** "8/4" — the pill's numeric line (screen doc's Pill table). */
function formatPillDate(dateStr: string): string {
  const d = parseDateString(dateStr);
  return `${d.getMonth() + 1}/${d.getDate()}`;
}

const WEEKDAY_NAMES = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"];

export interface DatePillOption {
  date: string; // YYYY-MM-DD
  label: string;
}

/** The three fixed shortcuts, plus a fourth for `selected` when it falls
 * outside them — "a calendar date outside the three shortcuts appears as a
 * fourth selected pill" (screen doc). Its label is the lowercase weekday
 * name, matching the other three pills' lowercase-word style; not specified
 * by the screen doc, a U3.3 judgment call (plan Decision log). */
export function datePillOptions(today: string, selected: string): DatePillOption[] {
  const t = parseDateString(today);
  const fixed: DatePillOption[] = [
    { date: today, label: "today" },
    { date: toDateString(addDays(t, -1)), label: "yesterday" },
    { date: toDateString(addDays(t, -2)), label: "two days ago" },
  ];
  if (fixed.some((p) => p.date === selected)) {
    return fixed;
  }
  const weekday = WEEKDAY_NAMES[(parseDateString(selected).getDay() + 6) % 7]; // Monday = 0
  return [...fixed, { date: selected, label: weekday }];
}

/** Wraparound left/right focus movement for the (single-row) date
 * `radiogroup` — docs/ui/screens/02-add-expense.md's Accessibility section:
 * "the date row is a radiogroup. Arrow keys move within each." Same shape as
 * `components/category-picker.ts::nextGridFocusIndex`, minus that grid's
 * up/down rows (this row has only one). */
export function nextDatePillFocusIndex(count: number, from: number, key: string): number {
  if (count === 0) {
    return from;
  }
  switch (key) {
    case "ArrowRight":
      return (from + 1) % count;
    case "ArrowLeft":
      return (from - 1 + count) % count;
    default:
      return from;
  }
}

const CALENDAR_ICON =
  '<svg width="24" height="24" viewBox="0 0 24 24" aria-hidden="true" focusable="false">' +
  '<rect x="3" y="5" width="18" height="16" rx="3" stroke="currentColor" stroke-width="2" fill="none" />' +
  '<line x1="8" y1="3" x2="8" y2="7" stroke="currentColor" stroke-width="2" stroke-linecap="round" />' +
  '<line x1="16" y1="3" x2="16" y2="7" stroke="currentColor" stroke-width="2" stroke-linecap="round" />' +
  "</svg>";

function renderDateRow(today: string, spentAt: string | null): string {
  const selected = spentAt ?? today;
  const pills = datePillOptions(today, selected)
    .map((p) => {
      const isSelected = p.date === selected;
      return `<button type="button" class="date-pill${isSelected ? " selected" : ""}" role="radio" aria-checked="${isSelected}" data-date="${p.date}" data-testid="date-pill-${p.date}">
        <span class="date-pill-date">${escapeHtml(formatPillDate(p.date))}</span>
        <span class="date-pill-label">${escapeHtml(p.label)}</span>
      </button>`;
    })
    .join("");
  return `<div class="date-row" data-testid="date-row">
    <div class="date-pills" role="radiogroup" aria-label="Date">${pills}</div>
    <button type="button" class="date-calendar-btn" data-testid="date-calendar-button" aria-label="Choose a date">${CALENDAR_ICON}</button>
  </div>`;
}

// "+ Add tag" is always the last chip, even with zero tags (screen doc edge
// case: "the Tags section shows only '+ Add tag'") — so this never early-
// returns empty markup the way the pre-U3.4 version did.
function renderTagChips(tags: TagResponse[], selectedIds: Uuid[]): string {
  const chips = tags
    .map((t) => renderChip({ id: t.id, label: t.name, selected: selectedIds.includes(t.id), attr: "tag-id" }))
    .join("");
  const addChip = '<button type="button" class="chip" data-testid="tag-add-chip">+ Add tag</button>';
  return `<div class="field-label">Tags</div><div class="chip-row" data-testid="tag-chips">${chips}${addChip}</div>`;
}

/** How far (px) the just-focused comment field must scroll so the keyboard
 * doesn't cover it — `fieldBottom` and `viewportStableHeight` are both in the
 * same viewport-relative coordinate space `getBoundingClientRect()` returns.
 * Zero (never negative) when the field is already clear. Pure so it's
 * testable under Node; the DOM wiring around it (`mount`) is not — same
 * accepted gap as every other DOM-touching helper in this file. Uses
 * `viewportStableHeight`, not `window.innerHeight`/`100vh`, because only the
 * former already excludes the on-screen keyboard (screen doc's Viewport
 * section). */
export function commentScrollOffset(fieldBottom: number, viewportStableHeight: number): number {
  return Math.max(0, fieldBottom - viewportStableHeight);
}

export function renderForm(
  data: AddExpenseFormData,
  draft: Draft,
  opts: { submitError?: string | null; lastSyncedAt?: string } = {},
): string {
  const error = amountError(draft.amountInput);
  return `<div class="add-expense-form" data-testid="add-expense-form">
    ${opts.lastSyncedAt ? `<div class="offline-banner" data-testid="offline">Offline — showing data from ${escapeHtml(opts.lastSyncedAt)}</div>` : ""}
    <div class="card field">
      <input class="amount-input" data-testid="amount-input" inputmode="decimal" autofocus
        value="${escapeHtml(draft.amountInput)}" placeholder="0.00" />
      <div class="currency-suffix" data-testid="currency-suffix">${escapeHtml(data.currency)}</div>
    </div>
    <p class="field-error" data-testid="amount-error">${error ? escapeHtml(error) : ""}</p>
    ${renderAccountField(data.accountName)}
    ${renderCategoryGridSlot(data.categories, draft.categoryId)}
    ${renderDateRow(data.today, draft.spentAt)}
    ${renderTagChips(data.tags, draft.tagIds)}
    <div class="field-label">Comment</div>
    <textarea class="comment-input" data-testid="comment-input" placeholder="Comment" maxlength="4096">${escapeHtml(draft.comment)}</textarea>
    ${opts.submitError ? `<p class="submit-error" data-testid="submit-error">${escapeHtml(opts.submitError)}</p>` : ""}
  </div>`;
}

/** The amount field is real and focused here too (never a static placeholder)
 * — docs/ui/screens/02-add-expense.md's Loading row: "typing never waits on
 * a fetch". Account and the category grid (host-owned per the component
 * doc's States table — the component itself "renders nothing" for loading)
 * are skeletons; `.cat-cell-skeleton` is reused verbatim from
 * `screens/categories.ts`'s own 8-cell loading grid, same shape. */
function renderSkeleton(amountInput: string): string {
  const cells = Array.from({ length: 8 }, () => `<div class="cat-cell-skeleton"></div>`).join("");
  return `<div class="add-expense-skeleton" data-testid="loading">
    <div class="card field">
      <input class="amount-input" data-testid="amount-input" inputmode="decimal" autofocus
        value="${escapeHtml(amountInput)}" placeholder="0.00" />
      <div class="currency-suffix-skeleton" data-testid="currency-skeleton"></div>
    </div>
    <div class="account-field">
      <div class="account-label">Account</div>
      <div class="account-name-skeleton" data-testid="account-skeleton"></div>
    </div>
    <div class="cp-label">Categories</div>
    <div class="cp-grid" data-testid="category-grid-skeleton">${cells}</div>
    <div class="chips-skeleton"></div>
  </div>`;
}

function renderError(message: string): string {
  return `<div class="add-expense-error" data-testid="error">
    <p>${escapeHtml(message)}</p>
    <button type="button" data-action="retry">Try again</button>
  </div>`;
}

function renderForbidden(): string {
  return `<div class="add-expense-readonly" data-testid="forbidden">
    <p>You don't have permission to add expenses.</p>
  </div>`;
}

function renderEmpty(): string {
  return `<div class="add-expense-empty" data-testid="empty">
    <p>Add a category first — every expense needs one.</p>
  </div>`;
}

export function renderAddExpense(state: AddExpenseLoadState, draft: Draft = emptyDraft()): string {
  switch (state.status) {
    case "loading":
      return renderSkeleton(draft.amountInput);
    case "error":
      return renderError(state.message);
    case "forbidden":
      return renderForbidden();
    case "empty":
      return renderEmpty();
    case "ready":
      return renderForm(state, draft);
    case "offline":
      return renderForm(state, draft, { lastSyncedAt: state.lastSyncedAt });
  }
}

// -- mount (DOM glue; not meaningfully unit-testable under Node, same
//    accepted gap as home.ts::mount) ---------------------------------------

export interface AddExpenseHandlers {
  onRetry: () => void;
  onClose: () => void;
  onSuccess: () => void;
  /** "More" cell tap (docs/ui/components/category-picker.md) — navigates to
   * screen 06 (Categories). Carries the current draft so the host (main.ts)
   * can restore amount/tags/comment on return; `categoryId` is deliberately
   * not preserved — the whole point of "More" is to pick a new category. */
  onMore: (draft: Draft) => void;
  /** "+ Add tag" chip tap (screen doc's Tags region, U3.4) — navigates to
   * screen 07 (Tags). Carries the current draft, same shape as `onMore`; a
   * tag created there returns pre-selected by main.ts appending its id to
   * `tagIds` before re-mounting this screen (AC — "the rest of the draft
   * intact"). */
  onAddTag: (draft: Draft) => void;
}

export function mount(
  root: HTMLElement,
  state: AddExpenseLoadState,
  api: AddExpenseApi,
  handlers: AddExpenseHandlers,
  initialDraft: Draft = emptyDraft(),
  // U1.4's hook, screen 02b: `initialExpense` non-null iff `mode === "edit"`,
  // enforced by `createController`'s own guard below, not re-checked here.
  mode: AddExpenseMode = "create",
  initialExpense: ExpenseResponse | null = null,
): void {
  if (typeof document === "undefined") {
    return;
  }
  // `mount` is called twice per open (main.ts renders "loading" synchronously,
  // then awaits `loadAddExpenseData` and renders again) — the amount field is
  // live and focused from the first call (AC: focused before any network call
  // resolves), so whatever the user already typed into it must survive the
  // second call's full re-render, not just `initialDraft`'s stale value.
  const priorAmount = root.querySelector<HTMLInputElement>('[data-testid="amount-input"]')?.value;
  const seedDraft: Draft = { ...initialDraft, amountInput: priorAmount ?? initialDraft.amountInput };

  root.innerHTML = renderAddExpense(state, seedDraft);
  root.querySelector('[data-action="retry"]')?.addEventListener("click", handlers.onRetry);

  // Screen 02b's Viewport section: unlike screen 02, the amount field is
  // never auto-focused here — the keypad opening over a form the user came
  // to *read* is unhelpful when they may only be changing a tag or the date.
  const autofocusAmount = mode !== "edit";

  if (state.status === "loading") {
    setBackButtonHandler(() => handlers.onClose());
    mainButton.hide();
    if (autofocusAmount) {
      root.querySelector<HTMLInputElement>('[data-testid="amount-input"]')?.focus();
    }
    return;
  }

  if (state.status !== "ready" && state.status !== "offline") {
    setBackButtonHandler(() => handlers.onClose());
    mainButton.hide();
    return;
  }

  const data: AddExpenseFormData = state;
  const lastSyncedAt = state.status === "offline" ? state.lastSyncedAt : undefined;
  const controller = createController(api, data.categories, data.currency, seedDraft, mode, initialExpense, data.today);

  const applyChrome = (): void => {
    if (mode === "edit" && initialExpense) {
      applyEditExpenseChrome(controller.getDraft(), initialExpense, data.today);
    } else {
      applyAddExpenseChrome(controller.getDraft(), controller.getCategories(), data.currency);
    }
  };

  // Screen 02b's own dirty check and discard copy (U1.4) — see
  // `wireBackButton`'s doc comment for why one function serves both screens.
  const wireBack = (): void => {
    if (mode === "edit" && initialExpense) {
      wireBackButton(controller.getDraft, handlers.onClose, {
        isDirtyFn: (d) => isEditDirty(d, initialExpense, data.today),
        message: "Discard changes?",
      });
    } else {
      wireBackButton(controller.getDraft, handlers.onClose);
    }
  };

  // Calendar button's sheet (U1.8's picker, `single` mode). BackButton closes
  // the picker, not the screen (AC) — the same nested-BackButton pattern
  // `screens/home.ts::openPicker` uses for the range variant, except the
  // close restores the form's own dirty-check BackButton handler
  // (`wireBackButton`) rather than `null`, since add-expense's BackButton is
  // never null while the form is mounted.
  const openDatePicker = (value: string, onPick: (date: string) => void): void => {
    const pickerRoot = document.createElement("div");
    root.appendChild(pickerRoot);

    const close = (): void => {
      pickerRoot.remove();
      wireBack();
    };
    setBackButtonHandler(close);

    mountDateRangePicker(pickerRoot, {
      mode: "single",
      value: { start: value, end: value },
      maxDate: data.today,
      // Inert in `single` mode — no summary/footer render, so no length
      // validity check ever surfaces (component doc's Variants table).
      maxRangeDays: 1,
      onChange: () => {},
      onApply: (range) => {
        close();
        onPick(range.start);
      },
      onCancel: close,
    });
  };

  const wireForm = (): void => {
    const amountInput = root.querySelector<HTMLInputElement>('[data-testid="amount-input"]');
    amountInput?.addEventListener("input", () => {
      controller.setAmountInput(amountInput.value);
      const errorEl = root.querySelector<HTMLElement>('[data-testid="amount-error"]');
      if (errorEl) {
        errorEl.textContent = amountError(controller.getDraft().amountInput) ?? "";
      }
      applyChrome();
    });

    const pickerSlot = root.querySelector<HTMLElement>(".category-picker-slot");
    if (pickerSlot) {
      mountCategoryPicker(pickerSlot, {
        items: categoryGridItems(controller.getCategories(), controller.getDraft().categoryId),
        selectedId: controller.getDraft().categoryId,
        onSelect: (id) => {
          controller.setCategoryId(id);
          rerenderForm();
        },
        onMore: () => {
          handlers.onMore(controller.getDraft());
        },
      });
    }

    const datePills = Array.from(root.querySelectorAll<HTMLElement>("[data-date]"));
    datePills.forEach((el) => {
      el.addEventListener("click", () => {
        haptics.selection();
        const date = el.dataset.date!;
        controller.setSpentAt(date === data.today ? null : date);
        rerenderForm();
      });
    });

    root.querySelector<HTMLElement>('[data-testid="date-row"] .date-pills')?.addEventListener("keydown", (e) => {
      const from = datePills.indexOf(document.activeElement as HTMLElement);
      if (from === -1) {
        return;
      }
      const nextIndex = nextDatePillFocusIndex(datePills.length, from, e.key);
      if (nextIndex === from) {
        return;
      }
      e.preventDefault();
      datePills[nextIndex]?.focus();
    });

    root.querySelector('[data-testid="date-calendar-button"]')?.addEventListener("click", () => {
      openDatePicker(controller.getDraft().spentAt ?? data.today, (date) => {
        controller.setSpentAt(date === data.today ? null : date);
        rerenderForm();
      });
    });

    root.querySelectorAll<HTMLElement>("[data-tag-id]").forEach((el) => {
      el.addEventListener("click", () => {
        haptics.selection();
        controller.toggleTag(el.dataset.tagId as Uuid);
        rerenderForm();
      });
    });

    root.querySelector('[data-testid="tag-add-chip"]')?.addEventListener("click", () => {
      handlers.onAddTag(controller.getDraft());
    });

    const commentInput = root.querySelector<HTMLTextAreaElement>('[data-testid="comment-input"]');
    commentInput?.addEventListener("input", () => {
      controller.setComment(commentInput.value);
    });
    // AC: focusing the comment field scrolls it clear of the keyboard.
    // `getBoundingClientRect()` is viewport-relative, matching
    // `getViewportStableHeight()`'s coordinate space.
    commentInput?.addEventListener("focus", () => {
      const offset = commentScrollOffset(commentInput.getBoundingClientRect().bottom, getViewportStableHeight());
      if (offset > 0) {
        window.scrollBy({ top: offset, behavior: "smooth" });
      }
    });
  };

  const rerenderForm = (submitError?: string | null): void => {
    const container = root.querySelector<HTMLElement>('[data-testid="add-expense-form"]');
    if (!container) {
      return;
    }
    container.outerHTML = renderForm(
      { ...data, categories: controller.getCategories() },
      controller.getDraft(),
      { submitError, lastSyncedAt },
    );
    wireForm();
    applyChrome();
  };

  wireForm();
  applyChrome();
  wireBack();

  mainButton.onClick(() => {
    void (async () => {
      const outcome = await controller.submit();
      if (outcome.status === "success") {
        haptics.notification("success");
        handlers.onSuccess();
      } else if (outcome.status === "error") {
        rerenderForm(outcome.message);
      }
      // "blocked" is the double-submit guard itself firing — the button was
      // already disabled, or this is a duplicate tap; no UI change needed.
    })();
  });

  if (autofocusAmount) {
    root.querySelector<HTMLInputElement>('[data-testid="amount-input"]')?.focus();
  }
}
