import { describe, expect, it, vi } from "vitest";
import type { Mock } from "vitest";
import { ForbiddenError, RetryableError } from "../src/api/client";
import type { CategoryResponse, CategoryTotal } from "../src/api/types";
import {
  applyCategoriesChrome,
  applyCategoryDeleteOutcome,
  applyCategoryFormChrome,
  buildCategoriesData,
  categoryDeleteConfirmMessage,
  categoryDeleteFailureMessage,
  categoryDeleteOutcomeKind,
  categoryDeleteTriggerLabel,
  categoryDuplicateWarning,
  categoryFormDraftFromRow,
  categoryFormMainButtonEnabled,
  categoryNameError,
  createCategoryFormController,
  createMemoryCache,
  emptyCategoryFormDraft,
  GRID_COLUMNS,
  isCategoryFormDirty,
  loadCategories,
  nextGridFocusIndex,
  renderCategories,
  renderCategoriesView,
  renderCategoryForm,
  revertCategoryDeleteOutcome,
  wireCategoryFormBackButton,
  type CategoriesApi,
  type CategoriesCache,
  type CategoriesData,
  type CategoryFormApi,
} from "../src/screens/categories";
import type { TelegramWebApp } from "../src/lib/telegram";

function category(id: string, name: string, overrides: Partial<CategoryResponse> = {}): CategoryResponse {
  return {
    id,
    name,
    account_id: "acc-1",
    created_at: "2026-01-01T00:00:00Z",
    is_active: true,
    expense_count: 0,
    ...overrides,
  };
}

function total(categoryId: string, minor: number): CategoryTotal {
  return { category_id: categoryId, total: minor };
}

const CATEGORIES: CategoryResponse[] = [
  category("cat-groceries", "Groceries", { created_at: "2026-01-01T00:00:00Z", expense_count: 12, color_slot: 1 }),
  category("cat-transport", "Transport", { created_at: "2026-01-02T00:00:00Z", expense_count: 5, color_slot: 2 }),
];

// -- buildCategoriesData ------------------------------------------------------

describe("buildCategoriesData", () => {
  it("builds active rows with colour, expense count and this-month total", () => {
    const data = buildCategoriesData({
      categories: CATEGORIES,
      monthTotals: [total("cat-groceries", 34000), total("cat-transport", 8000)],
      currency: "EUR",
    });
    expect(data.active).toEqual([
      { id: "cat-groceries", name: "Groceries", colorVar: "var(--category-slot-1)", colorSlot: 1, expenseCount: 12, monthTotalMinor: 34000 },
      { id: "cat-transport", name: "Transport", colorVar: "var(--category-slot-2)", colorSlot: 2, expenseCount: 5, monthTotalMinor: 8000 },
    ]);
    expect(data.archived).toEqual([]);
  });

  it("defaults a category absent from the by-category response to a 0 month total, not an error", () => {
    const data = buildCategoriesData({
      categories: CATEGORIES,
      monthTotals: [total("cat-groceries", 34000)], // transport has no expenses this month
      currency: "EUR",
    });
    expect(data.active.find((r) => r.id === "cat-transport")).toMatchObject({ monthTotalMinor: 0, expenseCount: 5 });
  });

  it("splits archived categories (is_active: false) into their own list", () => {
    const withArchived = [
      ...CATEGORIES,
      category("cat-old", "Old category", { created_at: "2026-01-03T00:00:00Z", is_active: false, expense_count: 3, color_slot: 3 }),
    ];
    const data = buildCategoriesData({ categories: withArchived, monthTotals: [], currency: "EUR" });
    expect(data.active).toHaveLength(2);
    expect(data.archived).toEqual([
      { id: "cat-old", name: "Old category", colorVar: "var(--category-slot-3)", colorSlot: 3, expenseCount: 3, monthTotalMinor: 0 },
    ]);
  });

  it("falls back to the position rule for a null colour slot, counting archived categories in the position order", () => {
    const mixed = [
      category("cat-a", "A", { created_at: "2026-01-01T00:00:00Z", is_active: false, color_slot: null }),
      category("cat-b", "B", { created_at: "2026-01-02T00:00:00Z", color_slot: null }),
    ];
    const data = buildCategoriesData({ categories: mixed, monthTotals: [], currency: "EUR" });
    expect(data.archived[0]).toMatchObject({ colorVar: "var(--category-slot-1)" });
    expect(data.active[0]).toMatchObject({ colorVar: "var(--category-slot-2)" });
  });
});

// -- delete/hide (screen 06c) --------------------------------------------------

describe("categoryDeleteOutcomeKind", () => {
  it("is 'deleted' for zero expenses and 'archived' for any usage", () => {
    expect(categoryDeleteOutcomeKind(0)).toBe("deleted");
    expect(categoryDeleteOutcomeKind(1)).toBe("archived");
    expect(categoryDeleteOutcomeKind(42)).toBe("archived");
  });
});

