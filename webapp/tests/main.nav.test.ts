// @vitest-environment jsdom
//
// Whole-file opt-in, same shape as main.boot.test.ts: these tests drive
// `main.ts`'s real, unexported `showX`/`goBack` wiring through the DOM
// (`boot()`, real `mount`/`applyXChrome` functions, a fake Telegram WebApp
// whose captured BackButton handler stands in for a real device back-tap),
// mocking only each screen's data layer so nothing touches real `fetch`.
//
// Covers U2.2's own two named acceptance-criterion scenarios
// (docs/plans/mini-app-v8.md): Home -> Statistics -> Back -> Home, and
// Statistics (grouped by tag) -> tag-bar tap -> Expenses -> Back ->
// Statistics, still grouped by tag with its period intact. The second one is
// exactly the scenario a reviewer pass caught regressing (grouping toggles
// locally inside statistics.ts's own `mount`, which this unit's first cut
// never told `main.ts` about) — this file exists so that regression can't
// come back silently.
import { afterEach, describe, expect, it, vi } from "vitest";
import type { TelegramWebApp } from "../src/lib/telegram";

vi.mock("../src/lib/i18n", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/lib/i18n")>();
  return { ...actual, setLanguage: vi.fn() };
});

const { homeLoadMock } = vi.hoisted(() => ({ homeLoadMock: vi.fn() }));
vi.mock("../src/screens/home", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/screens/home")>();
  return { ...actual, createHomeController: () => ({ load: homeLoadMock }) };
});

const { loadStatisticsMock } = vi.hoisted(() => ({ loadStatisticsMock: vi.fn() }));
vi.mock("../src/screens/statistics", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/screens/statistics")>();
  return { ...actual, loadStatistics: loadStatisticsMock };
});

const { expensesLoadMock } = vi.hoisted(() => ({ expensesLoadMock: vi.fn() }));
vi.mock("../src/screens/expenses", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/screens/expenses")>();
  return {
    ...actual,
    createExpensesController: () => ({ load: expensesLoadMock, loadMore: vi.fn() }),
  };
});

import { boot } from "../src/main";

function fakeWebApp(): TelegramWebApp {
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
    BackButton: { show: vi.fn(), hide: vi.fn(), onClick: vi.fn(), offClick: vi.fn() },
    HapticFeedback: { impactOccurred: vi.fn(), notificationOccurred: vi.fn(), selectionChanged: vi.fn() },
    showConfirm: vi.fn(),
  };
}

// The most recently registered BackButton handler — every wired screen's
// `applyXChrome` calls `setBackButtonHandler`, which always calls
// `onClick` again (`lib/telegram.ts`'s unwire-then-rewire contract), so the
// last call's argument is always the one a real device back-tap would fire.
function currentBackHandler(webApp: TelegramWebApp): () => void {
  const calls = (webApp.BackButton.onClick as ReturnType<typeof vi.fn>).mock.calls;
  const handler = calls.at(-1)?.[0] as (() => void) | undefined;
  if (!handler) {
    throw new Error("BackButton.onClick was never registered");
  }
  return handler;
}

const HOME_READY = {
  status: "ready" as const,
  totalMinor: 5000,
  currency: "EUR" as const,
  segments: [],
  bars: [],
  rows: [],
  budgetAlerts: [],
  period: { unit: "month" as const, offset: 0 },
  today: "2026-09-05",
  accountName: "Test Family",
};

function statisticsReady(grouping: "category" | "tag") {
  return {
    status: "ready" as const,
    totalMinor: 5000,
    currency: "EUR" as const,
    period: { unit: "month" as const, offset: 0 },
    grouping,
    segments: [],
    categoryBars: [
      { id: "cat-1", label: "Groceries", colorVar: "var(--category-slot-1)", minor: 3000, widthPct: 100 },
      { id: "cat-2", label: "Transport", colorVar: "var(--category-slot-2)", minor: 2000, widthPct: 67 },
    ],
    tagBars: [
      { id: "tag-1", label: "Coffee", colorVar: null, minor: 3000, widthPct: 100 },
      { id: "tag-2", label: "Vacation", colorVar: null, minor: 2000, widthPct: 67 },
    ],
  };
}

