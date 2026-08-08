/** Screen 08 — Settings (docs/ui/screens/08-settings.md). Reached from the
 * side menu's seventh row (U3.2) and nowhere else. V4 ships exactly one
 * setting: the account's display currency (D400/D401 — a relabel, never a
 * conversion; `expenses.amount` is untouched minor units).
 *
 * Same three-layer split as every other screen:
 *  - data: `loadSettings` — one `GET /users/me` call (already returns
 *    `currency` and `role`, D211/D401), never throws, same cache-fallback
 *    contract as `loadHome`/`loadTags`. The 15-row list itself is a
 *    constant (`CURRENCY_ORDER`/`CURRENCY_NAMES`), not fetched.
 *  - controller: `createSettingsController` owns the in-progress selection
 *    and the `PATCH /accounts/me` round trip, same double-submit guard
 *    shape as `tags.ts::createTagFormController`.
 *  - presentation: `renderSettings` (pure, HTML strings) and `mount` (thin
 *    DOM glue, the one part with no meaningful unit test — same accepted
 *    gap as every other screen's mount).
 *
 * Unlike every other screen's MainButton, Save is gated behind Telegram's
 * confirm popup (screen doc's Telegram section) — the one write in this app
 * that relabels every amount for every family member, so it gets a second
 * "are you sure" beyond the usual dirty-check enable/disable.
 */

import { confirmAction, confirmDiscard, haptics, mainButton, setBackButtonHandler } from "../lib/telegram";
import type { Currency, Role } from "../api/types";

// -- data ---------------------------------------------------------------

/** `models/enums.py::Currency`'s declared order (D211) — also this screen's
 * row order (screen doc: "the same order the API would list them in"). */
export const CURRENCY_ORDER: readonly Currency[] = [
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
];

/** Client-side copy, not an API field (screen doc's Copy note: naming a
 * currency isn't validation, so it doesn't belong on the backend enum). */
export const CURRENCY_NAMES: Readonly<Record<Currency, string>> = {
  USD: "US Dollar",
  EUR: "Euro",
  GBP: "British Pound",
  PLN: "Polish Złoty",
  UAH: "Ukrainian Hryvnia",
  CZK: "Czech Koruna",
  CHF: "Swiss Franc",
  SEK: "Swedish Krona",
  NOK: "Norwegian Krone",
  DKK: "Danish Krone",
  JPY: "Japanese Yen",
  CNY: "Chinese Yuan",
  CAD: "Canadian Dollar",
  AUD: "Australian Dollar",
  TRY: "Turkish Lira",
};

export interface SettingsData {
  currency: Currency;
  role: Role;
}

export interface SettingsApi {
  getMe(): Promise<{ currency: Currency; role: Role }>;
  updateAccount(data: { currency: Currency }): Promise<{ currency: Currency }>;
}

export interface SettingsSnapshot {
  data: SettingsData;
  syncedAt: string;
}

export interface SettingsCache {
  get(): SettingsSnapshot | null;
  set(snapshot: SettingsSnapshot): void;
}

export function createMemoryCache(): SettingsCache {
  let snapshot: SettingsSnapshot | null = null;
  return {
    get: () => snapshot,
    set: (next) => {
      snapshot = next;
    },
  };
}

export type SettingsState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | ({ status: "ready" } & SettingsData)
  | ({ status: "offline"; lastSyncedAt: string } & SettingsData);

const LOAD_ERROR = "Couldn't load your settings.";
export const SAVE_ERROR = "Couldn't change the currency.";

/** Never throws — every failure resolves to a `SettingsState` the caller can
 * render directly, same contract as `loadHome`/`loadTags`. `GET /users/me`
 * has no role gate (every authenticated user can read their own account), so
 * unlike `loadBudgets`/`loadTags` there is no `forbidden` status here — the
 * admin gate is a `ready`/`offline` sub-case (`role !== "admin"`), rendered
 * inline (screen doc's 403/non-admin state still shows the current
 * currency). */