describe("categoryDeleteTriggerLabel", () => {
  it("reads 'Delete category' with zero expenses, 'Hide category' otherwise", () => {
    expect(categoryDeleteTriggerLabel(0)).toBe("Delete category");
    expect(categoryDeleteTriggerLabel(1)).toBe("Hide category");
    expect(categoryDeleteTriggerLabel(12)).toBe("Hide category");
  });
});

describe("categoryDeleteConfirmMessage", () => {
  it("names a plain delete for zero expenses", () => {
    expect(categoryDeleteConfirmMessage({ name: "Groceries", expenseCount: 0, isLastActive: false })).toBe(
      "Delete Groceries?",
    );
  });

  it("uses singular phrasing for exactly one expense", () => {
    expect(categoryDeleteConfirmMessage({ name: "Groceries", expenseCount: 1, isLastActive: false })).toBe(
      "Hide Groceries? 1 expense keeps it for reports.",
    );
  });

  it("uses plural phrasing for more than one expense, matching mini-app-ux.md's example verbatim", () => {
    expect(categoryDeleteConfirmMessage({ name: "Groceries", expenseCount: 42, isLastActive: false })).toBe(
      "Hide Groceries? 42 expenses keep it for reports.",
    );
  });

  it("appends the last-remaining-category warning regardless of branch", () => {
    expect(categoryDeleteConfirmMessage({ name: "Groceries", expenseCount: 0, isLastActive: true })).toBe(
      "Delete Groceries? This is your only category — new expenses will have nowhere to go.",
    );
    expect(categoryDeleteConfirmMessage({ name: "Groceries", expenseCount: 3, isLastActive: true })).toBe(
      "Hide Groceries? 3 expenses keep it for reports. This is your only category — new expenses will have nowhere to go.",
    );
  });
});

describe("categoryDeleteFailureMessage", () => {
  it("names the category and the branch that failed", () => {
    expect(categoryDeleteFailureMessage("Groceries", 0)).toBe("Couldn't delete Groceries.");
    expect(categoryDeleteFailureMessage("Groceries", 5)).toBe("Couldn't hide Groceries.");
  });
});

describe("applyCategoryDeleteOutcome", () => {
  const data: CategoriesData = {
    currency: "EUR",
    active: [
      { id: "cat-groceries", name: "Groceries", colorVar: "var(--category-slot-1)", colorSlot: 1, expenseCount: 12, monthTotalMinor: 34000 },
      { id: "cat-transport", name: "Transport", colorVar: "var(--category-slot-2)", colorSlot: 2, expenseCount: 0, monthTotalMinor: 0 },
    ],
    archived: [],
  };

  it("removes the row from active for a 'deleted' outcome, without adding it to archived", () => {
    const next = applyCategoryDeleteOutcome(data, "cat-transport", "deleted");
    expect(next.active.map((r) => r.id)).toEqual(["cat-groceries"]);
    expect(next.archived).toEqual([]);
  });

  it("moves the row from active to archived for an 'archived' outcome", () => {
    const next = applyCategoryDeleteOutcome(data, "cat-groceries", "archived");
    expect(next.active.map((r) => r.id)).toEqual(["cat-transport"]);
    expect(next.archived.map((r) => r.id)).toEqual(["cat-groceries"]);
  });

  it("is a no-op when the id isn't among the active rows", () => {
    expect(applyCategoryDeleteOutcome(data, "cat-missing", "deleted")).toEqual(data);
  });

  it("never mutates the input data (pure)", () => {
    const before = JSON.parse(JSON.stringify(data));
    applyCategoryDeleteOutcome(data, "cat-groceries", "archived");
    expect(data).toEqual(before);
  });
});

