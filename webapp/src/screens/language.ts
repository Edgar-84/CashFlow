/** Screen 09 — Language (docs/ui/screens/09-language.md). Reached only from
 * Settings' new "Language" row (U3.11) — the side menu itself gains no
 * eighth row (D706: resolved in favour of a row inside Settings).
 *
 * Unlike Settings' currency list, a row tap *is* the commit — no MainButton,
 * no confirm popup, no discard flow (screen doc's Delta section, and
 * U3.11's own AC: "picking a language PATCHes the account"). The moment a
 * PATCH resolves, `setLanguage()` (`lib/i18n.ts`) is called with the
 * confirmed value directly — no refetch, no `location.reload()` — so every
 * screen rendered after this one (Settings behind it, the side menu next
 * time it opens) picks it up for free, since `t()` reads the active
 * language live at render time (D716's third `setLanguage` call site).
 *
 * Same three-layer split as `settings.ts`:
 *  - data: `loadLanguage` — one `GET /users/me` call, never throws, same
 *    cache-fallback contract as `loadSettings`. The 3-row list is a
 *    constant (`LANGUAGE_ORDER`, names via `languageName()`).
 *  - controller: `createLanguageController` owns the displayed selection and
 *    fires the PATCH directly from `choose()` — no separate `select`/`save`
 *    step, because there's nothing to stage.
 *  - presentation: `renderLanguage`/`renderLanguageView` (pure, HTML
 *    strings) and `mount` (thin DOM glue, not meaningfully unit-tested,
 *    same accepted gap as every other screen's mount).
 */

import { haptics, mainButton, setBackButtonHandler } from "../lib/telegram";
import { setLanguage as applyActiveLanguage, t, type Catalogue } from "../lib/i18n";
import type { Language, Role } from "../api/types";

// -- data -------------------------------------------------------------------

/** `models/enums.py::Language`'s declared order (D701) — also this screen's
 * row order, and `settings.ts`'s row-5 preview (same list, same order). */
export const LANGUAGE_ORDER: readonly Language[] = ["en", "ru", "uk"];

/** Endonyms are deliberately identical across all three catalogues (screen
 * doc's Copy note: a language's own name doesn't change with the *viewer's*
 * language), so this lookup is stable regardless of which catalogue is
 * active — unlike `settings.ts::currencyName`, which *is* translated. */
const LANGUAGE_NAME_KEYS: Readonly<Record<Language, keyof Catalogue>> = {
  en: "language.name.en",
  ru: "language.name.ru",
  uk: "language.name.uk",
};

export function languageName(code: Language): string {
  return t(LANGUAGE_NAME_KEYS[code]);
}

export interface LanguageData {
  language: Language;
  role: Role;
}

export interface LanguageApi {
  getMe(): Promise<{ language: Language; role: Role }>;
  updateAccount(data: { language: Language }): Promise<{ language: Language }>;
}

export interface LanguageSnapshot {
  data: LanguageData;
  syncedAt: string;
}

export interface LanguageCache {
  get(): LanguageSnapshot | null;
  set(snapshot: LanguageSnapshot): void;
}

export function createMemoryCache(): LanguageCache {
  let snapshot: LanguageSnapshot | null = null;
  return {
    get: () => snapshot,
    set: (next) => {
      snapshot = next;
    },
  };
}

export type LanguageState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | ({ status: "ready" } & LanguageData)
  | ({ status: "offline"; lastSyncedAt: string } & LanguageData);

/** Never throws — same contract as `settings.ts::loadSettings`. `GET
 * /users/me` has no role gate, so the admin gate is a `ready`/`offline`
 * sub-case (`role !== "admin"`), rendered inline (screen doc's 403/non-admin
 * state still shows the current language). */
