/** Screen 10 — Admin, list mode (docs/ui/screens/10-admin.md). Reached only
 * from the side menu's eighth row, gated on `role === "system_admin"`
 * (U4.10 — not wired yet; this unit builds the screen itself, matching
 * task-methodology's own decomposition order of pure rendering before
 * wiring). This unit covers the Accounts/Users lists and the screen's four
 * top-level states (loading, error, 403, ready) — the block/unblock confirm
 * + PATCH flow (U4.8), the create-account form (U4.9) and the MainButton
 * that opens it (also U4.9, since a "Create account" button pointing at a
 * mode that doesn't exist yet would be worse than no button) are each their
 * own unit.
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
 *  - data: `loadAdmin` (one `GET /users/me` for the caller's own ids, plus
 *    the two admin list calls, in parallel) and the pure
 *    `buildAccountRowView`/`buildUserRowView` row-model builders — both
 *    directly unit-tested, no DOM.
 *  - presentation: `renderAdmin` (pure, HTML strings).
 *  - mount: thin DOM glue, not meaningfully unit-tested, same accepted gap
 *    as every other screen's mount.
 */

import { ForbiddenError } from "../api/client";
import type { AdminAccountRow, AdminUserRow, Role, Uuid } from "../api/types";
import { t, type Catalogue } from "../lib/i18n";
import { mainButton, setBackButtonHandler } from "../lib/telegram";
import { languageName } from "./language";

// -- data ---------------------------------------------------------------

export interface AdminApi {
  getMe(): Promise<{ id: Uuid; account_id: Uuid }>;
  listAdminAccounts(): Promise<AdminAccountRow[]>;
  listAdminUsers(): Promise<AdminUserRow[]>;
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
 * disabled-reason element's id, `targetIdAttr` the `data-account-id`/
 * `data-user-id` attribute U4.8's click wiring will read. The trigger is
 * rendered as a real (enabled or disabled) `<button>` per the screen doc's
 * Anatomy, but carries no click handler yet — that's U4.8's own unit (file
 * header). */
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

function renderAdminView(state: { status: "ready" } & AdminData): string {
  const blocked = blockedAccountIds(state.accounts);
  const accountRows = state.accounts.map((row) => renderAccountRow(buildAccountRowView(row, state.selfAccountId))).join("");
  const userRows = state.users
    .map((row) => renderUserRow(buildUserRowView(row, state.selfUserId, blocked)))
    .join("");
  return `<div class="admin-view" data-testid="ready">
    <div class="admin-eyebrow">${escapeHtml(t("admin.section.accounts"))}</div>
    <div class="card admin-list" data-testid="admin-accounts-list">${accountRows}</div>
    <div class="admin-eyebrow admin-eyebrow--users">${escapeHtml(t("admin.section.users"))}</div>
    <div class="card admin-list" data-testid="admin-users-list">${userRows}</div>
  </div>`;
}

export function renderAdmin(state: AdminState): string {
  switch (state.status) {
    case "loading":
      return renderSkeleton();
    case "forbidden":
      return renderForbidden();
    case "error":
      return renderError(state.message);
    case "ready":
      return renderAdminView(state);
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

export function mount(root: HTMLElement, state: AdminState, handlers: AdminHandlers): void {
  if (typeof document === "undefined") {
    return;
  }
  root.innerHTML = renderAdmin(state);
  root.querySelector('[data-action="retry"]')?.addEventListener("click", handlers.onRetry);
}
