/** ApiClient: the Mini App's only channel to the FastAPI backend, mirroring
 * `bot/client.py`'s role for the bot (webapp/CLAUDE.md).
 *
 * Every request carries `X-Telegram-Init-Data` (D200) — the header is set on
 * every method, even when initData is missing, so the backend can return a
 * clean 401 instead of 400. `INTERNAL_TOKEN` never appears in this file;
 * `scripts/verify.sh` greps the build output and fails on a leak.
 *
 * Non-2xx responses raise typed errors — screens (M2) translate them into
 * human messages, never a raw status code (webapp/CLAUDE.md).
 */

import type { PeriodQuery } from "../lib/period";
import type {
  AccountResponse,
  AccountUpdate,
  AdminAccountRow,
  AdminUserRow,
  BudgetPlanCreate,
  BudgetPlanResponse,
  BudgetPlanUpdate,
  BudgetProgress,
  CategoryCreate,
  CategoryResponse,
  CategoryTotal,
  CategoryUpdate,
  ExpenseCreate,
  ExpenseResponse,
  ExpenseUpdate,
  PeriodTotal,
  TagCreate,
  TagResponse,
  TagTotal,
  TagUpdate,
  UserMeResponse,
  UserResponse,
  Uuid,
} from "./types";

export const INIT_DATA_HEADER = "X-Telegram-Init-Data";

/** Base for every typed error the client throws. `status` is undefined for
 * network failures (no HTTP response was ever seen). */
export class ApiError extends Error {
  readonly status: number | undefined;
  constructor(message: string, status?: number) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

/** 401 — the caller's `initData` is missing, expired, or forged. The Mini App
 * cannot recover on its own; the user has to reopen the app from Telegram so
 * the webview hands over a fresh signed payload. */
export class AuthError extends ApiError {
  constructor(message = "Reopen this app from Telegram to continue.") {
    super(message, 401);
    this.name = "AuthError";
  }
}

/** 403 — authenticated but the role/permission matrix denies the action
 * (api/CLAUDE.md). Read-only viewers and `own_only` misses land here. */
export class ForbiddenError extends ApiError {
  constructor(message = "You don't have permission for this action.") {
    super(message, 403);
    this.name = "ForbiddenError";
  }
}

/** 404 — the record does not exist (or has been deleted since the caller's
 * last read). Screens usually treat this as an empty/removed state rather
 * than an error strip. */
export class NotFoundError extends ApiError {
  constructor(message = "Not found.") {
    super(message, 404);
    this.name = "NotFoundError";
  }
}

/** 5xx or network failure — the caller may retry the same request without
 * changing anything. Screens should surface a "try again" affordance. */
export class RetryableError extends ApiError {
  constructor(message = "The server is unreachable right now. Please try again.", status?: number) {
    super(message, status);
    this.name = "RetryableError";
  }
}

export interface ApiClientOptions {
  /** Base URL for API calls. Default `""` — same-origin (D201). Tests pass an
   * absolute URL against their fake fetch. */
  baseUrl?: string;
  /** `fetch` implementation. Default `globalThis.fetch`. Tests inject a fake. */
  fetch?: typeof fetch;
  /** Reader for the caller's Telegram `initData`. Default returns `null`
   * (development fallback / outside Telegram). Wire to `lib/telegram.getInitData`
   * in the real boot path. */
  getInitData?: () => string | null;
}

type QueryParams = Record<string, string | number | undefined>;

interface RequestOptions {
  params?: QueryParams;
  json?: unknown;
}

/** `PeriodQuery` (D313, the primary selector) or the legacy `{ months_back }`
 * alias (D300). Both Home and Statistics send `PeriodQuery` now (V7, D704 —
 * screen 05 moved off `months_back` in `screens/statistics.ts`'s
 * `loadStatistics`). The alias stays on this client's type only because the
 * backend still accepts it for the bot (D708); nothing in this webapp calls
 * these three methods with `{ months_back }` any more. */
export type StatisticsQuery = PeriodQuery | { months_back?: number };

export class ApiClient {
  private readonly baseUrl: string;
  private readonly fetchFn: typeof fetch;
  private readonly getInitData: () => string | null;

  constructor(options: ApiClientOptions = {}) {
    this.baseUrl = options.baseUrl ?? "";
    this.fetchFn = options.fetch ?? globalThis.fetch.bind(globalThis);
    this.getInitData = options.getInitData ?? (() => null);
  }

