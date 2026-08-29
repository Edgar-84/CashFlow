/** Screen 10 — Admin, list mode (docs/ui/screens/10-admin.md). Reached only
 * from the side menu's eighth row, gated on `role === "system_admin"`
 * (U4.10 — not wired yet; this unit builds the screen itself, matching
 * task-methodology's own decomposition order of pure rendering before
 * wiring). U4.7 covered the Accounts/Users lists and the screen's four
 * top-level states (loading, error, 403, ready). This unit (U4.8) wires
 * the Block/Unblock trigger on each row: confirm → optimistic flip → PATCH
 * → revert-and-banner on failure. The create-account form and its
 * MainButton are U4.9, still its own unit.
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
 *    row-model builders, the block confirm/failure copy builders and
 *    `createAdminBlockController` (the double-submit guard, same shape as
 *    `settings.ts::createSettingsController`) — all directly unit-tested,
 *    no DOM.
 *  - presentation: `renderAdmin` (pure, HTML strings).
 *  - mount: thin DOM glue, not meaningfully unit-tested, same accepted gap
 *    as every other screen's mount.
 */

import { ForbiddenError } from "../api/client";
import type { AdminAccountRow, AdminUserRow, Role, Uuid } from "../api/types";
import { t, type Catalogue } from "../lib/i18n";
import { confirmAction, haptics, mainButton, setBackButtonHandler } from "../lib/telegram";
import { languageName } from "./language";

// -- data ---------------------------------------------------------------

export interface AdminApi {
  getMe(): Promise<{ id: Uuid; account_id: Uuid }>;
  listAdminAccounts(): Promise<AdminAccountRow[]>;
  listAdminUsers(): Promise<AdminUserRow[]>;
  blockAdminAccount(id: Uuid, isBlocked: boolean): Promise<unknown>;
  blockAdminUser(id: Uuid, isBlocked: boolean): Promise<unknown>;
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

// -- mount (DOM glue; not meaningfully unit-testable under Node, same
//    accepted gap as every other screen's mount) ---------------------------

export interface AdminHandlers {
  onRetry: () => void;
  onBack: () => void;
}

/** No MainButton in this unit — the only List-mode action it would offer is
 * "Create account" (U4.9), which doesn't exist yet. */
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

  const render = (): void => {
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
