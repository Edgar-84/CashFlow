/** Screen 10 — Admin (docs/ui/screens/10-admin.md). Reached only from the
 * side menu's eighth row, gated on `role === "system_admin"` (U4.10 — not
 * wired yet; this unit builds the screen itself, matching task-methodology's
 * own decomposition order of pure rendering before wiring). U4.7 covered the
 * Accounts/Users lists and the screen's four top-level states (loading,
 * error, 403, ready); U4.8 wired the Block/Unblock trigger on each row. This
 * unit (U4.9) adds Create-account mode: List mode's MainButton switches
 * `mount`'s internal `mode` to `"create"`, replacing the two lists with
 * `renderCreateForm` in place — same screen instance, no navigation, per the
 * screen doc's Layout section.
 *
 * Unlike every other screen, there is no cache: `10-admin.md`'s States
 * table is explicit that this screen never persists cross-account data
 * locally, so a fetch failure — offline included — renders the same `error`
 * state as any other failure, with no `offline` status of its own.
 *
 * `loadAdmin`'s 403 state is a *real* one, not the `ready`/`offline`
 * sub-case `settings.ts`/`language.ts` use for their own admin gate — those
 * two call `GET /users/me`, which has no role check; this screen's data
 * comes from `GET /admin/accounts`/`GET /admin/users`, both gated
 * server-side by `require_system_admin` (U4.3), so a non-system-admin's
 * fetch genuinely 403s and `ForbiddenError` is caught the same way
 * `budgets.ts::loadBudgets` already catches its own role gate.
 *
 * Three-layer split, same shape as every other screen:
 *  - data: `loadAdmin`, the pure `buildAccountRowView`/`buildUserRowView`
 *    row-model builders, the block confirm/failure copy builders,
 *    `createAdminBlockController` (U4.8) and `createAdminCreateController`
 *    (U4.9, the create form's own double-submit guard, same shape as
 *    `budget-form.ts::createBudgetFormController`) — all directly
 *    unit-tested, no DOM.
 *  - presentation: `renderAdmin` (List mode) and `renderCreateForm` (Create
 *    mode) — both pure, HTML strings.
 *  - mount: thin DOM glue, not meaningfully unit-tested, same accepted gap
 *    as every other screen's mount. Owns the List/Create mode switch itself
 *    (`mode`, `createController`) since neither `AdminState` nor
 *    `renderAdmin`'s own contract changed for this unit — Create mode is
 *    entirely mount-local state, matching `budget-form.ts`'s own single-mode
 *    screen instead of widening `AdminState` for a mode that isn't fetched
 *    data.
 */

import { ApiError, ForbiddenError } from "../api/client";
import type { AdminAccountCreate, AdminAccountRow, AdminUserRow, Currency, Language, Role, Uuid } from "../api/types";
import { t, type Catalogue } from "../lib/i18n";
import { confirmAction, confirmDiscard, haptics, mainButton, setBackButtonHandler } from "../lib/telegram";
import { LANGUAGE_ORDER, languageName } from "./language";
import { CURRENCY_ORDER, currencyName } from "./settings";

// -- data ---------------------------------------------------------------

export interface AdminApi {
  getMe(): Promise<{ id: Uuid; account_id: Uuid }>;
  listAdminAccounts(): Promise<AdminAccountRow[]>;
  listAdminUsers(): Promise<AdminUserRow[]>;
  blockAdminAccount(id: Uuid, isBlocked: boolean): Promise<unknown>;
  blockAdminUser(id: Uuid, isBlocked: boolean): Promise<unknown>;
  createAdminAccount(data: AdminAccountCreate): Promise<AdminAccountRow>;
}

export interface AdminData {
  accounts: AdminAccountRow[];
  users: AdminUserRow[];
  /** The caller's own account/user ids (from `GET /users/me`) — used to
   * disable the two self-block triggers (screen doc's Data section). */
  selfAccountId: Uuid;
  selfUserId: Uuid;
}

export type AdminState =
  | { status: "loading" }
  | { status: "forbidden" }
  | { status: "error"; message: string }
  | ({ status: "ready" } & AdminData);

/** Never throws — every failure resolves to an `AdminState` the caller can
 * render directly. A `ForbiddenError` from either admin list call is the
 * screen's real 403 state (see file header); anything else — including
 * offline, which this screen has no cache to fall back on — is the fixed
 * `err.load` copy. */
export async function loadAdmin(api: AdminApi): Promise<AdminState> {
  try {
    const [me, accounts, users] = await Promise.all([api.getMe(), api.listAdminAccounts(), api.listAdminUsers()]);
    return { status: "ready", accounts, users, selfAccountId: me.account_id, selfUserId: me.id };
  } catch (err) {
    if (err instanceof ForbiddenError) {
      return { status: "forbidden" };
    }
    return { status: "error", message: t("admin.errLoad") };
  }
}

// -- row view models ------------------------------------------------------

const ROLE_NAME_KEYS: Readonly<Record<Role, keyof Catalogue>> = {
  system_admin: "admin.role.system_admin",
  admin: "admin.role.admin",
  member: "admin.role.member",
  viewer: "admin.role.viewer",
};

