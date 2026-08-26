import { afterEach, describe, expect, it, vi } from "vitest";
import { ForbiddenError, RetryableError } from "../src/api/client";
import type { Language } from "../src/api/types";
import { setLanguage, t } from "../src/lib/i18n";
import {
  LANGUAGE_ORDER,
  createLanguageController,
  createMemoryCache,
  languageName,
  loadLanguage,
  renderLanguage,
  renderLanguageView,
  type LanguageApi,
} from "../src/screens/language";

// -- LANGUAGE_ORDER / languageName -------------------------------------------

describe("LANGUAGE_ORDER", () => {
  it("lists all three languages in models/enums.py::Language's declared order", () => {
    expect(LANGUAGE_ORDER).toEqual(["en", "ru", "uk"]);
  });

  it("has an endonym for every language in the order", () => {
    for (const code of LANGUAGE_ORDER) {
      expect(languageName(code)).toBeTruthy();
    }
  });

  it("endonyms are identical regardless of the active catalogue — they don't translate", () => {
    expect(languageName("ru")).toBe("Русский");
    setLanguage("ru");
    expect(languageName("ru")).toBe("Русский");
    expect(languageName("en")).toBe("English");
    setLanguage("en");
  });
});

// -- loadLanguage -------------------------------------------------------------

function fakeApi(overrides: Partial<LanguageApi> = {}): LanguageApi {
  return {
    getMe: vi.fn().mockResolvedValue({ language: "en", role: "admin" }),
    updateAccount: vi.fn().mockResolvedValue({ language: "ru" }),
    ...overrides,
  };
}

describe("loadLanguage", () => {
  it("returns ready with the account's language and the caller's role", async () => {
    const api = fakeApi({ getMe: vi.fn().mockResolvedValue({ language: "uk", role: "member" }) });
    const state = await loadLanguage(api, createMemoryCache());
    expect(state).toEqual({ status: "ready", language: "uk", role: "member" });
  });

  it("falls back to the cached snapshot, marked offline, on a later failure", async () => {
    const cache = createMemoryCache();
    const getMe = vi
      .fn()
      .mockResolvedValueOnce({ language: "ru", role: "admin" })
      .mockRejectedValueOnce(new RetryableError());
    const api = fakeApi({ getMe });

    await loadLanguage(api, cache); // populates the cache
    const state = await loadLanguage(api, cache);

    expect(state).toMatchObject({ status: "offline", language: "ru", role: "admin" });
    expect((state as { lastSyncedAt: string }).lastSyncedAt).toBeTruthy();
  });

  it("returns the fixed load-error copy when there is no cache to fall back on", async () => {
    const api = fakeApi({ getMe: vi.fn().mockRejectedValue(new RetryableError()) });
    const state = await loadLanguage(api, createMemoryCache());
    expect(state).toEqual({ status: "error", message: "Couldn't load your language setting." });
  });
});

// -- createLanguageController -------------------------------------------------