export async function loadLanguage(api: LanguageApi, cache: LanguageCache): Promise<LanguageState> {
  try {
    const me = await api.getMe();
    const data: LanguageData = { language: me.language, role: me.role };
    cache.set({ data, syncedAt: new Date().toISOString() });
    return { status: "ready", ...data };
  } catch {
    const cached = cache.get();
    if (cached) {
      return { status: "offline", lastSyncedAt: cached.syncedAt, ...cached.data };
    }
    return { status: "error", message: t("language.errLoad") };
  }
}

// -- controller ---------------------------------------------------------

export type LanguageSaveOutcome =
  | { status: "success"; language: Language }
  | { status: "blocked" }
  | { status: "error"; message: string };

export interface LanguageController {
  getSelected(): Language;
  choose(code: Language): Promise<LanguageSaveOutcome>;
}

/** A row tap's single entry point — mirrors `settings.ts`'s controller
 * except there is no separate `select`, because a tap *is* the commit.
 * `choose(code)` is a no-op (`blocked`, no PATCH) when `code` is already the
 * confirmed selection (screen doc's Interactions: "the row that IS the
 * current selection | tap | nothing") — **except** right after a failed
 * attempt, when *any* tap, including a re-tap of the same row, retries
 * (States: "Save failed... tapping any row — including the one just
 * attempted — retries"), because nothing was actually confirmed by that
 * attempt. `failed` tracks exactly that: it clears on a successful choose
 * and is set on a failed one. */
export function createLanguageController(api: LanguageApi, original: Language): LanguageController {
  let selected: Language = original;
  let submitting = false;
  let failed = false;

  return {
    getSelected: () => selected,
    async choose(code: Language): Promise<LanguageSaveOutcome> {
      if (submitting) {
        return { status: "blocked" };
      }
      if (code === selected && !failed) {
        return { status: "blocked" };
      }
      selected = code;
      submitting = true;
      try {
        const account = await api.updateAccount({ language: code });
        failed = false;
        return { status: "success", language: account.language };
      } catch {
        failed = true;
        return { status: "error", message: t("language.errSave") };
      } finally {
        submitting = false;
      }
    },
  };
}

// -- presentation ---------------------------------------------------------

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function renderError(message: string): string {
  return `<div class="settings-error" data-testid="error">
    <p>${escapeHtml(message)}</p>
    <button type="button" data-action="retry">${escapeHtml(t("error.retry"))}</button>
  </div>`;
}

function renderRow(code: Language, checked: boolean, interactive: boolean): string {
  return `<button type="button" class="settings-row" role="radio" aria-checked="${checked}" data-testid="language-row" data-code="${code}"${interactive ? "" : " disabled"}>
    <span class="lang-row-text">
      <span class="lang-row-endonym">${escapeHtml(languageName(code))}</span>
      <span class="lang-row-code">${code.toUpperCase()}</span>
    </span>
    ${checked ? `<span class="settings-row-check" aria-hidden="true">✓</span>` : ""}
  </button>`;
}

export interface LanguageViewOptions {
  /** `null` only while `status === "loading"` — no row is marked yet. */
  selected: Language | null;
  /** Rows respond to taps only when `true` (`ready`, admin, not currently
   * saving). Offline and non-admin are both always non-interactive —
   * offline because this is a write with no queue, non-admin because of the
   * permission gate. */
  interactive: boolean;
  /** Screen doc's 403/non-admin line — shown whenever the caller's role is
   * known and isn't `admin`, in both `ready` and `offline`. */
  showAdminLine: boolean;
  lastSyncedAt?: string;
  saveError?: string | null;
}