export function roleName(role: Role): string {
  return t(ROLE_NAME_KEYS[role]);
}

/** The set of currently-blocked accounts' ids — computed once per render
 * from the already-loaded Accounts list, never a second fetch (screen doc:
 * "computed client-side from the two lists this screen already has"). */
export function blockedAccountIds(accounts: readonly AdminAccountRow[]): ReadonlySet<Uuid> {
  return new Set(accounts.filter((a) => a.is_blocked).map((a) => a.id));
}

export interface AdminAccountRowView {
  id: Uuid;
  name: string;
  meta: string;
  isBlocked: boolean;
  triggerLabel: string;
  /** `null` when the trigger is enabled (U4.8 wires its click). Set only for
   * the caller's own account — this app never lets a system admin block the
   * account they're using (screen doc's Edge cases; U4.5's 422 is a
   * server-side backstop this UI should never actually trigger). */
  disabledReason: string | null;
}

export function buildAccountRowView(row: AdminAccountRow, selfAccountId: Uuid): AdminAccountRowView {
  const metaKey = row.user_count === 1 ? "admin.account.meta.one" : "admin.account.meta.many";
  return {
    id: row.id,
    name: row.name,
    meta: t(metaKey, { currency: row.currency, language: languageName(row.language), n: row.user_count }),
    isBlocked: row.is_blocked,
    triggerLabel: row.is_blocked ? t("admin.trigger.unblock") : t("admin.trigger.block"),
    disabledReason: row.id === selfAccountId ? t("admin.disabled.selfAccount") : null,
  };
}

export interface AdminUserRowView {
  id: Uuid;
  name: string;
  meta: string;
  /** True when either the user's own `is_blocked` is set or their account is
   * currently blocked (D714 — the two flags are independent, so both are
   * checked; neither alone tells the whole story). Drives the Suspended
   * badge only. */
  isSuspended: boolean;
  /** The user's own `is_blocked`, independent of `isSuspended` — drives
   * `triggerLabel` and the trigger's colour (D714: toggling this flag is
   * always about the user themself, never the account they happen to be
   * suspended through). */
  ownBlocked: boolean;
  triggerLabel: string;
  disabledReason: string | null;
}

export function buildUserRowView(
  row: AdminUserRow,
  selfUserId: Uuid,
  blockedAccounts: ReadonlySet<Uuid>,
): AdminUserRowView {
  const accountBlocked = blockedAccounts.has(row.account_id);
  let disabledReason: string | null = null;
  if (row.id === selfUserId) {
    disabledReason = t("admin.disabled.selfUser");
  } else if (accountBlocked) {
    // Toggling this user's own flag would change nothing they actually
    // experience while their account is blocked (D714) — disabled rather
    // than offering a control with no observable effect.
    disabledReason = t("admin.disabled.accountBlocked");
  }
  return {
    id: row.id,
    name: row.name,
    meta: t("admin.user.meta", { accountName: row.account_name, role: roleName(row.role), tgId: row.tg_id }),
    isSuspended: row.is_blocked || accountBlocked,
    ownBlocked: row.is_blocked,
    triggerLabel: row.is_blocked ? t("admin.trigger.unblock") : t("admin.trigger.block"),
    disabledReason,
  };
}

// -- block/unblock (U4.8) --------------------------------------------------

/** Immutable flip of one account row's `is_blocked` — the optimistic update
 * and its own revert-on-failure both call this, just with the opposite
 * `isBlocked` value. A missing `id` is a no-op, not an error: the caller's
 * local list may already be stale by one render if two admins act at once
 * (screen doc's Edge cases — "last write wins, no concurrency token"). */
export function withAccountBlocked(accounts: readonly AdminAccountRow[], id: Uuid, isBlocked: boolean): AdminAccountRow[] {
  return accounts.map((a) => (a.id === id ? { ...a, is_blocked: isBlocked } : a));
}

export function withUserBlocked(users: readonly AdminUserRow[], id: Uuid, isBlocked: boolean): AdminUserRow[] {
  return users.map((u) => (u.id === id ? { ...u, is_blocked: isBlocked } : u));
}

/** A pending block/unblock failure to show above the affected list — `null`
 * when none is in flight. Mirrors `categories.ts::CategoryDeleteFailure`'s
 * shape; `nextBlocked` is the direction that failed, so "Try again" can
 * re-issue the identical PATCH without re-opening the confirm popup (same
 * rule `main.ts::onRetryDelete` already follows for 06c). */
export interface AdminBlockFailure {
  kind: "account" | "user";
  id: Uuid;
  name: string;
  nextBlocked: boolean;
}

// Private, non-escaping substitution for strings fed to native Telegram
// chrome (`confirmAction`) — same "pure modules don't share helpers"
// convention every other screen's own copy already follows (e.g.
// `categories.ts::fillTemplate`).
function fillTemplate(template: string, vars: Record<string, string>): string {
  return template.replace(/\{(\w+)\}/g, (match, name: string) => (name in vars ? vars[name] : match));
}