describe("revertCategoryDeleteOutcome", () => {
  const groceries = { id: "cat-groceries", name: "Groceries", colorVar: "var(--category-slot-1)", colorSlot: 1, expenseCount: 12, monthTotalMinor: 34000 };

  it("reinserts a hard-deleted row back into active", () => {
    const data: CategoriesData = { currency: "EUR", active: [], archived: [] };
    const next = revertCategoryDeleteOutcome(data, groceries, "deleted");
    expect(next.active).toEqual([groceries]);
    expect(next.archived).toEqual([]);
  });

  it("moves an archived row back to active, removing it from archived", () => {
    const data: CategoriesData = { currency: "EUR", active: [], archived: [groceries] };
    const next = revertCategoryDeleteOutcome(data, groceries, "archived");
    expect(next.active).toEqual([groceries]);
    expect(next.archived).toEqual([]);
  });

  it("composes on top of an unrelated concurrent change instead of clobbering it", () => {
    // A second category was hidden while this one's delete was still in
    // flight — the revert must not undo that unrelated change.
    const transport = { id: "cat-transport", name: "Transport", colorVar: "var(--category-slot-2)", colorSlot: 2, expenseCount: 0, monthTotalMinor: 0 };
    const dataAfterUnrelatedHide: CategoriesData = { currency: "EUR", active: [], archived: [transport] };
    const next = revertCategoryDeleteOutcome(dataAfterUnrelatedHide, groceries, "deleted");
    expect(next.active).toEqual([groceries]);
    expect(next.archived).toEqual([transport]);
  });

  it("never mutates the input data (pure)", () => {
    const data: CategoriesData = { currency: "EUR", active: [], archived: [groceries] };
    const before = JSON.parse(JSON.stringify(data));
    revertCategoryDeleteOutcome(data, groceries, "archived");
    expect(data).toEqual(before);
  });
});

// -- loadCategories ------------------------------------------------------------

function fakeApi(overrides: Partial<CategoriesApi> = {}): CategoriesApi {
  return {
    getMe: vi.fn().mockResolvedValue({ currency: "EUR" }),
    listCategories: vi.fn().mockResolvedValue(CATEGORIES),
    statisticsByCategory: vi.fn().mockResolvedValue([total("cat-groceries", 34000), total("cat-transport", 8000)]),
    ...overrides,
  };
}

describe("loadCategories", () => {
  it("resolves ready from a successful fetch, requesting usage and archived rows", async () => {
    const cache = createMemoryCache();
    const api = fakeApi();
    const state = await loadCategories(api, cache);
    expect(state.status).toBe("ready");
    expect(api.listCategories).toHaveBeenCalledWith({ includeUsage: true, includeArchived: true });
    if (state.status !== "ready") throw new Error("expected ready");
    expect(state.active).toHaveLength(2);
  });

  it("resolves forbidden on a 403", async () => {
    const cache = createMemoryCache();
    const state = await loadCategories(fakeApi({ getMe: vi.fn().mockRejectedValue(new ForbiddenError()) }), cache);
    expect(state).toEqual({ status: "forbidden" });
  });

  it("resolves error with no cache on a network failure", async () => {
    const cache = createMemoryCache();
    const state = await loadCategories(fakeApi({ getMe: vi.fn().mockRejectedValue(new RetryableError()) }), cache);
    expect(state.status).toBe("error");
  });

  it("falls back to a cached snapshot as offline on a later failure", async () => {
    const cache: CategoriesCache = createMemoryCache();
    const first = await loadCategories(fakeApi(), cache);
    expect(first.status).toBe("ready");

    const failingApi = fakeApi({ getMe: vi.fn().mockRejectedValue(new RetryableError()) });
    const second = await loadCategories(failingApi, cache);
    expect(second.status).toBe("offline");
    if (second.status !== "offline") throw new Error("expected offline");
    expect(second.active).toHaveLength(2);
  });
});

// -- renderCategories / renderCategoriesView ---------------------------------