function expensesReady() {
  return {
    status: "ready" as const,
    currency: "EUR" as const,
    categoryLabel: null,
    tagLabel: "Coffee",
    period: undefined,
    days: [],
    hasMore: false,
  };
}

async function flush(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

async function openHome(webApp: TelegramWebApp): Promise<void> {
  document.body.innerHTML = '<div id="app"></div>';
  homeLoadMock.mockResolvedValue(HOME_READY);
  window.Telegram = { WebApp: webApp };
  await boot();
  await flush();
}

function tapMenuItem(item: string): void {
  document.querySelector<HTMLElement>('[data-testid="menu-button"]')?.click();
  document.querySelector<HTMLElement>(`[data-testid="side-menu-row-${item}"]`)?.click();
}

afterEach(() => {
  vi.clearAllMocks();
  document.body.innerHTML = "";
  window.Telegram = undefined;
});

describe("back stack (U2.2): Home -> Statistics -> Back -> Home", () => {
  it("lands back on Home", async () => {
    const webApp = fakeWebApp();
    await openHome(webApp);

    loadStatisticsMock.mockResolvedValue(statisticsReady("category"));
    tapMenuItem("statistics");
    await flush();
    expect(document.querySelector('[data-testid="grouping-toggle"]')).not.toBeNull();

    currentBackHandler(webApp)();
    await flush();

    expect(document.querySelector('[data-testid="menu-button"]')).not.toBeNull();
    expect(document.querySelector('[data-testid="grouping-toggle"]')).toBeNull();
  });
});

describe("back stack (U2.2): Statistics (tag grouping) -> tag bar -> Expenses -> Back -> Statistics", () => {
  it("restores Statistics still grouped by tag, with its period intact", async () => {
    const webApp = fakeWebApp();
    await openHome(webApp);

    // Resolves per the actual `grouping` argument `showStatistics` passes
    // through — a fixed `mockResolvedValue` would mask this test's whole
    // point, since a stale `restore` closure calling `loadStatistics` with
    // the wrong grouping would otherwise still render as "category".
    loadStatisticsMock.mockImplementation((_client: unknown, _cache: unknown, _period: unknown, grouping: "category" | "tag") =>
      Promise.resolve(statisticsReady(grouping)),
    );
    tapMenuItem("statistics");
    await flush();

    // Toggle to the tag grouping — statistics.ts's own local re-render, no
    // refetch.
    document.querySelector<HTMLElement>('[data-testid="grouping-tag"]')?.click();
    expect(document.querySelectorAll('[data-testid="stats-bar"]')).toHaveLength(2);
    expect(loadStatisticsMock).toHaveBeenCalledTimes(1);

    // Tap a tag bar — routes into Expenses filtered to that tag.
    expensesLoadMock.mockResolvedValue(expensesReady());
    document.querySelector<HTMLElement>('[data-id="tag-1"]')?.click();
    await flush();
    expect(document.querySelector('[data-testid="ready"]')?.className).toContain("expenses");

    // Back from Expenses must restore Statistics, still grouped by tag.
    currentBackHandler(webApp)();
    await flush();

    const toggle = document.querySelector('[data-testid="grouping-toggle"]');
    expect(toggle).not.toBeNull();
    expect(document.querySelector('[data-testid="grouping-tag"]')?.className).toContain("active");
    expect(document.querySelector('[data-testid="grouping-category"]')?.className).not.toContain("active");
    // `goBack`'s restore re-enters `showStatistics`, which always re-fetches
    // (no cache-skip on Back) — the toggle itself stayed refetch-free (the
    // assertion right after it above), which is the actual "no refetch" AC.
    expect(loadStatisticsMock).toHaveBeenCalledTimes(2);
  });
});
