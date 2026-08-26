import { afterEach, describe, expect, it, vi } from "vitest";
import { ForbiddenError, RetryableError } from "../src/api/client";
import type { Currency } from "../src/api/types";
import { setLanguage, t } from "../src/lib/i18n";
import {
  CURRENCY_ORDER,
  createMemoryCache,
  createSettingsController,
  currencyName,
  loadSettings,
  renderSettings,
  renderSettingsView,
  settingsConfirmMessage,
  type SettingsApi,
} from "../src/screens/settings";

// -- CURRENCY_ORDER / CURRENCY_NAMES ----------------------------------------

describe("CURRENCY_ORDER", () => {
  it("lists all 15 currencies in models/enums.py::Currency's declared order", () => {
    expect(CURRENCY_ORDER).toEqual([
      "USD",
      "EUR",
      "GBP",
      "PLN",
      "UAH",
      "CZK",
      "CHF",
      "SEK",
      "NOK",
      "DKK",
      "JPY",
      "CNY",
      "CAD",
      "AUD",
      "TRY",
    ]);
  });

  it("has a name for every currency in the order", () => {
    for (const code of CURRENCY_ORDER) {
      expect(currencyName(code)).toBeTruthy();
    }
  });
});

// -- loadSettings ------------------------------------------------------------

function fakeApi(overrides: Partial<SettingsApi> = {}): SettingsApi {
  return {
    getMe: vi.fn().mockResolvedValue({ currency: "USD", role: "admin" }),
    updateAccount: vi.fn().mockResolvedValue({ currency: "EUR" }),
    ...overrides,
  };
}

describe("loadSettings", () => {
  it("returns ready with the account's currency and the caller's role", async () => {
    const api = fakeApi({ getMe: vi.fn().mockResolvedValue({ currency: "EUR", role: "member" }) });
    const state = await loadSettings(api, createMemoryCache());
    expect(state).toEqual({ status: "ready", currency: "EUR", role: "member" });
  });

  it("falls back to the cached snapshot, marked offline, on a later failure", async () => {
    const cache = createMemoryCache();
    const getMe = vi
      .fn()
      .mockResolvedValueOnce({ currency: "GBP", role: "admin" })
      .mockRejectedValueOnce(new RetryableError());
    const api = fakeApi({ getMe });

    await loadSettings(api, cache); // populates the cache
    const state = await loadSettings(api, cache);

    expect(state).toMatchObject({ status: "offline", currency: "GBP", role: "admin" });
    expect((state as { lastSyncedAt: string }).lastSyncedAt).toBeTruthy();
  });

  it("returns the fixed load-error copy when there is no cache to fall back on", async () => {
    const api = fakeApi({ getMe: vi.fn().mockRejectedValue(new RetryableError()) });
    const state = await loadSettings(api, createMemoryCache());
    expect(state).toEqual({ status: "error", message: "Couldn't load your settings." });
  });
});

// -- createSettingsController -------------------------------------------------