export function renderLanguageView(options: LanguageViewOptions): string {
  const rows = LANGUAGE_ORDER.map((code) => renderRow(code, options.selected === code, options.interactive)).join("");
  const describedBy = options.showAdminLine ? "language-explain language-admin-line" : "language-explain";
  const sectionLabel = escapeHtml(t("language.section"));
  return `<div class="settings-view" data-testid="ready">
    <div class="settings-eyebrow">${sectionLabel}</div>
    <p class="settings-warning" id="language-explain">${escapeHtml(t("language.explainChrome"))}</p>
    ${options.showAdminLine ? `<p class="settings-admin-line" id="language-admin-line" data-testid="admin-line">${escapeHtml(t("language.readonlyAdmin"))}</p>` : ""}
    ${options.lastSyncedAt ? `<div class="offline-banner" data-testid="offline">${t("offline.banner", { time: options.lastSyncedAt })}</div>` : ""}
    <div class="card settings-list" role="radiogroup" aria-label="${sectionLabel}" aria-describedby="${describedBy}"${options.showAdminLine ? ' aria-readonly="true"' : ""} data-testid="language-list">
      ${rows}
    </div>
    ${options.saveError ? `<p class="settings-save-error" data-testid="save-error">${escapeHtml(options.saveError)}</p>` : ""}
  </div>`;
}

export function renderLanguage(
  state: LanguageState,
  ui: { selected: Language | null; saving: boolean; saveError?: string | null } = {
    selected: null,
    saving: false,
    saveError: null,
  },
): string {
  if (state.status === "loading") {
    return renderLanguageView({ selected: null, interactive: false, showAdminLine: false });
  }
  if (state.status === "error") {
    return renderError(state.message);
  }
  const isAdmin = state.role === "admin";
  const interactive = state.status === "ready" && isAdmin && !ui.saving;
  return renderLanguageView({
    selected: ui.selected,
    interactive,
    showAdminLine: !isAdmin,
    lastSyncedAt: state.status === "offline" ? state.lastSyncedAt : undefined,
    saveError: ui.saveError,
  });
}

// -- mount (DOM glue; not meaningfully unit-testable under Node, same
//    accepted gap as every other screen's mount) ---------------------------

export interface LanguageHandlers {
  onRetry: () => void;
  onBack: () => void;
  /** Fires once a chosen language's PATCH resolves — main.ts navigates back
   * to Settings (screen doc: "the screen returns to Settings"). */
  onSaved: () => void;
}

/** Called by `main.ts` before *and* after the `GET /users/me` fetch — this
 * screen never shows a MainButton (screen doc's Telegram section: "no
 * separate save action for a MainButton to trigger"), and calling this
 * before the fetch resolves avoids a flash of Settings' "Save currency"
 * MainButton while Language is loading, same shape as
 * `categories.ts::applyCategoriesChrome`. */
export function applyLanguageChrome(onBack: () => void): void {
  setBackButtonHandler(onBack);
  mainButton.hide();
}

export function mount(root: HTMLElement, state: LanguageState, api: LanguageApi, handlers: LanguageHandlers): void {
  if (typeof document === "undefined") {
    return;
  }

  if (state.status === "loading" || state.status === "error") {
    root.innerHTML = renderLanguage(state);
    root.querySelector('[data-action="retry"]')?.addEventListener("click", handlers.onRetry);
    return;
  }

  const controller = createLanguageController(api, state.language);
  let saving = false;
  let saveError: string | null = null;

  const render = (): void => {
    root.innerHTML = renderLanguage(state, { selected: controller.getSelected(), saving, saveError });
    wire();
  };

  function wire(): void {
    root.querySelectorAll<HTMLButtonElement>('[data-testid="language-row"]:not([disabled])').forEach((el) => {
      el.addEventListener("click", () => {
        const code = el.dataset.code as Language;
        // Mirrors `createLanguageController.choose`'s own no-op guard, so
        // the selection haptic never fires for a tap that will be blocked —
        // a re-tap after a failed attempt (`saveError` set) still proceeds.
        if (code === controller.getSelected() && !saveError) {
          return;
        }
        haptics.selection();
        void attempt(code);
      });
    });
  }

  async function attempt(code: Language): Promise<void> {
    saving = true;
    render();
    const outcome = await controller.choose(code);
    saving = false;
    if (outcome.status === "success") {
      haptics.notification("success");
      applyActiveLanguage(outcome.language);
      handlers.onSaved();
      return;
    }
    if (outcome.status === "error") {
      haptics.notification("error");
      saveError = outcome.message;
    }
    render();
  }

  render();
}