const BLOCK_CONFIRM_KEYS: Readonly<Record<"account" | "user", Readonly<Record<"block" | "unblock", keyof Catalogue>>>> = {
  account: { block: "admin.confirm.blockAccount", unblock: "admin.confirm.unblockAccount" },
  user: { block: "admin.confirm.blockUser", unblock: "admin.confirm.unblockUser" },
};

/** The Telegram confirm popup's message (screen doc's `confirm.block.*`/
 * `confirm.unblock.*`). `confirm.yes.*`/`confirm.cancel` from the screen
 * doc's Copy table have no call site: `showConfirm` has no custom button
 * text (same constraint `settings.ts::settingsConfirmMessage` already
 * documents), so those keys would be dead catalogue entries. */
export function adminBlockConfirmMessage(kind: "account" | "user", name: string, nextBlocked: boolean): string {
  const key = BLOCK_CONFIRM_KEYS[kind][nextBlocked ? "block" : "unblock"];
  const varName = kind === "account" ? "accountName" : "userName";
  return fillTemplate(t(key), { [varName]: name });
}

/** The retry banner's message (screen doc's `block.failed`). */
export function adminBlockFailureMessage(name: string): string {
  return fillTemplate(t("admin.block.failed"), { name });
}

export type AdminBlockOutcome = { status: "success" } | { status: "blocked" } | { status: "error" };

export interface AdminBlockController {
  isPending(kind: "account" | "user", id: Uuid): boolean;
  toggle(kind: "account" | "user", id: Uuid, nextBlocked: boolean): Promise<AdminBlockOutcome>;
}

/** Owns the double-submit guard for the block/unblock PATCH — same shape as
 * `settings.ts::createSettingsController`'s `submitting` flag, keyed per
 * target so blocking one account and unblocking a different user at the
 * same time are independent, but a duplicate tap on the *same* trigger while
 * its own request is in flight is rejected before a second PATCH fires. */
export function createAdminBlockController(api: AdminApi): AdminBlockController {
  const pending = new Set<string>();
  const keyOf = (kind: "account" | "user", id: Uuid): string => `${kind}:${id}`;

  return {
    isPending(kind, id) {
      return pending.has(keyOf(kind, id));
    },
    async toggle(kind, id, nextBlocked) {
      const key = keyOf(kind, id);
      if (pending.has(key)) {
        return { status: "blocked" };
      }
      pending.add(key);
      try {
        if (kind === "account") {
          await api.blockAdminAccount(id, nextBlocked);
        } else {
          await api.blockAdminUser(id, nextBlocked);
        }
        return { status: "success" };
      } catch {
        return { status: "error" };
      } finally {
        pending.delete(key);
      }
    },
  };
}

// -- create-account form (U4.9, 10-admin.md's Create-account mode) --------

export interface CreateAccountDraft {
  name: string;
  currency: Currency;
  language: Language;
  /** Raw text, not yet parsed — `createOwnerTgIdError` validates it and
   * `createAdminCreateController::submit` converts it to `number` only once
   * the whole draft is valid (screen doc's Edge cases: caught client-side,
   * never reaches the network). */
  ownerTgId: string;
  ownerName: string;
}

/** The form's opening state (screen doc's Layout table: defaults to USD/
 * English) — also `isCreateFormDirty`'s baseline. */
export const EMPTY_CREATE_DRAFT: CreateAccountDraft = {
  name: "",
  currency: "USD",
  language: "en",
  ownerTgId: "",
  ownerName: "",
};

/** `null` while valid; inline error text otherwise. Same "empty is invalid,
 * not merely untouched" shape as `categories.ts::categoryNameError` —
 * `mount`'s own `attempted` flag (not part of this pure function) decides
 * *when* to display it, matching every other field-error line in this app. */
export function createNameError(name: string): string | null {
  return name.trim() === "" ? t("admin.create.field.name.error") : null;
}

/** Real Telegram user ids fit well inside `Number.MAX_SAFE_INTEGER`; this
 * guard exists so an absurdly long digit string fails here, client-side,
 * rather than silently losing precision through `Number(...)` in
 * `createAdminCreateController::submit` and posting the wrong id with no
 * error surfaced anywhere (reviewer finding, U4.9 round 1). */
export function createOwnerTgIdError(ownerTgId: string): string | null {
  const trimmed = ownerTgId.trim();
  if (!/^\d+$/.test(trimmed) || !Number.isSafeInteger(Number(trimmed))) {
    return t("admin.create.field.ownerTgId.error");
  }
  return null;
}

export function createOwnerNameError(ownerName: string): string | null {
  return ownerName.trim() === "" ? t("admin.create.field.ownerName.error") : null;
}

/** Currency/language are never invalid — both are `<select>`s seeded with a
 * real default (screen doc's AC: name, owner Telegram ID and owner name are
 * the three fields that can actually fail). */
export function createFormValid(draft: CreateAccountDraft): boolean {
  return (
    createNameError(draft.name) === null &&
    createOwnerTgIdError(draft.ownerTgId) === null &&
    createOwnerNameError(draft.ownerName) === null
  );
}