describe("renderCategories", () => {
  it("renders 8 skeleton cells while loading", () => {
    const html = renderCategories({ status: "loading" });
    expect(html).toContain('data-testid="loading"');
    expect(html.match(/cat-cell-skeleton/g)).toHaveLength(8);
  });

  it("renders the error state with a retry affordance", () => {
    const html = renderCategories({ status: "error", message: "Backend unreachable" });
    expect(html).toContain("Backend unreachable");
    expect(html).toContain('data-action="retry"');
  });

  it("renders the read-only message on forbidden, with no Add-category cell", () => {
    const html = renderCategories({ status: "forbidden" });
    expect(html).toContain("read-only access");
    expect(html).not.toContain('data-testid="cat-cell-add"');
  });

  it("renders every active category as a grid cell plus the Add-category cell", () => {
    const data = buildCategoriesData({
      categories: CATEGORIES,
      monthTotals: [total("cat-groceries", 34000), total("cat-transport", 8000)],
      currency: "EUR",
    });
    const html = renderCategories({ status: "ready", ...data });
    expect(html.match(/data-testid="cat-cell"/g)).toHaveLength(2);
    expect(html).toContain('data-testid="cat-cell-add"');
    expect(html).toContain("Groceries");
    expect(html).toContain("12 · 340.00");
    expect(html).toContain("Transport");
    expect(html).toContain("5 · 80.00");
  });

  it("gives each active cell an aria-label with the name, count and this-month total, and hides the visual spans from AT", () => {
    const data = buildCategoriesData({
      categories: CATEGORIES,
      monthTotals: [total("cat-groceries", 34000)],
      currency: "EUR",
    });
    const html = renderCategories({ status: "ready", ...data });
    expect(html).toContain('aria-label="Groceries, 12 expenses, 340.00 this month"');
    expect(html).toContain('aria-label="Transport, 5 expenses, 0.00 this month"');
    expect(html).toContain('class="cat-cell-name" aria-hidden="true"');
    expect(html).toContain('class="cat-cell-caption" aria-hidden="true"');
  });

  it("uses singular 'expense' in the aria-label for a count of exactly 1", () => {
    const one = [category("cat-one", "Solo", { expense_count: 1 })];
    const data = buildCategoriesData({ categories: one, monthTotals: [], currency: "EUR" });
    const html = renderCategories({ status: "ready", ...data });
    expect(html).toContain('aria-label="Solo, 1 expense, 0.00 this month"');
    expect(html).not.toContain("1 expenses");
  });

  it("never renders --accent — the Add-category cell is grey, not yellow", () => {
    const data = buildCategoriesData({ categories: CATEGORIES, monthTotals: [], currency: "EUR" });
    const html = renderCategories({ status: "ready", ...data });
    expect(html).not.toContain("var(--accent)");
  });

  it("shows 'No categories yet' plus the Add-category cell when there are zero active categories", () => {
    const data = buildCategoriesData({ categories: [], monthTotals: [], currency: "EUR" });
    const html = renderCategories({ status: "ready", ...data });
    expect(html).toContain("No categories yet");
    expect(html).toContain('data-testid="cat-cell-add"');
  });

  it("omits the archived section entirely when nothing is archived", () => {
    const data = buildCategoriesData({ categories: CATEGORIES, monthTotals: [], currency: "EUR" });
    const html = renderCategories({ status: "ready", ...data });
    expect(html).not.toContain('data-testid="cat-archived"');
  });

  it("shows a collapsed archived header without the explanation or rows by default", () => {
    const withArchived = [...CATEGORIES, category("cat-old", "Old category", { is_active: false, expense_count: 3 })];
    const data = buildCategoriesData({ categories: withArchived, monthTotals: [], currency: "EUR" });
    const html = renderCategoriesView({ data, archivedExpanded: false });
    expect(html).toContain("Archived (1)");
    expect(html).not.toContain("keep their history");
    expect(html).not.toContain('data-testid="cat-archived-row"');
  });

  it("expands to show the explanation and archived rows", () => {
    const withArchived = [...CATEGORIES, category("cat-old", "Old category", { is_active: false, expense_count: 3 })];
    const data = buildCategoriesData({ categories: withArchived, monthTotals: [], currency: "EUR" });
    const html = renderCategoriesView({ data, archivedExpanded: true });
    expect(html).toContain("keep their history");
    expect(html).toContain('data-testid="cat-archived-row"');
    expect(html).toContain("Old category");
  });

  it("renders the archived toggle with aria-expanded reflecting its state", () => {
    const withArchived = [...CATEGORIES, category("cat-old", "Old category", { is_active: false, expense_count: 3 })];
    const data = buildCategoriesData({ categories: withArchived, monthTotals: [], currency: "EUR" });
    expect(renderCategoriesView({ data, archivedExpanded: false })).toContain('aria-expanded="false"');
    expect(renderCategoriesView({ data, archivedExpanded: true })).toContain('aria-expanded="true"');
  });

  it("makes an archived row focusable (role=button, tabindex=0) with its own aria-label, since it's still a stub the user can tab to", () => {
    const withArchived = [...CATEGORIES, category("cat-old", "Old category", { is_active: false, expense_count: 3 })];
    const data = buildCategoriesData({ categories: withArchived, monthTotals: [], currency: "EUR" });
    const html = renderCategoriesView({ data, archivedExpanded: true });
    expect(html).toContain('role="button"');
    expect(html).toContain('tabindex="0"');
    expect(html).toContain('aria-label="Old category, 3 expenses, 0.00 this month"');
  });

  it("renders the offline banner with the last-synced marker", () => {
    const data = buildCategoriesData({ categories: CATEGORIES, monthTotals: [], currency: "EUR" });
    const html = renderCategories({ status: "offline", lastSyncedAt: "2026-08-02T09:00:00Z", ...data });
    expect(html).toContain('data-testid="offline"');
    expect(html).toContain("2026-08-02T09:00:00Z");
  });

  // -- delete-failure banner (screen 06c) --------------------------------

  it("renders a retryable delete-failure banner with a Try again action", () => {
    const data = buildCategoriesData({ categories: CATEGORIES, monthTotals: [], currency: "EUR" });
    const html = renderCategories(
      { status: "ready", ...data },
      false,
      { categoryId: "cat-groceries", message: "Couldn't delete Groceries.", retryable: true },
    );
    expect(html).toContain('data-testid="cat-delete-failed"');
    expect(html).toContain("Couldn't delete Groceries.");
    expect(html).toContain('data-action="retry-delete" data-category-id="cat-groceries"');
  });

  it("omits the Try again action for a non-retryable (403) delete failure", () => {
    const data = buildCategoriesData({ categories: CATEGORIES, monthTotals: [], currency: "EUR" });
    const html = renderCategories(
      { status: "ready", ...data },
      false,
      { categoryId: "cat-groceries", message: "You have read-only access to this account.", retryable: false },
    );
    expect(html).toContain("read-only access");
    expect(html).not.toContain('data-action="retry-delete"');
  });

  it("shows no delete-failure banner when none is passed", () => {
    const data = buildCategoriesData({ categories: CATEGORIES, monthTotals: [], currency: "EUR" });
    const html = renderCategories({ status: "ready", ...data });
    expect(html).not.toContain('data-testid="cat-delete-failed"');
  });
});