describe("createSettingsController", () => {
  it("starts selected on the account's current currency, not dirty", () => {
    const controller = createSettingsController(fakeApi(), "USD");
    expect(controller.getSelected()).toBe("USD");
    expect(controller.isDirty()).toBe(false);
  });

  it("select() moves the selection and flips isDirty", () => {
    const controller = createSettingsController(fakeApi(), "USD");
    controller.select("EUR");
    expect(controller.getSelected()).toBe("EUR");
    expect(controller.isDirty()).toBe(true);
  });

  it("re-picking the original currency clears isDirty again", () => {
    const controller = createSettingsController(fakeApi(), "USD");
    controller.select("EUR");
    controller.select("USD");
    expect(controller.isDirty()).toBe(false);
  });

  it("save() is blocked when the selection hasn't changed — no PATCH sent", async () => {
    const api = fakeApi();
    const controller = createSettingsController(api, "USD");
    const outcome = await controller.save();
    expect(outcome).toEqual({ status: "blocked" });
    expect(api.updateAccount).not.toHaveBeenCalled();
  });

  it("save() PATCHes the selected currency and returns the server's response", async () => {
    const api = fakeApi({ updateAccount: vi.fn().mockResolvedValue({ currency: "EUR" }) });
    const controller = createSettingsController(api, "USD");
    controller.select("EUR");

    const outcome = await controller.save();

    expect(outcome).toEqual({ status: "success", currency: "EUR" });
    expect(api.updateAccount).toHaveBeenCalledWith({ currency: "EUR" });
  });

  it("a duplicate rapid save() issues exactly one PATCH", async () => {
    let resolveUpdate: (value: { currency: Currency }) => void = () => {};
    const updateAccount = vi.fn(
      () =>
        new Promise<{ currency: Currency }>((resolve) => {
          resolveUpdate = resolve;
        }),
    );
    const api = fakeApi({ updateAccount });
    const controller = createSettingsController(api, "USD");
    controller.select("EUR");

    const first = controller.save();
    const second = controller.save();
    resolveUpdate({ currency: "EUR" });
    const [firstOutcome, secondOutcome] = await Promise.all([first, second]);

    expect(updateAccount).toHaveBeenCalledOnce();
    expect(firstOutcome).toEqual({ status: "success", currency: "EUR" });
    expect(secondOutcome).toEqual({ status: "blocked" });
  });

  it("maps both a 403 and a network failure to the same fixed save-error copy, keeping the selection", async () => {
    for (const err of [new ForbiddenError(), new RetryableError()]) {
      const api = fakeApi({ updateAccount: vi.fn().mockRejectedValue(err) });
      const controller = createSettingsController(api, "USD");
      controller.select("EUR");

      const outcome = await controller.save();

      expect(outcome).toEqual({ status: "error", message: t("settings.errSave") });
      expect(controller.getSelected()).toBe("EUR");
    }
  });
});

// -- settingsConfirmMessage ---------------------------------------------------

describe("settingsConfirmMessage", () => {
  it("names the target currency and restates that amounts are not converted", () => {
    const message = settingsConfirmMessage("EUR");
    expect(message).toContain("EUR");
    expect(message).toMatch(/not converted/i);
  });
});

// -- renderSettingsView / renderSettings --------------------------------------

describe("renderSettingsView", () => {
  it("renders all 15 currencies with their code and name", () => {
    const html = renderSettingsView({ selected: "USD", interactive: true, showAdminLine: false });
    for (const code of CURRENCY_ORDER) {
      expect(html).toContain(code);
      expect(html).toContain(currencyName(code));
    }
  });

  it("marks exactly one row checked — the selected currency", () => {
    const html = renderSettingsView({ selected: "PLN", interactive: true, showAdminLine: false });
    const checkedCount = (html.match(/aria-checked="true"/g) ?? []).length;
    expect(checkedCount).toBe(1);
    expect(html).toMatch(/aria-checked="true"[^>]*data-code="PLN"/);
  });

  it("shows the no-conversion warning before any selection is made (selected: null)", () => {
    const html = renderSettingsView({ selected: null, interactive: false, showAdminLine: false });
    expect(html).toContain("Changing the currency relabels existing amounts");
    expect(html.match(/aria-checked="true"/g)).toBeNull();
  });

  it("disables every row and hides the admin-only line when interactive and not read-only", () => {
    const html = renderSettingsView({ selected: "USD", interactive: true, showAdminLine: false });
    expect(html).not.toContain("disabled");
    expect(html).not.toContain("Only an account admin can change the currency.");
  });

  it("renders inert rows and the admin-only line for a non-admin", () => {
    const html = renderSettingsView({ selected: "USD", interactive: false, showAdminLine: true });
    expect(html).toContain("Only an account admin can change the currency.");
    expect(html).toContain('aria-readonly="true"');
    // Every one of the 15 rows carries the native `disabled` attribute.
    const disabledCount = (html.match(/ disabled>/g) ?? []).length;
    expect(disabledCount).toBe(CURRENCY_ORDER.length);
  });

  it("associates the admin-only line with the radiogroup via aria-describedby, alongside the warning", () => {
    const html = renderSettingsView({ selected: "USD", interactive: false, showAdminLine: true });
    expect(html).toContain('id="settings-admin-line"');
    expect(html).toContain('aria-describedby="settings-warning settings-admin-line"');
  });

  it("describes the radiogroup by only the warning when the admin line isn't shown", () => {
    const html = renderSettingsView({ selected: "USD", interactive: true, showAdminLine: false });
    expect(html).toContain('aria-describedby="settings-warning"');
  });

  it("shows the offline banner with the last-synced marker", () => {
    const html = renderSettingsView({
      selected: "USD",
      interactive: false,
      showAdminLine: false,
      lastSyncedAt: "2026-08-08T12:00:00.000Z",
    });
    expect(html).toContain("Offline");
    expect(html).toContain("2026-08-08T12:00:00.000Z");
  });

  it("shows the save-error copy under the list when passed", () => {
    const html = renderSettingsView({
      selected: "USD",
      interactive: true,
      showAdminLine: false,
      saveError: t("settings.errSave"),
    });
    expect(html).toContain(t("settings.errSave"));
  });
});