export async function loadSettings(api: SettingsApi, cache: SettingsCache): Promise<SettingsState> {
  try {
    const me = await api.getMe();
    const data: SettingsData = { currency: me.currency, role: me.role };
    cache.set({ data, syncedAt: new Date().toISOString() });
    return { status: "ready", ...data };
  } catch {
    const cached = cache.get();
    if (cached) {
      return { status: "offline", lastSyncedAt: cached.syncedAt, ...cached.data };
    }
    return { status: "error", message: LOAD_ERROR };
  }
}

// -- controller ---------------------------------------------------------

export type SettingsSaveOutcome =
  | { status: "success"; currency: Currency }
  | { status: "blocked" }
  | { status: "error"; message: string };

export interface SettingsController {
  getSelected(): Currency;
  select(code: Currency): void;
  isDirty(): boolean;
  save(): Promise<SettingsSaveOutcome>;
}

/** Owns the draft selection and the double-submit guard — same shape as
 * `tags.ts::createTagFormController`: `submitting` flips synchronously
 * before the first `await`, so a real double-tap's second call is rejected
 * before either resolves. */
export function createSettingsController(api: SettingsApi, original: Currency): SettingsController {
  let selected: Currency = original;
  let submitting = false;

  return {
    getSelected: () => selected,
    select(code): void {
      selected = code;
    },
    isDirty: () => selected !== original,
    async save(): Promise<SettingsSaveOutcome> {
      if (submitting || selected === original) {
        return { status: "blocked" };
      }
      submitting = true;
      try {
        const account = await api.updateAccount({ currency: selected });
        return { status: "success", currency: account.currency };
      } catch {
        return { status: "error", message: SAVE_ERROR };
      } finally {
        submitting = false;
      }
    },
  };
}

/** The Telegram confirm popup's message (screen doc's `confirm.message`,
 * folded into one string with `confirm.title`'s framing — Telegram's own
 * `showConfirm` has no separate title/custom button text, same constraint
 * every other confirm flow in this app already works within, e.g.
 * `tags.ts::tagDeleteConfirmMessage`). */