// -- nextGridFocusIndex --------------------------------------------------------

describe("nextGridFocusIndex", () => {
  it("moves right/left by one, wrapping at the ends of the whole cell list", () => {
    expect(nextGridFocusIndex(7, 0, "ArrowRight")).toBe(1);
    expect(nextGridFocusIndex(7, 6, "ArrowRight")).toBe(0);
    expect(nextGridFocusIndex(7, 0, "ArrowLeft")).toBe(6);
    expect(nextGridFocusIndex(7, 3, "ArrowLeft")).toBe(2);
  });

  it("moves down/up by a full row (GRID_COLUMNS)", () => {
    expect(GRID_COLUMNS).toBe(4);
    expect(nextGridFocusIndex(8, 0, "ArrowDown")).toBe(4);
    expect(nextGridFocusIndex(8, 4, "ArrowUp")).toBe(0);
  });

  it("wraps down from the bottom row and up from the top row", () => {
    expect(nextGridFocusIndex(8, 6, "ArrowDown")).toBe(2);
    expect(nextGridFocusIndex(8, 1, "ArrowUp")).toBe(5);
  });

  it("stays in place for a ragged last row (fewer than GRID_COLUMNS cells) rather than going out of bounds", () => {
    // 7 cells: row0 = [0,1,2,3], row1 = [4,5,6] (only 3 wide).
    const next = nextGridFocusIndex(7, 3, "ArrowDown");
    expect(next).toBeGreaterThanOrEqual(0);
    expect(next).toBeLessThan(7);
  });

  it("returns the same index for a key it doesn't handle, and for an empty grid", () => {
    expect(nextGridFocusIndex(5, 2, "Tab")).toBe(2);
    expect(nextGridFocusIndex(0, 0, "ArrowRight")).toBe(0);
  });
});

// -- applyCategoriesChrome ----------------------------------------------------

function fakeWebApp(overrides: Partial<TelegramWebApp> = {}): TelegramWebApp {
  return {
    initData: "user=fake&hash=abc",
    colorScheme: "light",
    expand: vi.fn(),
    MainButton: {
      setText: vi.fn(),
      show: vi.fn(),
      hide: vi.fn(),
      enable: vi.fn(),
      disable: vi.fn(),
      onClick: vi.fn(),
      offClick: vi.fn(),
    },
    BackButton: {
      show: vi.fn(),
      hide: vi.fn(),
      onClick: vi.fn(),
      offClick: vi.fn(),
    },
    HapticFeedback: {
      impactOccurred: vi.fn(),
      notificationOccurred: vi.fn(),
      selectionChanged: vi.fn(),
    },
    showConfirm: vi.fn(),
    ...overrides,
  };
}

function installWebApp(webApp: TelegramWebApp): void {
  (globalThis as { window?: Window }).window = { Telegram: { WebApp: webApp } } as unknown as Window;
}

describe("applyCategoriesChrome", () => {
  it("wires BackButton and hides MainButton (the Add-category cell is the add affordance, not MainButton)", () => {
    const webApp = fakeWebApp();
    installWebApp(webApp);
    const onBack = vi.fn();
    applyCategoriesChrome(onBack);
    expect(webApp.BackButton.onClick).toHaveBeenCalled();
    expect(webApp.BackButton.show).toHaveBeenCalled();
    expect(webApp.MainButton.hide).toHaveBeenCalled();
    delete (globalThis as { window?: Window }).window;
  });
});

// -- form (screen 06b) --------------------------------------------------------

function categoryRow(overrides: Partial<Parameters<typeof categoryFormDraftFromRow>[0]> = {}) {
  return { id: "cat-groceries", name: "Groceries", colorSlot: 3, ...overrides };
}

