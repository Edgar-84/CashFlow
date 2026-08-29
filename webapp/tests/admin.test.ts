import { afterEach, describe, expect, it, vi } from "vitest";
import { ForbiddenError, RetryableError } from "../src/api/client";
import type { AdminAccountRow, AdminUserRow } from "../src/api/types";
import { setLanguage, t } from "../src/lib/i18n";
import {
  adminBlockConfirmMessage,
  adminBlockFailureMessage,
  blockedAccountIds,
  buildAccountRowView,
  buildUserRowView,
  createAdminBlockController,
  loadAdmin,
  renderAdmin,
  roleName,
  withAccountBlocked,
  withUserBlocked,
  type AdminApi,
} from "../src/screens/admin";

function account(overrides: Partial<AdminAccountRow> = {}): AdminAccountRow {
  return {
    id: "acc-kims",
    name: "The Kims",
    currency: "USD",
    language: "en",
    is_blocked: false,
    user_count: 2,
    created_at: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

function user(overrides: Partial<AdminUserRow> = {}): AdminUserRow {
  return {
    id: "user-anna",
    tg_id: 123456789,
    name: "Anna Kim",
    role: "admin",
    account_id: "acc-kims",
    account_name: "The Kims",
    is_blocked: false,
    ...overrides,
  };
}

function fakeApi(overrides: Partial<AdminApi> = {}): AdminApi {
  return {
    getMe: vi.fn().mockResolvedValue({ id: "user-me", account_id: "acc-me" }),
    listAdminAccounts: vi.fn().mockResolvedValue([account()]),
    listAdminUsers: vi.fn().mockResolvedValue([user()]),
    blockAdminAccount: vi.fn().mockResolvedValue(undefined),
    blockAdminUser: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

// -- loadAdmin ----------------------------------------------------------

describe("loadAdmin", () => {
  it("returns ready with both lists and the caller's own ids", async () => {
    const api = fakeApi({ getMe: vi.fn().mockResolvedValue({ id: "user-me", account_id: "acc-me" }) });
    const state = await loadAdmin(api);
    expect(state).toEqual({
      status: "ready",
      accounts: [account()],
      users: [user()],
      selfAccountId: "acc-me",
      selfUserId: "user-me",
    });
  });

  it("maps a 403 from GET /admin/accounts to the forbidden state, not a blank screen", async () => {
    const api = fakeApi({ listAdminAccounts: vi.fn().mockRejectedValue(new ForbiddenError()) });
    const state = await loadAdmin(api);
    expect(state).toEqual({ status: "forbidden" });
  });

  it("maps a 403 from GET /admin/users to the forbidden state", async () => {
    const api = fakeApi({ listAdminUsers: vi.fn().mockRejectedValue(new ForbiddenError()) });
    const state = await loadAdmin(api);
    expect(state).toEqual({ status: "forbidden" });
  });

  it("maps any other failure — including a network/offline failure, since this screen has no cache — to the fixed load-error copy", async () => {
    const api = fakeApi({ listAdminAccounts: vi.fn().mockRejectedValue(new RetryableError()) });
    const state = await loadAdmin(api);
    expect(state).toEqual({ status: "error", message: "Couldn't load the admin panel." });
  });

  it("an empty accounts/users response still resolves ready — real-world unreachable, but must not crash", async () => {
    const api = fakeApi({ listAdminAccounts: vi.fn().mockResolvedValue([]), listAdminUsers: vi.fn().mockResolvedValue([]) });
    const state = await loadAdmin(api);
    expect(state).toMatchObject({ status: "ready", accounts: [], users: [] });
  });
});

// -- roleName -------------------------------------------------------------

describe("roleName", () => {
  afterEach(() => setLanguage("en"));

  it("has a name for every role, including the cross-account system_admin", () => {
    for (const role of ["system_admin", "admin", "member", "viewer"] as const) {
      expect(roleName(role)).toBeTruthy();
    }
  });

  it("translates with the active language", () => {
    setLanguage("uk");
    expect(roleName("system_admin")).toBe("Системний адміністратор");
  });
});

// -- buildAccountRowView ---------------------------------------------------

describe("buildAccountRowView", () => {
  it("singular meta for exactly one user", () => {
    const view = buildAccountRowView(account({ user_count: 1, currency: "EUR", language: "ru" }), "acc-other");
    expect(view.meta).toBe("EUR · Русский · 1 user");
  });

  it("plural meta for zero or many users", () => {
    expect(buildAccountRowView(account({ user_count: 0 }), "acc-other").meta).toContain("0 users");
    expect(buildAccountRowView(account({ user_count: 5 }), "acc-other").meta).toContain("5 users");
  });

  it("trigger label follows the account's own is_blocked", () => {
    expect(buildAccountRowView(account({ is_blocked: false }), "acc-other").triggerLabel).toBe("Block");
    expect(buildAccountRowView(account({ is_blocked: true }), "acc-other").triggerLabel).toBe("Unblock");
  });

  it("disables the trigger with a reason only for the caller's own account", () => {
    const own = buildAccountRowView(account({ id: "acc-kims" }), "acc-kims");
    expect(own.disabledReason).toBe("You can't block your own account.");
    const other = buildAccountRowView(account({ id: "acc-kims" }), "acc-other");
    expect(other.disabledReason).toBeNull();
  });
});

// -- blockedAccountIds / buildUserRowView ----------------------------------

describe("blockedAccountIds", () => {
  it("collects only blocked accounts' ids", () => {
    const ids = blockedAccountIds([account({ id: "a", is_blocked: true }), account({ id: "b", is_blocked: false })]);
    expect(ids.has("a")).toBe(true);
    expect(ids.has("b")).toBe(false);
  });
});

describe("buildUserRowView", () => {
  it("meta interpolates account name, role and tg_id", () => {
    const view = buildUserRowView(user({ account_name: "The Kims", role: "viewer", tg_id: 42 }), "self", new Set());
    expect(view.meta).toBe("The Kims · Viewer · tg_id 42");
  });

  it("is suspended when the user's own flag is set, even with an unblocked account", () => {
    const view = buildUserRowView(user({ is_blocked: true }), "self", new Set());
    expect(view.isSuspended).toBe(true);
  });

  it("is suspended when the account is blocked, even though the user's own flag is false (D714)", () => {
    const view = buildUserRowView(user({ is_blocked: false, account_id: "acc-kims" }), "self", new Set(["acc-kims"]));
    expect(view.isSuspended).toBe(true);
  });

  it("trigger label and ownBlocked follow the user's own is_blocked, not the account-derived suspension", () => {
    const view = buildUserRowView(user({ is_blocked: false, account_id: "acc-kims" }), "self", new Set(["acc-kims"]));
    expect(view.triggerLabel).toBe("Block");
    expect(view.ownBlocked).toBe(false);
    expect(view.isSuspended).toBe(true);
  });

  it("disables with a self reason for the caller's own user row", () => {
    const view = buildUserRowView(user({ id: "user-anna" }), "user-anna", new Set());
    expect(view.disabledReason).toBe("You can't block yourself.");
  });

  it("disables with an account-blocked reason when the account is blocked and this isn't the caller", () => {
    const view = buildUserRowView(user({ id: "user-anna", account_id: "acc-kims" }), "someone-else", new Set(["acc-kims"]));
    expect(view.disabledReason).toBe("This account is suspended — unblock the account to change this user.");
  });

  it("self takes precedence when the caller's own account happens to be blocked", () => {
    const view = buildUserRowView(user({ id: "user-anna", account_id: "acc-kims" }), "user-anna", new Set(["acc-kims"]));
    expect(view.disabledReason).toBe("You can't block yourself.");
  });

  it("no disabled reason for an unrelated user in an unblocked account", () => {
    const view = buildUserRowView(user({ id: "user-anna", account_id: "acc-kims" }), "someone-else", new Set());
    expect(view.disabledReason).toBeNull();
  });
});

// -- renderAdmin ------------------------------------------------------------

describe("renderAdmin", () => {
  it("loading: shows skeleton rows for both sections, not the lists", () => {
    const html = renderAdmin({ status: "loading" });
    expect(html).toContain('data-testid="loading"');
    expect(html).not.toContain('data-testid="admin-account-row"');
  });

  it("forbidden: shows only the forbidden copy, no lists, no retry", () => {
    const html = renderAdmin({ status: "forbidden" });
    expect(html).toContain(t("admin.forbidden"));
    expect(html).not.toContain('data-testid="admin-accounts-list"');
    expect(html).not.toContain('data-action="retry"');
  });

  it("error: shows the message and a retry action", () => {
    const html = renderAdmin({ status: "error", message: "Couldn't load the admin panel." });
    expect(html).toContain("Couldn't load the admin panel.");
    expect(html).toContain('data-action="retry"');
  });

  it("ready: renders one row per account and per user, with name, meta and trigger label", () => {
    const html = renderAdmin({
      status: "ready",
      accounts: [account({ id: "acc-1", name: "The Kims" })],
      users: [user({ id: "user-1", name: "Anna Kim" })],
      selfAccountId: "acc-other",
      selfUserId: "user-other",
    });
    expect(html).toContain('data-testid="ready"');
    expect(html).toContain("The Kims");
    expect(html).toContain("Anna Kim");
    expect((html.match(/data-testid="admin-account-row"/g) ?? []).length).toBe(1);
    expect((html.match(/data-testid="admin-user-row"/g) ?? []).length).toBe(1);
  });

  it("ready: renders both cards with no rows, with no crash, when both lists are empty", () => {
    const html = renderAdmin({ status: "ready", accounts: [], users: [], selfAccountId: "a", selfUserId: "u" });
    expect(html).toContain('data-testid="admin-accounts-list"');
    expect(html).toContain('data-testid="admin-users-list"');
    expect(html).not.toContain('data-testid="admin-account-row"');
    expect(html).not.toContain('data-testid="admin-user-row"');
  });

  it("a blocked account's row shows the Suspended badge and the row-suspended class", () => {
    const html = renderAdmin({
      status: "ready",
      accounts: [account({ id: "acc-1", is_blocked: true })],
      users: [],
      selfAccountId: "acc-other",
      selfUserId: "user-other",
    });
    expect(html).toContain('data-testid="admin-account-suspended"');
    expect(html).toContain("admin-row--suspended");
  });

  it("a user whose account is blocked shows Suspended even though their own flag is false", () => {
    const html = renderAdmin({
      status: "ready",
      accounts: [account({ id: "acc-1", is_blocked: true })],
      users: [user({ id: "user-1", account_id: "acc-1", is_blocked: false })],
      selfAccountId: "acc-other",
      selfUserId: "user-other",
    });
    expect(html).toContain('data-testid="admin-user-suspended"');
  });

  it("that same user's own trigger still reads/colours as Block (their own flag) — only the account row's trigger reads Unblock", () => {
    const html = renderAdmin({
      status: "ready",
      accounts: [account({ id: "acc-1", is_blocked: true })],
      users: [user({ id: "user-1", account_id: "acc-1", is_blocked: false })],
      selfAccountId: "acc-other",
      selfUserId: "user-other",
    });
    expect(html).toMatch(/class="admin-trigger admin-trigger--block" data-testid="admin-user-trigger"[^>]*>Block</);
    expect(html).toMatch(/class="admin-trigger admin-trigger--unblock" data-testid="admin-account-trigger"/);
  });

  it("the caller's own account row has a disabled trigger whose aria-describedby resolves to the reason span's own id", () => {
    const html = renderAdmin({
      status: "ready",
      accounts: [account({ id: "acc-mine" })],
      users: [],
      selfAccountId: "acc-mine",
      selfUserId: "user-other",
    });
    const reasonId = "admin-account-reason-acc-mine";
    expect(html).toMatch(new RegExp(`data-testid="admin-account-trigger"[^>]* disabled aria-describedby="${reasonId}"`));
    expect(html).toContain(`<span id="${reasonId}" class="sr-only" data-testid="admin-account-reason">You can't block your own account.</span>`);
  });

  it("the caller's own user row has a disabled trigger whose aria-describedby resolves to the reason span's own id", () => {
    const html = renderAdmin({
      status: "ready",
      accounts: [],
      users: [user({ id: "user-mine" })],
      selfAccountId: "acc-other",
      selfUserId: "user-mine",
    });
    const reasonId = "admin-user-reason-user-mine";
    expect(html).toMatch(new RegExp(`data-testid="admin-user-trigger"[^>]* disabled aria-describedby="${reasonId}"`));
    expect(html).toContain(`<span id="${reasonId}" class="sr-only" data-testid="admin-user-reason">You can't block yourself.</span>`);
  });

  it("a user row's trigger carries an accessible name naming both the target and the action", () => {
    const html = renderAdmin({
      status: "ready",
      accounts: [],
      users: [user({ id: "user-1", name: "Anna Kim", is_blocked: false })],
      selfAccountId: "acc-other",
      selfUserId: "user-other",
    });
    expect(html).toContain('aria-label="Block Anna Kim"');
  });
});

// -- i18n (U4.7, D700 — catalogue-native) ------------------------------------

describe("renders in Russian and Ukrainian", () => {
  afterEach(() => setLanguage("en"));

  it("translates the section headings and the forbidden/load-error copy", () => {
    for (const lang of ["ru", "uk"] as const) {
      setLanguage(lang);
      expect(renderAdmin({ status: "forbidden" })).toContain(t("admin.forbidden"));
      expect(renderAdmin({ status: "error", message: t("admin.errLoad") })).toContain(t("admin.errLoad"));
      const ready = renderAdmin({ status: "ready", accounts: [], users: [], selfAccountId: "a", selfUserId: "u" });
      expect(ready).toContain(t("admin.section.accounts"));
      expect(ready).toContain(t("admin.section.users"));
    }
    setLanguage("en");
  });
});

// -- withAccountBlocked / withUserBlocked (U4.8) -----------------------------

describe("withAccountBlocked", () => {
  it("flips only the matching row's is_blocked, leaving others untouched", () => {
    const rows = [account({ id: "a", is_blocked: false }), account({ id: "b", is_blocked: false })];
    const next = withAccountBlocked(rows, "a", true);
    expect(next.find((r) => r.id === "a")?.is_blocked).toBe(true);
    expect(next.find((r) => r.id === "b")?.is_blocked).toBe(false);
  });

  it("is a no-op for an id that isn't in the list", () => {
    const rows = [account({ id: "a" })];
    expect(withAccountBlocked(rows, "missing", true)).toEqual(rows);
  });
});

describe("withUserBlocked", () => {
  it("flips only the matching row's is_blocked", () => {
    const rows = [user({ id: "x", is_blocked: false }), user({ id: "y", is_blocked: true })];
    const next = withUserBlocked(rows, "y", false);
    expect(next.find((r) => r.id === "x")?.is_blocked).toBe(false);
    expect(next.find((r) => r.id === "y")?.is_blocked).toBe(false);
  });
});

// -- adminBlockConfirmMessage / adminBlockFailureMessage (U4.8) -------------

describe("adminBlockConfirmMessage", () => {
  it("names the account and the block direction, unescaped for Telegram's native popup", () => {
    expect(adminBlockConfirmMessage("account", "The Kims", true)).toBe(
      'Block "The Kims"? Every user in this account loses access immediately.',
    );
  });

  it("names the account and the unblock direction", () => {
    expect(adminBlockConfirmMessage("account", "The Kims", false)).toBe(
      "Unblock \"The Kims\"? Every user who isn't individually blocked regains access immediately.",
    );
  });

  it("names the user and the block direction", () => {
    expect(adminBlockConfirmMessage("user", "Anna Kim", true)).toBe(
      "Block Anna Kim? They lose access immediately; the rest of their account stays active.",
    );
  });

  it("names the user and the unblock direction", () => {
    expect(adminBlockConfirmMessage("user", "Anna Kim", false)).toBe("Unblock Anna Kim? They regain access immediately.");
  });
});

describe("adminBlockFailureMessage", () => {
  it("names the target that failed to update", () => {
    expect(adminBlockFailureMessage("The Kims")).toBe("Couldn't update The Kims.");
  });
});

// -- createAdminBlockController (U4.8) ---------------------------------------

describe("createAdminBlockController", () => {
  it("a successful toggle calls the matching API method with the target id and direction", async () => {
    const api = fakeApi();
    const controller = createAdminBlockController(api);
    const outcome = await controller.toggle("account", "acc-kims", true);
    expect(outcome).toEqual({ status: "success" });
    expect(api.blockAdminAccount).toHaveBeenCalledWith("acc-kims", true);
    expect(api.blockAdminUser).not.toHaveBeenCalled();
  });

  it("routes a user toggle to blockAdminUser", async () => {
    const api = fakeApi();
    const controller = createAdminBlockController(api);
    await controller.toggle("user", "user-anna", false);
    expect(api.blockAdminUser).toHaveBeenCalledWith("user-anna", false);
  });

  it("maps a rejected PATCH to an error outcome", async () => {
    const api = fakeApi({ blockAdminAccount: vi.fn().mockRejectedValue(new RetryableError()) });
    const controller = createAdminBlockController(api);
    expect(await controller.toggle("account", "acc-kims", true)).toEqual({ status: "error" });
  });

  it("is not pending before or after a toggle resolves", async () => {
    const api = fakeApi();
    const controller = createAdminBlockController(api);
    expect(controller.isPending("account", "acc-kims")).toBe(false);
    await controller.toggle("account", "acc-kims", true);
    expect(controller.isPending("account", "acc-kims")).toBe(false);
  });

  it("is pending while the PATCH is in flight, and a duplicate toggle for the same target issues exactly one PATCH", async () => {
    let resolve!: () => void;
    const blockAdminAccount = vi.fn().mockReturnValue(new Promise<void>((r) => (resolve = r)));
    const api = fakeApi({ blockAdminAccount });
    const controller = createAdminBlockController(api);

    const first = controller.toggle("account", "acc-kims", true);
    expect(controller.isPending("account", "acc-kims")).toBe(true);
    const second = await controller.toggle("account", "acc-kims", true);
    expect(second).toEqual({ status: "blocked" });

    resolve();
    expect(await first).toEqual({ status: "success" });
    expect(blockAdminAccount).toHaveBeenCalledTimes(1);
  });

  it("a different target is never blocked by another target's in-flight toggle", async () => {
    let resolveFirst!: () => void;
    const blockAdminAccount = vi
      .fn()
      .mockImplementationOnce(() => new Promise<void>((r) => (resolveFirst = r)))
      .mockResolvedValueOnce(undefined);
    const api = fakeApi({ blockAdminAccount });
    const controller = createAdminBlockController(api);

    const first = controller.toggle("account", "acc-kims", true);
    expect(controller.isPending("account", "acc-other")).toBe(false);
    const second = await controller.toggle("account", "acc-other", true);
    expect(second).toEqual({ status: "success" });

    resolveFirst();
    await first;
  });
});

// -- renderAdmin's block-failure banner (U4.8) -------------------------------

describe("renderAdmin with a block failure", () => {
  it("renders no banner when there is no failure", () => {
    const html = renderAdmin({ status: "ready", accounts: [account()], users: [user()], selfAccountId: "a", selfUserId: "u" });
    expect(html).not.toContain('data-testid="admin-block-failed"');
  });

  it("renders the banner above the Accounts list for an account-kind failure, naming the target", () => {
    const html = renderAdmin(
      { status: "ready", accounts: [account()], users: [user()], selfAccountId: "a", selfUserId: "u" },
      { kind: "account", id: "acc-kims", name: "The Kims", nextBlocked: true },
    );
    expect(html).toContain('data-testid="admin-block-failed"');
    expect(html).toContain("Couldn't update The Kims.");
    expect(html).toContain('data-action="retry-block"');
    const bannerIndex = html.indexOf('data-testid="admin-block-failed"');
    const accountsListIndex = html.indexOf('data-testid="admin-accounts-list"');
    const usersListIndex = html.indexOf('data-testid="admin-users-list"');
    expect(bannerIndex).toBeLessThan(accountsListIndex);
    expect(bannerIndex).toBeLessThan(usersListIndex);
  });

  it("renders the banner above the Users list for a user-kind failure", () => {
    const html = renderAdmin(
      { status: "ready", accounts: [account()], users: [user()], selfAccountId: "a", selfUserId: "u" },
      { kind: "user", id: "user-anna", name: "Anna Kim", nextBlocked: false },
    );
    const bannerIndex = html.indexOf('data-testid="admin-block-failed"');
    const accountsListIndex = html.indexOf('data-testid="admin-accounts-list"');
    const usersListIndex = html.indexOf('data-testid="admin-users-list"');
    expect(bannerIndex).toBeGreaterThan(accountsListIndex);
    expect(bannerIndex).toBeLessThan(usersListIndex);
    expect(html).toContain("Couldn't update Anna Kim.");
  });
});