export function settingsConfirmMessage(target: Currency): string {
  return `Change currency? Every amount in this account will be shown in ${target}. Existing amounts are not converted.`;
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
    <button type="button" data-action="retry">Try again</button>
  </div>`;
}

function renderRow(code: Currency, checked: boolean, interactive: boolean): string {
  return `<button type="button" class="settings-row" role="radio" aria-checked="${checked}" data-testid="settings-row" data-code="${code}"${interactive ? "" : " disabled"}>
    <span class="settings-row-code">${code}</span>
    <span class="settings-row-name">${CURRENCY_NAMES[code]}</span>
    ${checked ? `<span class="settings-row-check" aria-hidden="true">✓</span>` : ""}
  </button>`;
}

export interface SettingsViewOptions {
  /** `null` only while `status === "loading"` — no row is marked yet. */
  selected: Currency | null;
  /** Rows respond to taps and MainButton is wired only when `true`
   * (`ready`, admin, not currently saving). Offline and non-admin are both
   * always non-interactive — offline because this is a write with no queue,
   * non-admin because of the permission gate. */
  interactive: boolean;
  /** The screen doc's 403/non-admin line — shown whenever the caller's role
   * is known and isn't `admin`, in both `ready` and `offline`. */
  showAdminLine: boolean;
  lastSyncedAt?: string;
  saveError?: string | null;
}

export function renderSettingsView(options: SettingsViewOptions): string {
  const rows = CURRENCY_ORDER.map((code) =>
    renderRow(code, options.selected === code, options.interactive),
  ).join("");
  // Non-admin gets both descriptions on the group (component's own explanation
  // is otherwise sighted-only text with no ARIA association to the radios it
  // explains — screen-reader parity with the visible "why" line).
  const describedBy = options.showAdminLine ? "settings-warning settings-admin-line" : "settings-warning";
  return `<div class="settings-view" data-testid="ready">
    <div class="settings-eyebrow">Currency</div>
    <p class="settings-warning" id="settings-warning">Changing the currency relabels existing amounts. It does not convert them — 50.00 stays 50.00.</p>
    ${options.showAdminLine ? `<p class="settings-admin-line" id="settings-admin-line" data-testid="admin-line">Only an account admin can change the currency.</p>` : ""}
    ${options.lastSyncedAt ? `<div class="offline-banner" data-testid="offline">Offline — showing data from ${escapeHtml(options.lastSyncedAt)}</div>` : ""}
    <div class="card settings-list" role="radiogroup" aria-label="Currency" aria-describedby="${describedBy}"${options.showAdminLine ? ' aria-readonly="true"' : ""} data-testid="settings-list">
      ${rows}
    </div>
    ${options.saveError ? `<p class="settings-save-error" data-testid="save-error">${escapeHtml(options.saveError)}</p>` : ""}
  </div>`;
}

export function renderSettings(
  state: SettingsState,
  ui: { selected: Currency | null; saving: boolean; saveError?: string | null } = {
    selected: null,
    saving: false,
    saveError: null,
  },
): string {
  if (state.status === "loading") {
    return renderSettingsView({ selected: null, interactive: false, showAdminLine: false });
  }
  if (state.status === "error") {
    return renderError(state.message);
  }
  const isAdmin = state.role === "admin";
  const interactive = state.status === "ready" && isAdmin && !ui.saving;
  return renderSettingsView({
    selected: ui.selected,
    interactive,
    showAdminLine: !isAdmin,
    lastSyncedAt: state.status === "offline" ? state.lastSyncedAt : undefined,
    saveError: ui.saveError,
  });
}

// -- mount (DOM glue; not meaningfully unit-testable under Node, same
//    accepted gap as every other screen's mount) ---------------------------

export interface SettingsHandlers {
  onRetry: () => void;
  onBack: () => void;
  /** Fires once the PATCH resolves — main.ts navigates back to Home, which
   * refetches and relabels every amount (screen doc's Saved state). */
  onSaved: () => void;
}

export function mount(root: HTMLElement, state: SettingsState, api: SettingsApi, handlers: SettingsHandlers): void {
  if (typeof document === "undefined") {
    return;
  }

  if (state.status === "loading" || state.status === "error") {
    root.innerHTML = renderSettings(state);
    root.querySelector('[data-action="retry"]')?.addEventListener("click", handlers.onRetry);
    setBackButtonHandler(handlers.onBack);
    mainButton.hide();
    return;
  }

  const controller = createSettingsController(api, state.currency);
  let saving = false;
  let saveError: string | null = null;
  const isAdmin = state.role === "admin";

  const applyChrome = (): void => {
    const interactive = state.status === "ready" && isAdmin && !saving;
    if (!interactive) {
      mainButton.hide();
    } else {
      mainButton.show("Save currency");
      mainButton.setEnabled(controller.isDirty());
    }
  };

  const render = (): void => {
    root.innerHTML = renderSettings(state, { selected: controller.getSelected(), saving, saveError });
    wire();
    applyChrome();
  };

  function wire(): void {
    root.querySelectorAll<HTMLButtonElement>('[data-testid="settings-row"]:not([disabled])').forEach((el) => {
      el.addEventListener("click", () => {
        const code = el.dataset.code as Currency;
        haptics.selection();
        controller.select(code);
        render();
      });
    });
  }

  setBackButtonHandler(() => {
    void (async () => {
      if (!controller.isDirty()) {
        handlers.onBack();
        return;
      }
      const discard = await confirmDiscard("Discard changes?");
      if (discard) {
        handlers.onBack();
      }
    })();
  });

  mainButton.onClick(() => {
    void (async () => {
      const target = controller.getSelected();
      const confirmed = await confirmAction(settingsConfirmMessage(target));
      if (!confirmed) {
        return;
      }
      saving = true;
      saveError = null;
      render();
      const outcome = await controller.save();
      if (outcome.status === "success") {
        haptics.notification("success");
        handlers.onSaved();
        return;
      }
      saving = false;
      if (outcome.status === "error") {
        haptics.notification("error");
        saveError = outcome.message;
      }
      render();
    })();
  });

  render();
}