describe("emptyCategoryFormDraft / categoryFormDraftFromRow", () => {
  it("create mode starts with no id, empty name, no slot", () => {
    expect(emptyCategoryFormDraft()).toEqual({ id: null, name: "", colorSlot: null });
  });

  it("edit mode seeds the draft from the row's raw id/name/colorSlot", () => {
    expect(categoryFormDraftFromRow(categoryRow())).toEqual({
      id: "cat-groceries",
      name: "Groceries",
      colorSlot: 3,
    });
  });

  it("a null colorSlot (position-fallback only) stays null in the draft, not the resolved slot", () => {
    expect(categoryFormDraftFromRow(categoryRow({ colorSlot: null }))).toEqual({
      id: "cat-groceries",
      name: "Groceries",
      colorSlot: null,
    });
  });
});

describe("isCategoryFormDirty", () => {
  const original = { id: "cat-1", name: "Groceries", colorSlot: 3 };

  it("is false when nothing changed", () => {
    expect(isCategoryFormDirty({ ...original }, original)).toBe(false);
  });

  it("ignores leading/trailing whitespace-only name changes", () => {
    expect(isCategoryFormDirty({ ...original, name: "  Groceries  " }, original)).toBe(false);
  });

  it("is true when the trimmed name changes", () => {
    expect(isCategoryFormDirty({ ...original, name: "Food" }, original)).toBe(true);
  });

  it("is true when the colour slot changes", () => {
    expect(isCategoryFormDirty({ ...original, colorSlot: 7 }, original)).toBe(true);
  });
});

describe("categoryNameError", () => {
  it("rejects an empty or whitespace-only name", () => {
    expect(categoryNameError("")).toBe("Give this category a name.");
    expect(categoryNameError("   ")).toBe("Give this category a name.");
  });

  it("accepts any non-blank name", () => {
    expect(categoryNameError("Groceries")).toBeNull();
  });
});

describe("categoryDuplicateWarning", () => {
  const siblings = [
    { id: "cat-1", name: "Groceries" },
    { id: "cat-2", name: "Transport" },
  ];

  it("warns on a case-insensitive match against another active category", () => {
    expect(categoryDuplicateWarning("groceries", "cat-new", siblings)).toBe(
      'Another category is already named "groceries".',
    );
  });

  it("does not warn against its own current name (editing without renaming)", () => {
    expect(categoryDuplicateWarning("Groceries", "cat-1", siblings)).toBeNull();
  });

  it("does not warn on a unique name", () => {
    expect(categoryDuplicateWarning("Subscriptions", "cat-new", siblings)).toBeNull();
  });

  it("is null while the name is blank — the empty-name error takes priority instead", () => {
    expect(categoryDuplicateWarning("   ", "cat-new", siblings)).toBeNull();
  });
});

describe("categoryFormMainButtonEnabled", () => {
  const original = emptyCategoryFormDraft();

  it("is disabled on a clean (unmodified) draft", () => {
    expect(categoryFormMainButtonEnabled({ ...original }, original)).toBe(false);
  });

  it("is enabled once dirty, even with a blank name — submit() is what blocks that case", () => {
    expect(categoryFormMainButtonEnabled({ ...original, colorSlot: 5 }, original)).toBe(true);
  });
});

function fakeCategoryFormApi(overrides: Partial<CategoryFormApi> = {}): CategoryFormApi {
  return {
    createCategory: vi.fn().mockResolvedValue({ id: "cat-new", name: "Groceries", account_id: "acc-1", created_at: "2026-01-01T00:00:00Z" }),
    updateCategory: vi.fn().mockResolvedValue({ id: "cat-1", name: "Food", account_id: "acc-1", created_at: "2026-01-01T00:00:00Z" }),
    ...overrides,
  };
}