/** Dirty rule (screen doc's Interactions section): any field differs from
 * `EMPTY_CREATE_DRAFT`. Gates Cancel/BackButton's discard popup. */
export function isCreateFormDirty(draft: CreateAccountDraft): boolean {
  return (
    draft.name.trim() !== "" ||
    draft.currency !== EMPTY_CREATE_DRAFT.currency ||
    draft.language !== EMPTY_CREATE_DRAFT.language ||
    draft.ownerTgId.trim() !== "" ||
    draft.ownerName.trim() !== ""
  );
}

/** The create-confirm popup's message (screen doc's `create.confirm.message`)
 * — fed to `confirmAction`, so non-escaping `fillTemplate` like every other
 * native-chrome message in this file. Trims every value the same way
 * `createAdminCreateController::submit` trims the POST body, so the popup
 * never shows leading/trailing whitespace the actual request wouldn't send
 * (reviewer finding, U4.9 round 1). */
export function createAccountConfirmMessage(draft: CreateAccountDraft): string {
  return fillTemplate(t("admin.create.confirm.message"), {
    ownerName: draft.ownerName.trim(),
    tgId: draft.ownerTgId.trim(),
    accountName: draft.name.trim(),
  });
}

function createAccountErrorMessage(err: unknown): string {
  if (err instanceof ApiError && err.status === 409) {
    return t("admin.create.error.duplicateOwner");
  }
  return t("admin.create.error.generic");
}

export type CreateAccountOutcome =
  | { status: "success"; account: AdminAccountRow }
  | { status: "blocked" }
  | { status: "error"; message: string };

export interface AdminCreateController {
  getDraft(): CreateAccountDraft;
  setField<K extends keyof CreateAccountDraft>(field: K, value: CreateAccountDraft[K]): void;
  submit(): Promise<CreateAccountOutcome>;
}

/** Owns the draft and the `POST /admin/accounts` round trip. `submitting`
 * flips true synchronously (before the first `await`) so a double tap is
 * rejected before a second request fires — same guard shape
 * `budget-form.ts::createBudgetFormController` uses for its own `save`. */