describe("renderSettings", () => {
  it("loading: renders the full list with no row checked", () => {
    const html = renderSettings({ status: "loading" });
    expect(html.match(/aria-checked="true"/g)).toBeNull();
    for (const code of CURRENCY_ORDER) {
      expect(html).toContain(code);
    }
  });

  it("error: shows the message and a retry action, not the currency list", () => {
    const html = renderSettings({ status: "error", message: "Couldn't load your settings." });
    expect(html).toContain("Couldn't load your settings.");
    expect(html).toContain('data-action="retry"');
    expect(html).not.toContain("USD");
  });

  it("ready + admin: the account's currency is checked and rows are interactive (no admin line)", () => {
    const html = renderSettings({ status: "ready", currency: "CAD", role: "admin" }, { selected: "CAD", saving: false });
    expect(html).toMatch(/aria-checked="true"[^>]*data-code="CAD"/);
    expect(html).not.toContain("Only an account admin can change the currency.");
  });

  it("ready + non-admin: the admin-only line shows and rows are inert", () => {
    const html = renderSettings({ status: "ready", currency: "CAD", role: "member" }, { selected: "CAD", saving: false });
    expect(html).toContain("Only an account admin can change the currency.");
  });

  it("offline: the last-synced banner shows even for an admin", () => {
    const html = renderSettings(
      { status: "offline", currency: "JPY", role: "admin", lastSyncedAt: "2026-08-08T09:00:00.000Z" },
      { selected: "JPY", saving: false },
    );
    expect(html).toContain("Offline");
    expect(html).not.toContain("Only an account admin can change the currency.");
  });

  it("saving: no row is interactive regardless of role", () => {
    const html = renderSettings({ status: "ready", currency: "USD", role: "admin" }, { selected: "EUR", saving: true });
    const disabledCount = (html.match(/ disabled>/g) ?? []).length;
    expect(disabledCount).toBe(CURRENCY_ORDER.length);
  });
});

// -- i18n (U3.10) --------------------------------------------------------

describe("renders in Russian", () => {
  afterEach(() => setLanguage("en"));

  it("translates the section heading, warning, admin line, currency names and save error", () => {
    setLanguage("ru");
    const html = renderSettingsView({ selected: "USD", interactive: false, showAdminLine: true, saveError: t("settings.errSave") });
    expect(html).toContain(t("settings.sectionCurrency"));
    expect(html).toContain(t("settings.warnNoConversion"));
    expect(html).toContain(t("settings.readonlyAdmin"));
    expect(html).toContain(currencyName("EUR"));
    expect(html).toContain(t("settings.errSave"));
  });

  it("translates the load error, the confirm popup message and the discard prompt", async () => {
    setLanguage("ru");
    const api: SettingsApi = {
      getMe: vi.fn().mockRejectedValue(new RetryableError()),
      updateAccount: vi.fn(),
    };
    const state = await loadSettings(api, createMemoryCache());
    expect(state).toEqual({ status: "error", message: t("settings.errLoad") });
    expect(settingsConfirmMessage("EUR")).toBe(t("settings.confirmMessage").replace("{code}", "EUR"));
    expect(t("settings.discardChanges")).not.toBe("Discard changes?");
  });
});