describe("createCategoryFormController", () => {
  it("is blocked (reason: invalid) on a clean draft — nothing to save", async () => {
    const api = fakeCategoryFormApi();
    const controller = createCategoryFormController(api, emptyCategoryFormDraft());

    const outcome = await controller.submit();

    expect(outcome).toEqual({ status: "blocked", reason: "invalid" });
    expect(api.createCategory).not.toHaveBeenCalled();
  });

  it("is blocked (reason: invalid) when dirty but the trimmed name is blank", async () => {
    const api = fakeCategoryFormApi();
    const controller = createCategoryFormController(api, emptyCategoryFormDraft());
    controller.setColorSlot(4);

    const outcome = await controller.submit();

    expect(outcome).toEqual({ status: "blocked", reason: "invalid" });
    expect(api.createCategory).not.toHaveBeenCalled();
  });

  it("creates a category with the trimmed name and chosen slot", async () => {
    const api = fakeCategoryFormApi();
    const controller = createCategoryFormController(api, emptyCategoryFormDraft());
    controller.setName("  Groceries  ");
    controller.setColorSlot(9);

    const outcome = await controller.submit();

    expect(outcome.status).toBe("success");
    expect(api.createCategory).toHaveBeenCalledWith({ name: "Groceries", color_slot: 9 });
  });

  it("creates with color_slot null when no swatch was picked (colour is optional)", async () => {
    const api = fakeCategoryFormApi();
    const controller = createCategoryFormController(api, emptyCategoryFormDraft());
    controller.setName("Groceries");

    await controller.submit();

    expect(api.createCategory).toHaveBeenCalledWith({ name: "Groceries", color_slot: null });
  });

  it("updates an existing category by id in edit mode", async () => {
    const original = categoryFormDraftFromRow(categoryRow({ id: "cat-1", name: "Groceries", colorSlot: 3 }));
    const api = fakeCategoryFormApi();
    const controller = createCategoryFormController(api, original);
    controller.setName("Food");

    const outcome = await controller.submit();

    expect(outcome.status).toBe("success");
    expect(api.updateCategory).toHaveBeenCalledWith("cat-1", { name: "Food", color_slot: 3 });
    expect(api.createCategory).not.toHaveBeenCalled();
  });

  it("a duplicate rapid submit issues exactly one write", async () => {
    let resolveUpdate: (value: CategoryResponse) => void = () => {};
    const updateCategory = vi.fn(
      () =>
        new Promise<CategoryResponse>((resolve) => {
          resolveUpdate = resolve;
        }),
    );
    const api = fakeCategoryFormApi({ updateCategory });
    const original = categoryFormDraftFromRow(categoryRow());
    const controller = createCategoryFormController(api, original);
    controller.setName("Food");

    const first = controller.submit();
    const second = controller.submit();
    resolveUpdate({ id: "cat-1", name: "Food", account_id: "acc-1", created_at: "2026-01-01T00:00:00Z" });
    const [firstOutcome, secondOutcome] = await Promise.all([first, second]);

    expect(updateCategory).toHaveBeenCalledOnce();
    expect(firstOutcome.status).toBe("success");
    expect(secondOutcome).toEqual({ status: "blocked", reason: "submitting" });
  });

  it("maps 403 to the read-only message and preserves the draft", async () => {
    const api = fakeCategoryFormApi({ createCategory: vi.fn().mockRejectedValue(new ForbiddenError()) });
    const controller = createCategoryFormController(api, emptyCategoryFormDraft());
    controller.setName("Groceries");

    const outcome = await controller.submit();

    expect(outcome).toEqual({ status: "error", message: "You have read-only access to this account." });
    expect(controller.getDraft()).toEqual({ id: null, name: "Groceries", colorSlot: null });
  });

  it("maps a network failure to a retryable message and preserves the draft", async () => {
    const api = fakeCategoryFormApi({ createCategory: vi.fn().mockRejectedValue(new RetryableError()) });
    const controller = createCategoryFormController(api, emptyCategoryFormDraft());
    controller.setName("Groceries");

    const outcome = await controller.submit();

    expect(outcome.status).toBe("error");
    expect(controller.getDraft().name).toBe("Groceries");
  });
});

