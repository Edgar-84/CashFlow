// @vitest-environment jsdom
//
// Whole-file opt-in (D603's precedent, see add-expense.test.ts): this file's
// one test needs a real `#app` node for `boot()`'s real `getRoot()`/
// `showHome()` path to run past its DOM guard.
//
// Separate from main.test.ts on purpose: `createHomeController` is mocked
// here so `boot()` never touches `ApiClient`'s real `fetch` (module-level
// `client`/`homeController` singletons in main.ts are constructed once, at
// import time — `vi.mock` factories are hoisted above the `import` that
// triggers that construction, which a plain `vi.stubGlobal("fetch", ...)`
// call is not). main.test.ts's own `boot()` test stays in Node env, exactly
// covering the opposite path: the `typeof document === "undefined"` guard.
import { afterEach, describe, expect, it, vi } from "vitest";

// Only `setLanguage` is mocked (as a spy this file's own test asserts on) —
// `t`/`catalogues` stay real since `main.ts`'s real `showHome`/`applyHomeChrome`
// path (not mocked here) calls `t()` for the MainButton label (U3.5).
vi.mock("../src/lib/i18n", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/lib/i18n")>();
  return { ...actual, setLanguage: vi.fn() };
});

const { loadMock } = vi.hoisted(() => ({ loadMock: vi.fn() }));
vi.mock("../src/screens/home", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/screens/home")>();
  return { ...actual, createHomeController: () => ({ load: loadMock }) };
});

import { setLanguage } from "../src/lib/i18n";
import { boot } from "../src/main";

afterEach(() => {
  vi.clearAllMocks();
  document.body.innerHTML = "";
});

describe("boot", () => {
  it("calls setLanguage(\"en\") before Home's loader resolves — not when GET /users/me resolves (D709/D716)", async () => {
    document.body.innerHTML = '<div id="app"></div>';

    // `main.ts`'s own module bottom auto-invokes `boot()` on import
    // (`if (typeof document !== "undefined") { void boot(); }`) — and under
    // this file's jsdom environment `document` already exists at import
    // time, before `#app` above is attached, so that auto-boot already ran
    // once (finding no root, bailing out of `showHome` immediately, but
    // still calling the mocked `setLanguage("en")` on the way). Clearing
    // here discards that contaminating call so the assertions below can
    // only be satisfied by this test's own explicit `boot()` call, not by
    // the module's.
    vi.clearAllMocks();

    let resolveLoad!: (state: unknown) => void;
    loadMock.mockReturnValue(
      new Promise((resolve) => {
        resolveLoad = resolve;
      }),
    );

    const bootPromise = boot();

    // Nothing in `boot()` or `showHome()` awaits anything before
    // `homeController.load()` is called, so by this point — still
    // synchronous with the `boot()` call above — `setLanguage("en")` has
    // already run exactly once and the (still-pending) loader is already in
    // flight.
    expect(setLanguage).toHaveBeenCalledTimes(1);
    expect(setLanguage).toHaveBeenCalledWith("en");
    expect(loadMock).toHaveBeenCalledTimes(1);

    resolveLoad({
      status: "empty",
      period: { unit: "month", offset: 0 },
      currency: "EUR",
      today: "2026-08-25",
      accountName: "Test Family",
    });
    await bootPromise;
  });
});