describe("createLanguageController", () => {
  it("starts selected on the account's current language", () => {
    const controller = createLanguageController(fakeApi(), "en");
    expect(controller.getSelected()).toBe("en");
  });

  it("choosing the current selection is a no-op — no PATCH sent", async () => {
    const api = fakeApi();
    const controller = createLanguageController(api, "en");
    const outcome = await controller.choose("en");
    expect(outcome).toEqual({ status: "blocked" });
    expect(api.updateAccount).not.toHaveBeenCalled();
  });

  it("choosing a different language PATCHes it and returns the server's response", async () => {
    const api = fakeApi({ updateAccount: vi.fn().mockResolvedValue({ language: "ru" }) });
    const controller = createLanguageController(api, "en");

    const outcome = await controller.choose("ru");

    expect(outcome).toEqual({ status: "success", language: "ru" });
    expect(api.updateAccount).toHaveBeenCalledWith({ language: "ru" });
    expect(controller.getSelected()).toBe("ru");
  });

  it("a duplicate rapid choose() issues exactly one PATCH", async () => {
    let resolveUpdate: (value: { language: Language }) => void = () => {};
    const updateAccount = vi.fn(
      () =>
        new Promise<{ language: Language }>((resolve) => {
          resolveUpdate = resolve;
        }),
    );
    const api = fakeApi({ updateAccount });
    const controller = createLanguageController(api, "en");

    const first = controller.choose("ru");
    const second = controller.choose("ru");
    resolveUpdate({ language: "ru" });
    const [firstOutcome, secondOutcome] = await Promise.all([first, second]);

    expect(updateAccount).toHaveBeenCalledOnce();
    expect(firstOutcome).toEqual({ status: "success", language: "ru" });
    expect(secondOutcome).toEqual({ status: "blocked" });
  });

  it("maps both a 403 and a network failure to the fixed save-error copy, keeping the attempted selection", async () => {
    for (const err of [new ForbiddenError(), new RetryableError()]) {
      const api = fakeApi({ updateAccount: vi.fn().mockRejectedValue(err) });
      const controller = createLanguageController(api, "en");

      const outcome = await controller.choose("ru");

      expect(outcome).toEqual({ status: "error", message: t("language.errSave") });
      expect(controller.getSelected()).toBe("ru");
    }
  });

  it("after a failed attempt, re-choosing the same (still-displayed) row retries rather than no-op'ing", async () => {
    const updateAccount = vi.fn().mockRejectedValueOnce(new RetryableError()).mockResolvedValueOnce({ language: "ru" });
    const api = fakeApi({ updateAccount });
    const controller = createLanguageController(api, "en");

    const failed = await controller.choose("ru");
    expect(failed).toEqual({ status: "error", message: t("language.errSave") });

    const retried = await controller.choose("ru");
    expect(retried).toEqual({ status: "success", language: "ru" });
    expect(updateAccount).toHaveBeenCalledTimes(2);
  });

  it("a successful choose() clears the retry-always behaviour — the next tap on the same row is a no-op again", async () => {
    const api = fakeApi({ updateAccount: vi.fn().mockResolvedValue({ language: "ru" }) });
    const controller = createLanguageController(api, "en");

    await controller.choose("ru");
    const outcome = await controller.choose("ru");

    expect(outcome).toEqual({ status: "blocked" });
    expect(api.updateAccount).toHaveBeenCalledOnce();
  });
});

// -- renderLanguageView / renderLanguage --------------------------------------

describe("renderLanguageView", () => {
  it("renders all three languages by endonym and ISO code", () => {
    const html = renderLanguageView({ selected: "en", interactive: true, showAdminLine: false });
    for (const code of LANGUAGE_ORDER) {
      expect(html).toContain(languageName(code));
      expect(html).toContain(code.toUpperCase());
    }
  });

  it("marks exactly one row checked — the selected language", () => {
    const html = renderLanguageView({ selected: "uk", interactive: true, showAdminLine: false });
    const checkedCount = (html.match(/aria-checked="true"/g) ?? []).length;
    expect(checkedCount).toBe(1);
    expect(html).toMatch(/aria-checked="true"[^>]*data-code="uk"/);
  });

  it("marks no row checked while loading (selected: null)", () => {
    const html = renderLanguageView({ selected: null, interactive: false, showAdminLine: false });
    expect(html.match(/aria-checked="true"/g)).toBeNull();
  });

  it("renders inert rows and the admin-only line for a non-admin", () => {
    const html = renderLanguageView({ selected: "en", interactive: false, showAdminLine: true });
    expect(html).toContain("Only an account admin can change the language.");
    expect(html).toContain('aria-readonly="true"');
    const disabledCount = (html.match(/ disabled>/g) ?? []).length;
    expect(disabledCount).toBe(LANGUAGE_ORDER.length);
  });

  it("associates the admin-only line with the radiogroup via aria-describedby, alongside the explain line", () => {
    const html = renderLanguageView({ selected: "en", interactive: false, showAdminLine: true });
    expect(html).toContain('id="language-admin-line"');
    expect(html).toContain('aria-describedby="language-explain language-admin-line"');
  });

  it("describes the radiogroup by only the explain line when the admin line isn't shown", () => {
    const html = renderLanguageView({ selected: "en", interactive: true, showAdminLine: false });
    expect(html).toContain('aria-describedby="language-explain"');
  });

  it("shows the offline banner with the last-synced marker", () => {
    const html = renderLanguageView({
      selected: "en",
      interactive: false,
      showAdminLine: false,
      lastSyncedAt: "2026-08-08T12:00:00.000Z",
    });
    expect(html).toContain("Offline");
    expect(html).toContain("2026-08-08T12:00:00.000Z");
  });

  it("shows the save-error copy under the list when passed", () => {
    const html = renderLanguageView({
      selected: "en",
      interactive: true,
      showAdminLine: false,
      saveError: t("language.errSave"),
    });
    expect(html).toContain(t("language.errSave"));
  });
});