  private buildUrl(path: string, params?: QueryParams): string {
    const search = new URLSearchParams();
    if (params) {
      for (const [key, value] of Object.entries(params)) {
        // Explicit undefined skip: `months_back=0` is a valid, meaningful value
        // (current month, U0.4), so a falsy check would silently drop it.
        if (value === undefined) {
          continue;
        }
        search.append(key, String(value));
      }
    }
    const query = search.toString();
    return query ? `${this.baseUrl}${path}?${query}` : `${this.baseUrl}${path}`;
  }

  private async request<T>(method: string, path: string, opts: RequestOptions = {}): Promise<T> {
    const url = this.buildUrl(path, opts.params);
    const headers: Record<string, string> = {
      [INIT_DATA_HEADER]: this.getInitData() ?? "",
    };
    let body: string | undefined;
    if (opts.json !== undefined) {
      headers["Content-Type"] = "application/json";
      body = JSON.stringify(opts.json);
    }

    let response: Response;
    try {
      response = await this.fetchFn(url, { method, headers, body });
    } catch {
      // fetch rejects only on network-layer failures (DNS, TCP, CORS…);
      // HTTP status codes are non-throw. Treat all of these as retryable.
      throw new RetryableError();
    }

    if (!response.ok) {
      throw this.mapErrorStatus(response.status);
    }
    if (response.status === 204) {
      return undefined as T;
    }
    return (await response.json()) as T;
  }

  private mapErrorStatus(status: number): ApiError {
    if (status === 401) {
      return new AuthError();
    }
    if (status === 403) {
      return new ForbiddenError();
    }
    if (status === 404) {
      return new NotFoundError();
    }
    if (status >= 500) {
      return new RetryableError(undefined, status);
    }
    return new ApiError(`Request failed (${status}).`, status);
  }

  // -- users -------------------------------------------------------------

  getMe(): Promise<UserMeResponse> {
    return this.request<UserMeResponse>("GET", "/users/me");
  }

  // -- accounts (U3.3, Settings) ------------------------------------------

  updateAccount(data: AccountUpdate): Promise<AccountResponse> {
    return this.request<AccountResponse>("PATCH", "/accounts/me", { json: data });
  }

  // -- expenses ----------------------------------------------------------

  // `period`'s offset travels as `period_offset` — `offset` on this route
  // already paginates and the bot depends on that spelling (D402).
  listExpenses(
    opts: { limit?: number; offset?: number; categoryId?: Uuid; period?: PeriodQuery } = {},
  ): Promise<ExpenseResponse[]> {
    return this.request<ExpenseResponse[]>("GET", "/expenses", {
      params: {
        limit: opts.limit,
        offset: opts.offset,
        category_id: opts.categoryId,
        period: opts.period?.period,
        period_offset: opts.period?.offset,
        start_date: opts.period?.start_date,
        end_date: opts.period?.end_date,
      },
    });
  }

  getExpense(id: Uuid): Promise<ExpenseResponse> {
    return this.request<ExpenseResponse>("GET", `/expenses/${id}`);
  }

  createExpense(data: ExpenseCreate): Promise<ExpenseResponse> {
    return this.request<ExpenseResponse>("POST", "/expenses", { json: data });
  }

  updateExpense(id: Uuid, data: ExpenseUpdate): Promise<ExpenseResponse> {
    return this.request<ExpenseResponse>("PATCH", `/expenses/${id}`, { json: data });
  }

  deleteExpense(id: Uuid): Promise<void> {
    return this.request<void>("DELETE", `/expenses/${id}`);
  }

  // -- categories (create/rename/recolour U2.2, delete-or-hide U2.3) ------

  listCategories(opts: { includeUsage?: boolean; includeArchived?: boolean } = {}): Promise<CategoryResponse[]> {
    return this.request<CategoryResponse[]>("GET", "/categories", {
      params: {
        include_usage: opts.includeUsage === undefined ? undefined : String(opts.includeUsage),
        include_archived: opts.includeArchived === undefined ? undefined : String(opts.includeArchived),
      },
    });
  }

  /** Single-category lookup, archived included (`GET /categories/{id}` has no
   * `is_active` filter, unlike the list route). Screen 02b's own use (U1.4):
   * resolving the name/colour of an expense's category when it has since
   * been archived and so is missing from `listCategories()`'s default call. */
  getCategory(id: Uuid): Promise<CategoryResponse> {
    return this.request<CategoryResponse>("GET", `/categories/${id}`);
  }