export function createAdminCreateController(api: AdminApi): AdminCreateController {
  let draft: CreateAccountDraft = { ...EMPTY_CREATE_DRAFT };
  let submitting = false;

  return {
    getDraft: () => draft,
    setField(field, value): void {
      draft = { ...draft, [field]: value };
    },
    async submit(): Promise<CreateAccountOutcome> {
      if (submitting || !createFormValid(draft)) {
        return { status: "blocked" };
      }
      submitting = true;
      try {
        const account = await api.createAdminAccount({
          name: draft.name.trim(),
          currency: draft.currency,
          language: draft.language,
          owner_tg_id: Number(draft.ownerTgId.trim()),
          owner_name: draft.ownerName.trim(),
        });
        return { status: "success", account };
      } catch (err) {
        return { status: "error", message: createAccountErrorMessage(err) };
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

function renderSkeletonList(): string {
  const rows = Array.from({ length: 4 }, () => `<div class="admin-row-skeleton"></div>`).join("");
  return `<div class="card admin-list">${rows}</div>`;
}

function renderSkeleton(): string {
  return `<div class="admin-view" data-testid="loading">
    <div class="admin-eyebrow">${escapeHtml(t("admin.section.accounts"))}</div>
    ${renderSkeletonList()}
    <div class="admin-eyebrow admin-eyebrow--users">${escapeHtml(t("admin.section.users"))}</div>
    ${renderSkeletonList()}
  </div>`;
}

function renderError(message: string): string {
  return `<div class="admin-error" data-testid="error">
    <p>${escapeHtml(message)}</p>
    <button type="button" data-action="retry">${escapeHtml(t("error.retry"))}</button>
  </div>`;
}

function renderForbidden(): string {
  return `<div class="admin-forbidden" data-testid="forbidden">
    <p>${escapeHtml(t("admin.forbidden"))}</p>
  </div>`;
}

/** Shared by both lists — `kind` picks the row/trigger `data-testid` and the
 * disabled-reason element's id, and the `data-account-id`/`data-user-id`
 * attribute `mount`'s click wiring reads. The trigger is rendered as a real
 * (enabled or disabled) `<button>` per the screen doc's Anatomy; `mount`
 * attaches the click handler only to the ones not already `disabled`. */
function renderTrigger(
  kind: "account" | "user",
  id: Uuid,
  view: { name: string; triggerLabel: string; disabledReason: string | null; isBlock: boolean },
): string {
  const reasonId = `admin-${kind}-reason-${id}`;
  const ariaLabel = escapeHtml(`${view.triggerLabel} ${view.name}`);
  const colourClass = view.isBlock ? "admin-trigger--block" : "admin-trigger--unblock";
  const disabledAttrs = view.disabledReason !== null ? ` disabled aria-describedby="${reasonId}"` : "";
  const reasonSpan =
    view.disabledReason !== null
      ? `<span id="${reasonId}" class="sr-only" data-testid="admin-${kind}-reason">${escapeHtml(view.disabledReason)}</span>`
      : "";
  return `<button type="button" class="admin-trigger ${colourClass}" data-testid="admin-${kind}-trigger" data-${kind}-id="${id}" aria-label="${ariaLabel}"${disabledAttrs}>${escapeHtml(view.triggerLabel)}</button>${reasonSpan}`;
}

function renderAccountRow(view: AdminAccountRowView): string {
  const rowClass = view.isBlocked ? "admin-row admin-row--suspended" : "admin-row";
  const badge = view.isBlocked
    ? `<span class="admin-badge" data-testid="admin-account-suspended">${escapeHtml(t("admin.account.suspended"))}</span>`
    : "";
  return `<div class="${rowClass}" data-testid="admin-account-row" data-account-id="${view.id}">
    <div class="admin-row-text">
      <span class="admin-row-name">${escapeHtml(view.name)}</span>
      <span class="admin-row-meta">${escapeHtml(view.meta)}</span>
      ${badge}
    </div>
    ${renderTrigger("account", view.id, { name: view.name, triggerLabel: view.triggerLabel, disabledReason: view.disabledReason, isBlock: !view.isBlocked })}
  </div>`;
}

function renderUserRow(view: AdminUserRowView): string {
  const rowClass = view.isSuspended ? "admin-row admin-row--suspended" : "admin-row";
  const badge = view.isSuspended
    ? `<span class="admin-badge" data-testid="admin-user-suspended">${escapeHtml(t("admin.user.suspended"))}</span>`
    : "";
  return `<div class="${rowClass}" data-testid="admin-user-row" data-user-id="${view.id}">
    <div class="admin-row-text">
      <span class="admin-row-name">${escapeHtml(view.name)}</span>
      <span class="admin-row-meta">${escapeHtml(view.meta)}</span>
      ${badge}
    </div>
    ${renderTrigger("user", view.id, { name: view.name, triggerLabel: view.triggerLabel, disabledReason: view.disabledReason, isBlock: !view.ownBlocked })}
  </div>`;
}

function renderBlockFailureBanner(failure: AdminBlockFailure): string {
  return `<div class="admin-block-failed" data-testid="admin-block-failed" aria-live="polite">
    <p>${escapeHtml(adminBlockFailureMessage(failure.name))}</p>
    <button type="button" data-action="retry-block">${escapeHtml(t("error.retry"))}</button>
  </div>`;
}

function renderAdminView(state: { status: "ready" } & AdminData, failure: AdminBlockFailure | null): string {
  const blocked = blockedAccountIds(state.accounts);
  const accountRows = state.accounts.map((row) => renderAccountRow(buildAccountRowView(row, state.selfAccountId))).join("");
  const userRows = state.users
    .map((row) => renderUserRow(buildUserRowView(row, state.selfUserId, blocked)))
    .join("");
  return `<div class="admin-view" data-testid="ready">
    ${failure?.kind === "account" ? renderBlockFailureBanner(failure) : ""}
    <div class="admin-eyebrow">${escapeHtml(t("admin.section.accounts"))}</div>
    <div class="card admin-list" data-testid="admin-accounts-list">${accountRows}</div>
    ${failure?.kind === "user" ? renderBlockFailureBanner(failure) : ""}
    <div class="admin-eyebrow admin-eyebrow--users">${escapeHtml(t("admin.section.users"))}</div>
    <div class="card admin-list" data-testid="admin-users-list">${userRows}</div>
  </div>`;
}

export function renderAdmin(state: AdminState, failure: AdminBlockFailure | null = null): string {
  switch (state.status) {
    case "loading":
      return renderSkeleton();
    case "forbidden":
      return renderForbidden();
    case "error":
      return renderError(state.message);
    case "ready":
      return renderAdminView(state, failure);
  }
}

/** `withError` is false for the Currency/Language fields (screen doc's
 * Layout table has no "3a"/"4a" error subregion for them, only 2a/5a/6a —
 * NIT fixed, U4.9 round 1) — they render no `.field-error` node at all
 * rather than an always-empty one. */
function renderCreateField(id: string, label: string, inputHtml: string, error: string | null = null, withError = true): string {
  const errorRow = withError
    ? `<p class="field-error" data-testid="${id}-error" aria-live="polite">${error ? escapeHtml(error) : ""}</p>`
    : "";
  return `<div class="admin-create-field">
    <label class="cat-form-label" for="${id}">${escapeHtml(label)}</label>
    <div class="card field">${inputHtml}</div>
    ${errorRow}
  </div>`;
}

function renderCurrencyOptions(selected: Currency): string {
  return CURRENCY_ORDER.map(
    (code) => `<option value="${code}"${code === selected ? " selected" : ""}>${escapeHtml(currencyName(code))}</option>`,
  ).join("");
}

function renderLanguageOptions(selected: Language): string {
  return LANGUAGE_ORDER.map(
    (code) => `<option value="${code}"${code === selected ? " selected" : ""}>${escapeHtml(languageName(code))}</option>`,
  ).join("");
}

/** Create-account mode (screen doc's Create-account mode Layout table).
 * `attempted` gates when field errors render — `false` on open (a blank form
 * shows no errors), set once a blocked "Create account" tap is caught (same
 * "never shown immediately on open" rule `categories.ts::nameInteracted`
 * documents for 06b, simplified to one flag for this single-attempt form
 * rather than per-field blur tracking). `saving` disables every field and
 * both buttons — screen doc's States table: "Saving | ... | form and
 * buttons disabled; exactly one POST regardless of taps" (reviewer finding,
 * U4.9 round 1 — the controller's own guard already made the POST-count half
 * of that AC hold, but nothing visually disabled the form while it did). */
export function renderCreateForm(
  draft: CreateAccountDraft,
  attempted: boolean,
  submitError: string | null,
  saving = false,
): string {
  const nameError = attempted ? createNameError(draft.name) : null;
  const ownerTgIdError = attempted ? createOwnerTgIdError(draft.ownerTgId) : null;
  const ownerNameError = attempted ? createOwnerNameError(draft.ownerName) : null;
  const disabledAttr = saving ? " disabled" : "";
  return `<div class="admin-create-form" data-testid="admin-create-form">
    <p class="admin-create-header">${escapeHtml(t("admin.create.header"))}</p>
    ${renderCreateField(
      "admin-create-name",
      t("admin.create.field.name.label"),
      `<input id="admin-create-name" class="admin-input" data-testid="admin-create-name" placeholder="${escapeHtml(t("admin.create.field.name.placeholder"))}" value="${escapeHtml(draft.name)}"${disabledAttr} />`,
      nameError,
    )}
    ${renderCreateField(
      "admin-create-currency",
      t("admin.create.field.currency.label"),
      `<select id="admin-create-currency" class="admin-select" data-testid="admin-create-currency"${disabledAttr}>${renderCurrencyOptions(draft.currency)}</select>`,
      null,
      false,
    )}
    ${renderCreateField(
      "admin-create-language",
      t("admin.create.field.language.label"),
      `<select id="admin-create-language" class="admin-select" data-testid="admin-create-language"${disabledAttr}>${renderLanguageOptions(draft.language)}</select>`,
      null,
      false,
    )}
    ${renderCreateField(
      "admin-create-owner-tg-id",
      t("admin.create.field.ownerTgId.label"),
      `<input id="admin-create-owner-tg-id" class="admin-input" data-testid="admin-create-owner-tg-id" inputmode="numeric" placeholder="${escapeHtml(t("admin.create.field.ownerTgId.placeholder"))}" value="${escapeHtml(draft.ownerTgId)}"${disabledAttr} />`,
      ownerTgIdError,
    )}
    ${renderCreateField(
      "admin-create-owner-name",
      t("admin.create.field.ownerName.label"),
      `<input id="admin-create-owner-name" class="admin-input" data-testid="admin-create-owner-name" placeholder="${escapeHtml(t("admin.create.field.ownerName.placeholder"))}" value="${escapeHtml(draft.ownerName)}"${disabledAttr} />`,
      ownerNameError,
    )}
    ${submitError ? `<p class="submit-error" data-testid="admin-create-submit-error">${escapeHtml(submitError)}</p>` : ""}
    <div class="detail-edit-actions admin-create-actions">
      <button type="button" data-action="admin-create-submit"${disabledAttr}>${escapeHtml(t("admin.create.action.create"))}</button>
      <button type="button" data-action="admin-create-cancel"${disabledAttr}>${escapeHtml(t("admin.create.action.cancel"))}</button>
    </div>
  </div>`;
}

// -- mount (DOM glue; not meaningfully unit-testable under Node, same
//    accepted gap as every other screen's mount) ---------------------------

export interface AdminHandlers {
  onRetry: () => void;
  onBack: () => void;
}

/** List mode's MainButton (screen doc's Telegram section: "Create account" —
 * always enabled, always visible). Create mode hides MainButton entirely
 * (`04b-budget-form.md`'s own reasoning, reused verbatim) — `mount` calls
 * this again on switching back to List mode. */
export function applyAdminChrome(onBack: () => void): void {
  setBackButtonHandler(onBack);
  mainButton.hide();
}

export function mount(root: HTMLElement, state: AdminState, api: AdminApi, handlers: AdminHandlers): void {
  if (typeof document === "undefined") {
    return;
  }

  if (state.status !== "ready") {
    root.innerHTML = renderAdmin(state);
    root.querySelector('[data-action="retry"]')?.addEventListener("click", handlers.onRetry);
    return;
  }

  const controller = createAdminBlockController(api);
  let accounts = state.accounts;
  let users = state.users;
  let failure: AdminBlockFailure | null = null;

  // -- create-account mode (U4.9) -----------------------------------------
  // `createController` is `null` in List mode and freshly instantiated on
  // every `openCreateMode()` — never reused across a cancel/reopen, so a
  // discarded draft never resurfaces.
  let mode: "list" | "create" = "list";
  let createController: AdminCreateController | null = null;
  let createAttempted = false;
  let createSubmitError: string | null = null;
  /** Screen doc's Saving state: "form and buttons disabled". Set once the
   * confirm popup resolves and the `POST` is actually about to fire, cleared
   * when it settles (reviewer finding, U4.9 round 1 — the controller's own
   * guard already made the POST-count half of that AC hold, but nothing
   * visually disabled the form while it did). */
  let createSaving = false;

  /** Re-applied on every `render()` (cheap: `setBackButtonHandler`/
   * `mainButton.onClick` both unwire-then-rewire per their own contract) so
   * chrome always matches the current mode without separate bookkeeping.
   * BackButton's destination is mode-dependent (`docs/ui/screens/10-admin.md`,
   * V8/U2.2): List mode's one step back is Home (`exitToHome`); Create
   * mode's is List mode, the same target Cancel already used — Create is
   * pushed onto List, not onto Home. */
  function updateChrome(): void {
    setBackButtonHandler(() => void requestCloseCreate(mode === "list"));
    if (mode === "create") {
      mainButton.hide();
    } else {
      mainButton.show(t("admin.create.mainButton"));
      mainButton.onClick(openCreateMode);
    }
  }

  function openCreateMode(): void {
    mode = "create";
    createController = createAdminCreateController(api);
    createAttempted = false;
    createSubmitError = null;
    createSaving = false;
    render();
    // Screen doc's Viewport section: autofocus the account-name field, once,
    // on open — not on every re-render while typing/failing a submit.
    root.querySelector<HTMLInputElement>('[data-testid="admin-create-name"]')?.focus();
  }

  /** Shared by BackButton (`exitToHome: mode === "list"` — List mode exits
   * to Home, Create mode exits to List mode, same as Cancel) and Cancel
   * (`exitToHome: false`, always — screen doc's Interactions table). Both
   * apply the same dirty-check mechanism first. */
  async function requestCloseCreate(exitToHome: boolean): Promise<void> {
    if (!createController) {
      if (exitToHome) {
        handlers.onBack();
      }
      return;
    }
    if (isCreateFormDirty(createController.getDraft())) {
      const confirmed = await confirmDiscard(t("admin.create.discardChanges"));
      if (!confirmed) {
        return;
      }
    }
    createController = null;
    createAttempted = false;
    createSubmitError = null;
    if (exitToHome) {
      handlers.onBack();
    } else {
      mode = "list";
      render();
    }
  }

  async function handleCreateSubmit(): Promise<void> {
    if (!createController) {
      return;
    }
    // Captured once, before any `await` — `createController` is reassigned
    // elsewhere in this closure (`openCreateMode`/`requestCloseCreate`), so
    // TS can't narrow it as non-null past an `await` without this.
    const draftController = createController;
    const draft = draftController.getDraft();
    if (!createFormValid(draft)) {
      createAttempted = true;
      render();
      return;
    }
    const confirmed = await confirmAction(createAccountConfirmMessage(draft));
    if (!confirmed) {
      return;
    }
    createSaving = true;
    render();
    const outcome = await draftController.submit();
    createSaving = false;
    if (outcome.status === "success") {
      haptics.notification("success");
      mode = "list";
      createController = null;
      createAttempted = false;
      createSubmitError = null;
      // Screen doc's Success state: both lists refetch so the new account
      // and its owner appear immediately, no manual reload.
      try {
        const [freshAccounts, freshUsers] = await Promise.all([api.listAdminAccounts(), api.listAdminUsers()]);
        accounts = freshAccounts;
        users = freshUsers;
      } catch {
        // The account was already created successfully; keep the pre-create
        // lists rather than crash on a refetch failure — a stale list here
        // is a display nicety, not correctness, and this screen has no
        // offline cache to fall back on either (its own States table).
      }
      render();
    } else if (outcome.status === "error") {
      haptics.notification("error");
      createSubmitError = outcome.message;
      render();
    }
    // "blocked" only fires from a stale double tap racing `confirmAction`'s
    // own await — nothing left to update.
  }

  function wireCreateForm(): void {
    if (!createController) {
      return;
    }
    const draftController = createController;

    function patchCreateValidity(): void {
      if (!createAttempted) {
        return;
      }
      const draft = draftController.getDraft();
      const nameErrorEl = root.querySelector<HTMLElement>('[data-testid="admin-create-name-error"]');
      if (nameErrorEl) {
        nameErrorEl.textContent = createNameError(draft.name) ?? "";
      }
      const tgIdErrorEl = root.querySelector<HTMLElement>('[data-testid="admin-create-owner-tg-id-error"]');
      if (tgIdErrorEl) {
        tgIdErrorEl.textContent = createOwnerTgIdError(draft.ownerTgId) ?? "";
      }
      const ownerNameErrorEl = root.querySelector<HTMLElement>('[data-testid="admin-create-owner-name-error"]');
      if (ownerNameErrorEl) {
        ownerNameErrorEl.textContent = createOwnerNameError(draft.ownerName) ?? "";
      }
    }

    const nameInput = root.querySelector<HTMLInputElement>('[data-testid="admin-create-name"]');
    nameInput?.addEventListener("input", () => {
      draftController.setField("name", nameInput.value);
      patchCreateValidity();
    });
    const currencySelect = root.querySelector<HTMLSelectElement>('[data-testid="admin-create-currency"]');
    currencySelect?.addEventListener("change", () => {
      draftController.setField("currency", currencySelect.value as Currency);
    });
    const languageSelect = root.querySelector<HTMLSelectElement>('[data-testid="admin-create-language"]');
    languageSelect?.addEventListener("change", () => {
      draftController.setField("language", languageSelect.value as Language);
    });
    const ownerTgIdInput = root.querySelector<HTMLInputElement>('[data-testid="admin-create-owner-tg-id"]');
    ownerTgIdInput?.addEventListener("input", () => {
      draftController.setField("ownerTgId", ownerTgIdInput.value);
      patchCreateValidity();
    });
    const ownerNameInput = root.querySelector<HTMLInputElement>('[data-testid="admin-create-owner-name"]');
    ownerNameInput?.addEventListener("input", () => {
      draftController.setField("ownerName", ownerNameInput.value);
      patchCreateValidity();
    });

    root.querySelector('[data-action="admin-create-submit"]')?.addEventListener("click", () => {
      void handleCreateSubmit();
    });
    root.querySelector('[data-action="admin-create-cancel"]')?.addEventListener("click", () => {
      void requestCloseCreate(false);
    });
  }

  const render = (): void => {
    updateChrome();
    if (mode === "create" && createController) {
      root.innerHTML = renderCreateForm(createController.getDraft(), createAttempted, createSubmitError, createSaving);
      wireCreateForm();
      return;
    }
    root.innerHTML = renderAdmin(
      { status: "ready", accounts, users, selfAccountId: state.selfAccountId, selfUserId: state.selfUserId },
      failure,
    );
    wire();
  };

  /** Optimistically applies `nextBlocked`, fires the PATCH, and reverts with
   * a banner on failure. Shared by a confirmed tap and by the retry banner's
   * "Try again" — the retry re-issues this same call with no second confirm
   * popup (`main.ts::onRetryDelete`'s own precedent for 06c). */
  async function applyAndPatch(kind: "account" | "user", id: Uuid, name: string, nextBlocked: boolean): Promise<void> {
    if (controller.isPending(kind, id)) {
      return;
    }
    // Only clear the banner for *this* target — the controller's guard
    // deliberately lets an unrelated account/user toggle run concurrently
    // (doc comment above `createAdminBlockController`), so an action on a
    // different target must never dismiss a still-unresolved failure shown
    // for this one (reviewer finding, U4.8 round 1). `failure` stays a
    // single slot, same as `categories.ts`/`tags.ts`'s own delete-failure
    // banner — a second target failing while one is already shown replaces
    // the display, which is an accepted limitation of that single-slot
    // shape, not a regression this unit introduces.
    if (failure?.kind === kind && failure.id === id) {
      failure = null;
    }
    if (kind === "account") {
      accounts = withAccountBlocked(accounts, id, nextBlocked);
    } else {
      users = withUserBlocked(users, id, nextBlocked);
    }
    render();

    const outcome = await controller.toggle(kind, id, nextBlocked);
    if (outcome.status === "error") {
      if (kind === "account") {
        accounts = withAccountBlocked(accounts, id, !nextBlocked);
      } else {
        users = withUserBlocked(users, id, !nextBlocked);
      }
      failure = { kind, id, name, nextBlocked };
      render();
    }
  }

  async function handleTriggerTap(kind: "account" | "user", id: Uuid, name: string, nextBlocked: boolean): Promise<void> {
    if (controller.isPending(kind, id)) {
      return;
    }
    const confirmed = await confirmAction(adminBlockConfirmMessage(kind, name, nextBlocked));
    if (!confirmed) {
      return;
    }
    haptics.impact("medium");
    await applyAndPatch(kind, id, name, nextBlocked);
  }

  function wire(): void {
    root.querySelectorAll<HTMLButtonElement>('[data-testid="admin-account-trigger"]:not([disabled])').forEach((el) => {
      el.addEventListener("click", () => {
        const id = el.dataset.accountId as Uuid;
        const row = accounts.find((a) => a.id === id);
        if (row) {
          void handleTriggerTap("account", id, row.name, !row.is_blocked);
        }
      });
    });
    root.querySelectorAll<HTMLButtonElement>('[data-testid="admin-user-trigger"]:not([disabled])').forEach((el) => {
      el.addEventListener("click", () => {
        const id = el.dataset.userId as Uuid;
        const row = users.find((u) => u.id === id);
        if (row) {
          void handleTriggerTap("user", id, row.name, !row.is_blocked);
        }
      });
    });
    root.querySelector('[data-action="retry-block"]')?.addEventListener("click", () => {
      if (failure) {
        void applyAndPatch(failure.kind, failure.id, failure.name, failure.nextBlocked);
      }
    });
  }

  render();
}
