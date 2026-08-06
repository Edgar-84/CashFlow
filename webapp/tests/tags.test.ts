import { describe, expect, it, vi } from "vitest";
import type { Mock } from "vitest";
import { ForbiddenError, RetryableError } from "../src/api/client";
import type { TagResponse, TagTotal } from "../src/api/types";
import {
  applyTagDeleteOutcome,
  applyTagFormChrome,
  applyTagsChrome,
  buildTagsData,
  createMemoryCache,
  createTagFormController,
  emptyTagFormDraft,
  isTagFormDirty,
  loadTags,
  renderTagForm,
  renderTags,
  renderTagsView,
  revertTagDeleteOutcome,
  tagDeleteConfirmMessage,
  tagDeleteFailureMessage,
  tagDeleteOutcomeKind,
  tagDeleteTriggerLabel,
  tagFormDraftFromRow,
  tagFormMainButtonEnabled,
  tagNameError,
  wireTagFormBackButton,
  type TagFormApi,
  type TagsApi,
  type TagsCache,
  type TagsData,
} from "../src/screens/tags";
import type { TelegramWebApp } from "../src/lib/telegram";

function tag(id: string, name: string, overrides: Partial<TagResponse> = {}): TagResponse {
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

function total(tagId: string, minor: number): TagTotal {
  return { tag_id: tagId, total: minor };
}

const TAGS: TagResponse[] = [
  tag("tag-vacation", "vacation", { created_at: "2026-01-01T00:00:00Z", expense_count: 12 }),
  tag("tag-work", "work", { created_at: "2026-01-02T00:00:00Z", expense_count: 5 }),
];

// -- buildTagsData ------------------------------------------------------

describe("buildTagsData", () => {
  it("builds active rows with expense count and this-month total", () => {
    const data = buildTagsData({
      tags: TAGS,
      monthTotals: [total("tag-vacation", 34000), total("tag-work", 8000)],
      currency: "EUR",
    });
    expect(data.active).toEqual([
      { id: "tag-vacation", name: "vacation", expenseCount: 12, monthTotalMinor: 34000 },
      { id: "tag-work", name: "work", expenseCount: 5, monthTotalMinor: 8000 },
    ]);
    expect(data.archived).toEqual([]);
  });

  it("defaults a tag absent from the by-tag response to a 0 month total, not an error", () => {
    const data = buildTagsData({
      tags: TAGS,
      monthTotals: [total("tag-vacation", 34000)], // work has no expenses this month
      currency: "EUR",
    });
    expect(data.active.find((r) => r.id === "tag-work")).toMatchObject({ monthTotalMinor: 0, expenseCount: 5 });
  });

  it("renders an unused tag's count as a plain 0, not an error", () => {
    const unused = [tag("tag-unused", "unused", { expense_count: 0 })];
    const data = buildTagsData({ tags: unused, monthTotals: [], currency: "EUR" });
    expect(data.active[0]).toMatchObject({ expenseCount: 0, monthTotalMinor: 0 });
  });

  it("splits archived tags (is_active: false) into their own list", () => {
    const withArchived = [
      ...TAGS,
      tag("tag-old", "old", { created_at: "2026-01-03T00:00:00Z", is_active: false, expense_count: 3 }),
    ];
    const data = buildTagsData({ tags: withArchived, monthTotals: [], currency: "EUR" });
    expect(data.active).toHaveLength(2);
    expect(data.archived).toEqual([{ id: "tag-old", name: "old", expenseCount: 3, monthTotalMinor: 0 }]);
  });

  it("orders rows by created_at ASC", () => {
    const shuffled = [TAGS[1], TAGS[0]];
    const data = buildTagsData({ tags: shuffled, monthTotals: [], currency: "EUR" });
    expect(data.active.map((r) => r.id)).toEqual(["tag-vacation", "tag-work"]);
  });
});

// -- loadTags ------------------------------------------------------------

function fakeApi(overrides: Partial<TagsApi> = {}): TagsApi {
  return {
    getMe: vi.fn().mockResolvedValue({ currency: "EUR" }),
    listTags: vi.fn().mockResolvedValue(TAGS),
    statisticsByTag: vi.fn().mockResolvedValue([total("tag-vacation", 34000), total("tag-work", 8000)]),
    ...overrides,
  };
}

describe("loadTags", () => {
  it("resolves ready from a successful fetch, requesting usage and archived rows", async () => {
    const cache = createMemoryCache();
    const api = fakeApi();
    const state = await loadTags(api, cache);
    expect(state.status).toBe("ready");
    expect(api.listTags).toHaveBeenCalledWith({ includeUsage: true, includeArchived: true });
    if (state.status !== "ready") throw new Error("expected ready");
    expect(state.active).toHaveLength(2);
  });

  it("resolves forbidden on a 403", async () => {
    const cache = createMemoryCache();
    const state = await loadTags(fakeApi({ getMe: vi.fn().mockRejectedValue(new ForbiddenError()) }), cache);
    expect(state).toEqual({ status: "forbidden" });
  });

  it("resolves error with no cache on a network failure", async () => {
    const cache = createMemoryCache();
    const state = await loadTags(fakeApi({ getMe: vi.fn().mockRejectedValue(new RetryableError()) }), cache);
    expect(state.status).toBe("error");
  });

  it("falls back to a cached snapshot as offline on a later failure", async () => {
    const cache: TagsCache = createMemoryCache();
    const first = await loadTags(fakeApi(), cache);
    expect(first.status).toBe("ready");

    const failingApi = fakeApi({ getMe: vi.fn().mockRejectedValue(new RetryableError()) });
    const second = await loadTags(failingApi, cache);
    expect(second.status).toBe("offline");
    if (second.status !== "offline") throw new Error("expected offline");
    expect(second.active).toHaveLength(2);
  });
});

// -- renderTags / renderTagsView ------------------------------------------

describe("renderTags", () => {
  it("renders 6 skeleton rows while loading", () => {
    const html = renderTags({ status: "loading" });
    expect(html).toContain('data-testid="loading"');
    expect(html.match(/tag-row-skeleton/g)).toHaveLength(6);
  });

  it("renders the error state with a retry affordance", () => {
    const html = renderTags({ status: "error", message: "Backend unreachable" });
    expect(html).toContain("Backend unreachable");
    expect(html).toContain('data-action="retry"');
  });

  it("renders the read-only message on forbidden, with no Add-tag row", () => {
    const html = renderTags({ status: "forbidden" });
    expect(html).toContain("read-only access");
    expect(html).not.toContain('data-testid="tag-row-add"');
  });

  it("renders every active tag as a row plus the Add-tag row", () => {
    const data = buildTagsData({
      tags: TAGS,
      monthTotals: [total("tag-vacation", 34000), total("tag-work", 8000)],
      currency: "EUR",
    });
    const html = renderTags({ status: "ready", ...data });
    expect(html.match(/data-testid="tag-row"/g)).toHaveLength(2);
    expect(html).toContain('data-testid="tag-row-add"');
    expect(html).toContain("vacation");
    expect(html).toContain("12 · 340.00");
    expect(html).toContain("work");
    expect(html).toContain("5 · 80.00");
  });

  it("gives each active row an aria-label with the name, count and this-month total, and hides the visual spans from AT", () => {
    const data = buildTagsData({ tags: TAGS, monthTotals: [total("tag-vacation", 34000)], currency: "EUR" });
    const html = renderTags({ status: "ready", ...data });
    expect(html).toContain('aria-label="vacation, 12 expenses, 340.00 this month"');
    expect(html).toContain('aria-label="work, 5 expenses, 0.00 this month"');
    expect(html).toContain('class="nm" aria-hidden="true"');
    expect(html).toContain('class="tag-row-caption" aria-hidden="true"');
  });

  it("uses singular 'expense' in the aria-label for a count of exactly 1", () => {
    const one = [tag("tag-one", "solo", { expense_count: 1 })];
    const data = buildTagsData({ tags: one, monthTotals: [], currency: "EUR" });
    const html = renderTags({ status: "ready", ...data });
    expect(html).toContain('aria-label="solo, 1 expense, 0.00 this month"');
    expect(html).not.toContain("1 expenses");
  });

  it("shows empty.explain plus the Add-tag row when there are zero active tags", () => {
    const data = buildTagsData({ tags: [], monthTotals: [], currency: "EUR" });
    const html = renderTags({ status: "ready", ...data });
    expect(html).toContain("Tags cut across categories");
    expect(html).toContain('data-testid="tag-row-add"');
  });

  it("omits the empty-explain note once at least one tag is active", () => {
    const data = buildTagsData({ tags: TAGS, monthTotals: [], currency: "EUR" });
    const html = renderTags({ status: "ready", ...data });
    expect(html).not.toContain("Tags cut across categories");
  });

  it("omits the archived section entirely when nothing is archived", () => {
    const data = buildTagsData({ tags: TAGS, monthTotals: [], currency: "EUR" });
    const html = renderTags({ status: "ready", ...data });
    expect(html).not.toContain('data-testid="tag-archived"');
  });

  it("shows a collapsed archived header without the explanation or rows by default", () => {
    const withArchived = [...TAGS, tag("tag-old", "old", { is_active: false, expense_count: 3 })];
    const data = buildTagsData({ tags: withArchived, monthTotals: [], currency: "EUR" });
    const html = renderTagsView({ data, archivedExpanded: false });
    expect(html).toContain("Archived (1)");
    expect(html).not.toContain("keep their history");
    expect(html).not.toContain('data-testid="tag-archived-row"');
  });

  it("expands to show the explanation and archived rows", () => {
    const withArchived = [...TAGS, tag("tag-old", "old", { is_active: false, expense_count: 3 })];
    const data = buildTagsData({ tags: withArchived, monthTotals: [], currency: "EUR" });
    const html = renderTagsView({ data, archivedExpanded: true });
    expect(html).toContain("keep their history");
    expect(html).toContain('data-testid="tag-archived-row"');
    expect(html).toContain("old");
  });

  it("renders the archived toggle with aria-expanded reflecting its state", () => {
    const withArchived = [...TAGS, tag("tag-old", "old", { is_active: false, expense_count: 3 })];
    const data = buildTagsData({ tags: withArchived, monthTotals: [], currency: "EUR" });
    expect(renderTagsView({ data, archivedExpanded: false })).toContain('aria-expanded="false"');
    expect(renderTagsView({ data, archivedExpanded: true })).toContain('aria-expanded="true"');
  });

  it("makes an archived row focusable (role=button, tabindex=0) with its own aria-label, since it's still a stub the user can tab to", () => {
    const withArchived = [...TAGS, tag("tag-old", "old", { is_active: false, expense_count: 3 })];
    const data = buildTagsData({ tags: withArchived, monthTotals: [], currency: "EUR" });
    const html = renderTagsView({ data, archivedExpanded: true });
    expect(html).toContain('role="button"');
    expect(html).toContain('tabindex="0"');
    expect(html).toContain('aria-label="old, 3 expenses, 0.00 this month"');
  });

  it("renders the offline banner with the last-synced marker", () => {
    const data = buildTagsData({ tags: TAGS, monthTotals: [], currency: "EUR" });
    const html = renderTags({ status: "offline", lastSyncedAt: "2026-08-02T09:00:00Z", ...data });
    expect(html).toContain('data-testid="offline"');
    expect(html).toContain("2026-08-02T09:00:00Z");
  });

  // -- delete-failure banner (screen 07b) --------------------------------

  it("renders a retryable delete-failure banner with a Try again action", () => {
    const data = buildTagsData({ tags: TAGS, monthTotals: [], currency: "EUR" });
    const html = renderTags(
      { status: "ready", ...data },
      false,
      { tagId: "tag-vacation", message: "Couldn't delete vacation.", retryable: true },
    );
    expect(html).toContain('data-testid="tag-delete-failed"');
    expect(html).toContain("Couldn't delete vacation.");
    expect(html).toContain('data-action="retry-delete" data-tag-id="tag-vacation"');
  });

  it("omits the Try again action for a non-retryable (403) delete failure", () => {
    const data = buildTagsData({ tags: TAGS, monthTotals: [], currency: "EUR" });
    const html = renderTags(
      { status: "ready", ...data },
      false,
      { tagId: "tag-vacation", message: "You have read-only access to this account.", retryable: false },
    );
    expect(html).toContain("read-only access");
    expect(html).not.toContain('data-action="retry-delete"');
  });

  it("shows no delete-failure banner when none is passed", () => {
    const data = buildTagsData({ tags: TAGS, monthTotals: [], currency: "EUR" });
    const html = renderTags({ status: "ready", ...data });
    expect(html).not.toContain('data-testid="tag-delete-failed"');
  });
});

// -- delete/hide (screen 07b) --------------------------------------------------

describe("tagDeleteOutcomeKind", () => {
  it("is 'deleted' for zero expenses and 'archived' for any usage", () => {
    expect(tagDeleteOutcomeKind(0)).toBe("deleted");
    expect(tagDeleteOutcomeKind(1)).toBe("archived");
    expect(tagDeleteOutcomeKind(42)).toBe("archived");
  });
});

describe("tagDeleteTriggerLabel", () => {
  it("reads 'Delete tag' with zero expenses, 'Hide tag' otherwise", () => {
    expect(tagDeleteTriggerLabel(0)).toBe("Delete tag");
    expect(tagDeleteTriggerLabel(1)).toBe("Hide tag");
    expect(tagDeleteTriggerLabel(12)).toBe("Hide tag");
  });
});

describe("tagDeleteConfirmMessage", () => {
  it("names a plain delete for zero expenses", () => {
    expect(tagDeleteConfirmMessage({ name: "vacation", expenseCount: 0 })).toBe("Delete vacation?");
  });

  it("uses singular phrasing for exactly one expense", () => {
    expect(tagDeleteConfirmMessage({ name: "vacation", expenseCount: 1 })).toBe(
      "Hide vacation? 1 expense keeps it tagged.",
    );
  });

  it("uses plural phrasing for more than one expense", () => {
    expect(tagDeleteConfirmMessage({ name: "vacation", expenseCount: 12 })).toBe(
      "Hide vacation? 12 expenses keep it tagged.",
    );
  });

  it("has no last-remaining-tag suffix, unlike categories' equivalent", () => {
    expect(tagDeleteConfirmMessage({ name: "vacation", expenseCount: 0 })).not.toContain("only");
  });
});

describe("tagDeleteFailureMessage", () => {
  it("names the tag and the branch that failed", () => {
    expect(tagDeleteFailureMessage("vacation", 0)).toBe("Couldn't delete vacation.");
    expect(tagDeleteFailureMessage("vacation", 5)).toBe("Couldn't hide vacation.");
  });
});

describe("applyTagDeleteOutcome", () => {
  const data: TagsData = {
    currency: "EUR",
    active: [
      { id: "tag-vacation", name: "vacation", expenseCount: 12, monthTotalMinor: 34000 },
      { id: "tag-work", name: "work", expenseCount: 0, monthTotalMinor: 0 },
    ],
    archived: [],
  };

  it("removes the row from active for a 'deleted' outcome, without adding it to archived", () => {
    const next = applyTagDeleteOutcome(data, "tag-work", "deleted");
    expect(next.active.map((r) => r.id)).toEqual(["tag-vacation"]);
    expect(next.archived).toEqual([]);
  });

  it("moves the row from active to archived for an 'archived' outcome", () => {
    const next = applyTagDeleteOutcome(data, "tag-vacation", "archived");
    expect(next.active.map((r) => r.id)).toEqual(["tag-work"]);
    expect(next.archived.map((r) => r.id)).toEqual(["tag-vacation"]);
  });

  it("is a no-op when the id isn't among the active rows", () => {
    expect(applyTagDeleteOutcome(data, "tag-missing", "deleted")).toEqual(data);
  });

  it("never mutates the input data (pure)", () => {
    const before = JSON.parse(JSON.stringify(data));
    applyTagDeleteOutcome(data, "tag-vacation", "archived");
    expect(data).toEqual(before);
  });
});

describe("revertTagDeleteOutcome", () => {
  const vacation = { id: "tag-vacation", name: "vacation", expenseCount: 12, monthTotalMinor: 34000 };

  it("reinserts a hard-deleted row back into active", () => {
    const data: TagsData = { currency: "EUR", active: [], archived: [] };
    const next = revertTagDeleteOutcome(data, vacation, "deleted");
    expect(next.active).toEqual([vacation]);
    expect(next.archived).toEqual([]);
  });

  it("moves an archived row back to active, removing it from archived", () => {
    const data: TagsData = { currency: "EUR", active: [], archived: [vacation] };
    const next = revertTagDeleteOutcome(data, vacation, "archived");
    expect(next.active).toEqual([vacation]);
    expect(next.archived).toEqual([]);
  });

  it("composes on top of an unrelated concurrent change instead of clobbering it", () => {
    const work = { id: "tag-work", name: "work", expenseCount: 0, monthTotalMinor: 0 };
    const dataAfterUnrelatedHide: TagsData = { currency: "EUR", active: [], archived: [work] };
    const next = revertTagDeleteOutcome(dataAfterUnrelatedHide, vacation, "deleted");
    expect(next.active).toEqual([vacation]);
    expect(next.archived).toEqual([work]);
  });

  it("never mutates the input data (pure)", () => {
    const data: TagsData = { currency: "EUR", active: [], archived: [vacation] };
    const before = JSON.parse(JSON.stringify(data));
    revertTagDeleteOutcome(data, vacation, "archived");
    expect(data).toEqual(before);
  });
});

// -- applyTagsChrome -------------------------------------------------------

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

describe("applyTagsChrome", () => {
  it("wires BackButton and hides MainButton (the Add-tag row is the add affordance, not MainButton)", () => {
    const webApp = fakeWebApp();
    installWebApp(webApp);
    const onBack = vi.fn();
    applyTagsChrome(onBack);
    expect(webApp.BackButton.onClick).toHaveBeenCalled();
    expect(webApp.BackButton.show).toHaveBeenCalled();
    expect(webApp.MainButton.hide).toHaveBeenCalled();
    delete (globalThis as { window?: Window }).window;
  });
});

// -- form (screen 07b) --------------------------------------------------------

describe("emptyTagFormDraft / tagFormDraftFromRow", () => {
  it("create mode starts with no id, empty name", () => {
    expect(emptyTagFormDraft()).toEqual({ id: null, name: "" });
  });

  it("edit mode seeds the draft from the row's raw id/name", () => {
    expect(tagFormDraftFromRow({ id: "tag-vacation", name: "vacation" })).toEqual({
      id: "tag-vacation",
      name: "vacation",
    });
  });
});

describe("isTagFormDirty", () => {
  const original = { id: "tag-1", name: "vacation" };

  it("is false when nothing changed", () => {
    expect(isTagFormDirty({ ...original }, original)).toBe(false);
  });

  it("ignores leading/trailing whitespace-only name changes", () => {
    expect(isTagFormDirty({ ...original, name: "  vacation  " }, original)).toBe(false);
  });

  it("is true when the trimmed name changes", () => {
    expect(isTagFormDirty({ ...original, name: "holiday" }, original)).toBe(true);
  });
});

describe("tagNameError", () => {
  it("rejects an empty or whitespace-only name", () => {
    expect(tagNameError("")).toBe("Give this tag a name.");
    expect(tagNameError("   ")).toBe("Give this tag a name.");
  });

  it("accepts any non-blank name", () => {
    expect(tagNameError("vacation")).toBeNull();
  });
});

describe("tagFormMainButtonEnabled", () => {
  const original = emptyTagFormDraft();

  it("is disabled on a clean (unmodified) draft", () => {
    expect(tagFormMainButtonEnabled({ ...original }, original)).toBe(false);
  });

  it("is enabled once dirty, even with a blank name — submit() is what blocks that case", () => {
    const editOriginal = { id: "tag-1", name: "vacation" };
    expect(tagFormMainButtonEnabled({ ...editOriginal, name: "   " }, editOriginal)).toBe(true);
  });
});

function fakeTagFormApi(overrides: Partial<TagFormApi> = {}): TagFormApi {
  return {
    createTag: vi.fn().mockResolvedValue({ id: "tag-new", name: "vacation", account_id: "acc-1", created_at: "2026-01-01T00:00:00Z" }),
    updateTag: vi.fn().mockResolvedValue({ id: "tag-1", name: "holiday", account_id: "acc-1", created_at: "2026-01-01T00:00:00Z" }),
    ...overrides,
  };
}

describe("createTagFormController", () => {
  it("is blocked (reason: invalid) on a clean draft — nothing to save", async () => {
    const api = fakeTagFormApi();
    const controller = createTagFormController(api, emptyTagFormDraft());

    const outcome = await controller.submit();

    expect(outcome).toEqual({ status: "blocked", reason: "invalid" });
    expect(api.createTag).not.toHaveBeenCalled();
  });

  it("is blocked (reason: invalid) when dirty but the trimmed name is blank", async () => {
    const api = fakeTagFormApi();
    const controller = createTagFormController(api, emptyTagFormDraft());
    controller.setName("   ");

    const outcome = await controller.submit();

    expect(outcome).toEqual({ status: "blocked", reason: "invalid" });
    expect(api.createTag).not.toHaveBeenCalled();
  });

  it("creates a tag with the trimmed name", async () => {
    const api = fakeTagFormApi();
    const controller = createTagFormController(api, emptyTagFormDraft());
    controller.setName("  vacation  ");

    const outcome = await controller.submit();

    expect(outcome.status).toBe("success");
    expect(api.createTag).toHaveBeenCalledWith({ name: "vacation" });
  });

  it("updates an existing tag by id in edit mode", async () => {
    const original = tagFormDraftFromRow({ id: "tag-1", name: "vacation" });
    const api = fakeTagFormApi();
    const controller = createTagFormController(api, original);
    controller.setName("holiday");

    const outcome = await controller.submit();

    expect(outcome.status).toBe("success");
    expect(api.updateTag).toHaveBeenCalledWith("tag-1", { name: "holiday" });
    expect(api.createTag).not.toHaveBeenCalled();
  });

  it("a duplicate rapid submit issues exactly one write", async () => {
    let resolveUpdate: (value: TagResponse) => void = () => {};
    const updateTag = vi.fn(
      () =>
        new Promise<TagResponse>((resolve) => {
          resolveUpdate = resolve;
        }),
    );
    const api = fakeTagFormApi({ updateTag });
    const original = tagFormDraftFromRow({ id: "tag-1", name: "vacation" });
    const controller = createTagFormController(api, original);
    controller.setName("holiday");

    const first = controller.submit();
    const second = controller.submit();
    resolveUpdate({ id: "tag-1", name: "holiday", account_id: "acc-1", created_at: "2026-01-01T00:00:00Z" });
    const [firstOutcome, secondOutcome] = await Promise.all([first, second]);

    expect(updateTag).toHaveBeenCalledOnce();
    expect(firstOutcome.status).toBe("success");
    expect(secondOutcome).toEqual({ status: "blocked", reason: "submitting" });
  });

  it("maps 403 to the read-only message and preserves the draft", async () => {
    const api = fakeTagFormApi({ createTag: vi.fn().mockRejectedValue(new ForbiddenError()) });
    const controller = createTagFormController(api, emptyTagFormDraft());
    controller.setName("vacation");

    const outcome = await controller.submit();

    expect(outcome).toEqual({ status: "error", message: "You have read-only access to this account." });
    expect(controller.getDraft()).toEqual({ id: null, name: "vacation" });
  });

  it("maps a network failure to a retryable message and preserves the draft", async () => {
    const api = fakeTagFormApi({ createTag: vi.fn().mockRejectedValue(new RetryableError()) });
    const controller = createTagFormController(api, emptyTagFormDraft());
    controller.setName("vacation");

    const outcome = await controller.submit();

    expect(outcome.status).toBe("error");
    expect(controller.getDraft().name).toBe("vacation");
  });
});

describe("renderTagForm", () => {
  const baseState = {
    draft: emptyTagFormDraft(),
    nameInteracted: false,
    submitError: null,
    expenseCount: 0,
  };

  it("shows no inline message before the name field has been interacted with, even when blank", () => {
    const html = renderTagForm(baseState);
    expect(html).not.toContain("Give this tag a name.");
  });

  it("shows the empty-name error once nameInteracted is true", () => {
    const html = renderTagForm({ ...baseState, nameInteracted: true });
    expect(html).toContain("Give this tag a name.");
    expect(html).toContain("cat-form-message--error");
  });

  it("renders a submit error banner when passed one", () => {
    const html = renderTagForm({ ...baseState, submitError: "Couldn't save this tag." });
    expect(html).toContain('data-testid="tag-form-submit-error"');
    expect(html).toContain("Couldn't save this tag.");
  });

  it("pre-fills the name input's value from the draft", () => {
    const html = renderTagForm({ ...baseState, draft: { ...baseState.draft, name: "holiday" } });
    expect(html).toContain('value="holiday"');
  });

  // -- region 4: delete/hide trigger (screen 07b) ------------------------

  it("shows no delete trigger in create mode (draft.id === null)", () => {
    const html = renderTagForm(baseState);
    expect(html).not.toContain('data-testid="tag-delete-trigger"');
  });

  it("shows 'Delete tag' in edit mode with zero expenses", () => {
    const html = renderTagForm({
      ...baseState,
      draft: { id: "tag-1", name: "vacation" },
      expenseCount: 0,
    });
    expect(html).toContain('data-testid="tag-delete-trigger"');
    expect(html).toContain(">Delete tag<");
  });

  it("shows 'Hide tag' in edit mode when the tag has expenses", () => {
    const html = renderTagForm({
      ...baseState,
      draft: { id: "tag-1", name: "vacation" },
      expenseCount: 12,
    });
    expect(html).toContain(">Hide tag<");
    expect(html).not.toContain(">Delete tag<");
  });
});

describe("applyTagFormChrome", () => {
  it("shows 'Save' and disables MainButton on a clean draft", () => {
    const webApp = fakeWebApp();
    installWebApp(webApp);
    const original = emptyTagFormDraft();
    applyTagFormChrome({ ...original }, original);
    expect(webApp.MainButton.setText).toHaveBeenCalledWith("Save");
    expect(webApp.MainButton.disable).toHaveBeenCalled();
    delete (globalThis as { window?: Window }).window;
  });

  it("enables MainButton once the draft is dirty", () => {
    const webApp = fakeWebApp();
    installWebApp(webApp);
    const original = emptyTagFormDraft();
    applyTagFormChrome({ ...original, name: "vacation" }, original);
    expect(webApp.MainButton.enable).toHaveBeenCalled();
    delete (globalThis as { window?: Window }).window;
  });
});

describe("wireTagFormBackButton", () => {
  it("closes immediately with no confirm popup for a clean draft", () => {
    const webApp = fakeWebApp();
    installWebApp(webApp);
    const original = emptyTagFormDraft();
    const onClose = vi.fn();
    wireTagFormBackButton(() => ({ ...original }), original, onClose);
    const handler = (webApp.BackButton.onClick as Mock).mock.calls[0][0] as () => void;
    handler();
    expect(webApp.showConfirm).not.toHaveBeenCalled();
    expect(onClose).toHaveBeenCalled();
    delete (globalThis as { window?: Window }).window;
  });

  it("confirms via Telegram's popup before discarding a dirty draft", async () => {
    const webApp = fakeWebApp({ showConfirm: vi.fn((_msg, cb) => cb(true)) });
    installWebApp(webApp);
    const original = emptyTagFormDraft();
    const onClose = vi.fn();
    wireTagFormBackButton(() => ({ ...original, name: "vacation" }), original, onClose);
    const handler = (webApp.BackButton.onClick as Mock).mock.calls[0][0] as () => void;
    handler();
    await Promise.resolve();
    await Promise.resolve();
    expect(webApp.showConfirm).toHaveBeenCalledWith("Discard changes to this tag?", expect.any(Function));
    expect(onClose).toHaveBeenCalled();
    delete (globalThis as { window?: Window }).window;
  });

  it("keeps the draft when the user declines to discard", async () => {
    const webApp = fakeWebApp({ showConfirm: vi.fn((_msg, cb) => cb(false)) });
    installWebApp(webApp);
    const original = emptyTagFormDraft();
    const onClose = vi.fn();
    wireTagFormBackButton(() => ({ ...original, name: "vacation" }), original, onClose);
    const handler = (webApp.BackButton.onClick as Mock).mock.calls[0][0] as () => void;
    handler();
    await Promise.resolve();
    await Promise.resolve();
    expect(onClose).not.toHaveBeenCalled();
    delete (globalThis as { window?: Window }).window;
  });
});