describe("renderCategoryForm", () => {
  const baseState = {
    draft: emptyCategoryFormDraft(),
    activeSiblings: [{ id: "cat-1", name: "Groceries" }],
    usedSlots: new Set<number>([1]),
    nameInteracted: false,
    submitError: null,
    expenseCount: 0,
  };

  it("renders 12 swatch cells, none checked, on an empty draft", () => {
    const html = renderCategoryForm(baseState);
    expect((html.match(/data-testid="cat-swatch"/g) ?? []).length).toBe(12);
    expect(html).not.toContain("aria-checked=\"true\"");
  });

  it("marks the selected slot's swatch aria-checked and gives it the checkmark", () => {
    const html = renderCategoryForm({ ...baseState, draft: { ...baseState.draft, colorSlot: 5 } });
    expect(html).toContain('data-slot="5" role="radio" aria-checked="true"');
    expect(html).toContain("cat-swatch-check");
  });

  it("marks an already-used slot as 'In use' but still tappable (not disabled)", () => {
    const html = renderCategoryForm(baseState);
    expect(html).toContain("Blue, in use");
    expect(html).not.toContain("disabled");
  });

  it("shows no inline message before the name field has been interacted with, even when blank", () => {
    const html = renderCategoryForm(baseState);
    expect(html).not.toContain("Give this category a name.");
  });

  it("shows the empty-name error once nameInteracted is true", () => {
    const html = renderCategoryForm({ ...baseState, nameInteracted: true });
    expect(html).toContain("Give this category a name.");
    expect(html).toContain("cat-form-message--error");
  });

  it("shows the duplicate-name warning (not the error) once interacted, for a non-blank duplicate", () => {
    const html = renderCategoryForm({
      ...baseState,
      draft: { ...baseState.draft, name: "Groceries" },
      nameInteracted: true,
    });
    expect(html).toContain("Another category is already named &quot;Groceries&quot;.");
    expect(html).toContain("cat-form-message--warning");
    expect(html).not.toContain("Give this category a name.");
  });

  it("renders a submit error banner when passed one", () => {
    const html = renderCategoryForm({ ...baseState, submitError: "Couldn't save this category." });
    expect(html).toContain('data-testid="cat-form-submit-error"');
    expect(html).toContain("Couldn't save this category.");
  });

  it("pre-fills the name input's value from the draft", () => {
    const html = renderCategoryForm({ ...baseState, draft: { ...baseState.draft, name: "Food" } });
    expect(html).toContain('value="Food"');
  });

  // -- region 5: delete/hide trigger (screen 06c) ------------------------

  it("shows no delete trigger in create mode (draft.id === null)", () => {
    const html = renderCategoryForm(baseState);
    expect(html).not.toContain('data-testid="cat-delete-trigger"');
  });

  it("shows 'Delete category' in edit mode with zero expenses", () => {
    const html = renderCategoryForm({
      ...baseState,
      draft: { id: "cat-1", name: "Groceries", colorSlot: 1 },
      expenseCount: 0,
    });
    expect(html).toContain('data-testid="cat-delete-trigger"');
    expect(html).toContain(">Delete category<");
  });

  it("shows 'Hide category' in edit mode when the category has expenses", () => {
    const html = renderCategoryForm({
      ...baseState,
      draft: { id: "cat-1", name: "Groceries", colorSlot: 1 },
      expenseCount: 12,
    });
    expect(html).toContain(">Hide category<");
    expect(html).not.toContain(">Delete category<");
  });
});

describe("applyCategoryFormChrome", () => {
  it("shows 'Save' and disables MainButton on a clean draft", () => {
    const webApp = fakeWebApp();
    installWebApp(webApp);
    const original = emptyCategoryFormDraft();
    applyCategoryFormChrome({ ...original }, original);
    expect(webApp.MainButton.setText).toHaveBeenCalledWith("Save");
    expect(webApp.MainButton.disable).toHaveBeenCalled();
    delete (globalThis as { window?: Window }).window;
  });

  it("enables MainButton once the draft is dirty", () => {
    const webApp = fakeWebApp();
    installWebApp(webApp);
    const original = emptyCategoryFormDraft();
    applyCategoryFormChrome({ ...original, name: "Groceries" }, original);
    expect(webApp.MainButton.enable).toHaveBeenCalled();
    delete (globalThis as { window?: Window }).window;
  });
});

describe("wireCategoryFormBackButton", () => {
  it("closes immediately with no confirm popup for a clean draft", () => {
    const webApp = fakeWebApp();
    installWebApp(webApp);
    const original = emptyCategoryFormDraft();
    const onClose = vi.fn();
    wireCategoryFormBackButton(() => ({ ...original }), original, onClose);
    const handler = (webApp.BackButton.onClick as Mock).mock.calls[0][0] as () => void;
    handler();
    expect(webApp.showConfirm).not.toHaveBeenCalled();
    expect(onClose).toHaveBeenCalled();
    delete (globalThis as { window?: Window }).window;
  });

  it("confirms via Telegram's popup before discarding a dirty draft", async () => {
    const webApp = fakeWebApp({ showConfirm: vi.fn((_msg, cb) => cb(true)) });
    installWebApp(webApp);
    const original = emptyCategoryFormDraft();
    const onClose = vi.fn();
    wireCategoryFormBackButton(() => ({ ...original, name: "Groceries" }), original, onClose);
    const handler = (webApp.BackButton.onClick as Mock).mock.calls[0][0] as () => void;
    handler();
    await Promise.resolve();
    await Promise.resolve();
    expect(webApp.showConfirm).toHaveBeenCalledWith("Discard changes to this category?", expect.any(Function));
    expect(onClose).toHaveBeenCalled();
    delete (globalThis as { window?: Window }).window;
  });

  it("keeps the draft when the user declines to discard", async () => {
    const webApp = fakeWebApp({ showConfirm: vi.fn((_msg, cb) => cb(false)) });
    installWebApp(webApp);
    const original = emptyCategoryFormDraft();
    const onClose = vi.fn();
    wireCategoryFormBackButton(() => ({ ...original, name: "Groceries" }), original, onClose);
    const handler = (webApp.BackButton.onClick as Mock).mock.calls[0][0] as () => void;
    handler();
    await Promise.resolve();
    await Promise.resolve();
    expect(onClose).not.toHaveBeenCalled();
    delete (globalThis as { window?: Window }).window;
  });
});