  createCategory(data: CategoryCreate): Promise<CategoryResponse> {
    return this.request<CategoryResponse>("POST", "/categories", { json: data });
  }

  updateCategory(id: Uuid, data: CategoryUpdate): Promise<CategoryResponse> {
    return this.request<CategoryResponse>("PATCH", `/categories/${id}`, { json: data });
  }

  deleteCategory(id: Uuid): Promise<void> {
    return this.request<void>("DELETE", `/categories/${id}`);
  }

  // -- tags (list U2.4; create/rename/delete-or-hide U2.5) -----------------

  listTags(opts: { includeUsage?: boolean; includeArchived?: boolean } = {}): Promise<TagResponse[]> {
    return this.request<TagResponse[]>("GET", "/tags", {
      params: {
        include_usage: opts.includeUsage === undefined ? undefined : String(opts.includeUsage),
        include_archived: opts.includeArchived === undefined ? undefined : String(opts.includeArchived),
      },
    });
  }

  createTag(data: TagCreate): Promise<TagResponse> {
    return this.request<TagResponse>("POST", "/tags", { json: data });
  }

  updateTag(id: Uuid, data: TagUpdate): Promise<TagResponse> {
    return this.request<TagResponse>("PATCH", `/tags/${id}`, { json: data });
  }

  deleteTag(id: Uuid): Promise<void> {
    return this.request<void>("DELETE", `/tags/${id}`);
  }

  // -- budgets -----------------------------------------------------------

  listBudgetPlans(): Promise<BudgetPlanResponse[]> {
    return this.request<BudgetPlanResponse[]>("GET", "/budgets");
  }

  getBudgetPlanProgress(id: Uuid): Promise<BudgetProgress> {
    return this.request<BudgetProgress>("GET", `/budgets/${id}/progress`);
  }

  createBudgetPlan(data: BudgetPlanCreate): Promise<BudgetPlanResponse> {
    return this.request<BudgetPlanResponse>("POST", "/budgets", { json: data });
  }

  updateBudgetPlan(id: Uuid, data: BudgetPlanUpdate): Promise<BudgetPlanResponse> {
    return this.request<BudgetPlanResponse>("PATCH", `/budgets/${id}`, { json: data });
  }

  deleteBudgetPlan(id: Uuid): Promise<void> {
    return this.request<void>("DELETE", `/budgets/${id}`);
  }

  // -- statistics ----------------------------------------------------------
  // Cast: every `StatisticsQuery` member's values are `string | number |
  // undefined`, but neither has an explicit index signature for QueryParams.

  statisticsByPeriod(query: StatisticsQuery = {}): Promise<PeriodTotal> {
    return this.request<PeriodTotal>("GET", "/statistics/by-period", { params: query as QueryParams });
  }

  statisticsByCategory(query: StatisticsQuery = {}): Promise<CategoryTotal[]> {
    return this.request<CategoryTotal[]>("GET", "/statistics/by-category", { params: query as QueryParams });
  }

  statisticsByTag(query: StatisticsQuery = {}): Promise<TagTotal[]> {
    return this.request<TagTotal[]>("GET", "/statistics/by-tag", { params: query as QueryParams });
  }

  // -- admin (`screens/admin.ts`, U4.7) -----------------------------------
  // Cross-account (D711); both 403 for every caller but `system_admin`
  // (`require_system_admin`, U4.3) — `screens/admin.ts::loadAdmin` maps that
  // into the screen's own `forbidden` state via `ForbiddenError`.

  listAdminAccounts(): Promise<AdminAccountRow[]> {
    return this.request<AdminAccountRow[]>("GET", "/admin/accounts");
  }

  listAdminUsers(): Promise<AdminUserRow[]> {
    return this.request<AdminUserRow[]>("GET", "/admin/users");
  }

  // Block/unblock (U4.5/U4.8). `screens/admin.ts` applies the flag
  // optimistically before this call and ignores the response body — it
  // already knows the outcome it's asking for.
  blockAdminAccount(id: Uuid, isBlocked: boolean): Promise<AccountResponse> {
    return this.request<AccountResponse>("PATCH", `/admin/accounts/${id}/block`, { json: { is_blocked: isBlocked } });
  }

  blockAdminUser(id: Uuid, isBlocked: boolean): Promise<UserResponse> {
    return this.request<UserResponse>("PATCH", `/admin/users/${id}/block`, { json: { is_blocked: isBlocked } });
  }
}