describe("renderLanguage", () => {
  it("loading: renders the full list with no row checked", () => {
    const html = renderLanguage({ status: "loading" });
    expect(html.match(/aria-checked="true"/g)).toBeNull();
    for (const code of LANGUAGE_ORDER) {
      expect(html).toContain(languageName(code));
    }
  });

  it("error: shows the message and a retry action, not the language list", () => {
    const html = renderLanguage({ status: "error", message: "Couldn't load your language setting." });
    expect(html).toContain("Couldn't load your language setting.");
    expect(html).toContain('data-action="retry"');
    expect(html).not.toContain("English");
  });

  it("ready + admin: the account's language is checked and rows are interactive (no admin line)", () => {
    const html = renderLanguage({ status: "ready", language: "uk", role: "admin" }, { selected: "uk", saving: false });
    expect(html).toMatch(/aria-checked="true"[^>]*data-code="uk"/);
    expect(html).not.toContain("Only an account admin can change the language.");
  });

  it("ready + non-admin: the admin-only line shows and rows are inert", () => {
    const html = renderLanguage({ status: "ready", language: "uk", role: "member" }, { selected: "uk", saving: false });
    expect(html).toContain("Only an account admin can change the language.");
  });

  it("offline: the last-synced banner shows even for an admin", () => {
    const html = renderLanguage(
      { status: "offline", language: "ru", role: "admin", lastSyncedAt: "2026-08-08T09:00:00.000Z" },
      { selected: "ru", saving: false },
    );
    expect(html).toContain("Offline");
    expect(html).not.toContain("Only an account admin can change the language.");
  });

  it("saving: no row is interactive regardless of role", () => {
    const html = renderLanguage({ status: "ready", language: "en", role: "admin" }, { selected: "ru", saving: true });
    const disabledCount = (html.match(/ disabled>/g) ?? []).length;
    expect(disabledCount).toBe(LANGUAGE_ORDER.length);
  });
});

// -- i18n (U3.11) --------------------------------------------------------

describe("renders in Russian", () => {
  afterEach(() => setLanguage("en"));

  it("translates the section heading, explain line, admin line and save error — endonyms stay untranslated", () => {
    setLanguage("ru");
    const html = renderLanguageView({
      selected: "en",
      interactive: false,
      showAdminLine: true,
      saveError: t("language.errSave"),
    });
    expect(html).toContain(t("language.section"));
    expect(html).toContain(t("language.explainChrome"));
    expect(html).toContain(t("language.readonlyAdmin"));
    expect(html).toContain(t("language.errSave"));
    expect(html).toContain("English"); // the `en` row's endonym, unchanged by the active catalogue
    expect(html).toContain("Українська"); // the `uk` row's endonym, likewise
  });

  it("translates the load error", async () => {
    setLanguage("ru");
    const api: LanguageApi = {
      getMe: vi.fn().mockRejectedValue(new RetryableError()),
      updateAccount: vi.fn(),
    };
    const state = await loadLanguage(api, createMemoryCache());
    expect(state).toEqual({ status: "error", message: t("language.errLoad") });
  });
});
