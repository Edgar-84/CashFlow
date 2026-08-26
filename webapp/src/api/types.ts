/** Hand-written TypeScript mirrors of the backend's Pydantic `*Response`
 * models that this app actually consumes in v1 (screens 01–05, D204).
 *
 * When a Pydantic model changes, this file changes in the same unit — that is
 * the whole point of hand-writing over code generation (webapp/CLAUDE.md).
 *
 * IDs are `string` (UUIDs), timestamps are `string` (ISO 8601 as emitted by
 * FastAPI's default JSON encoder). Money is `number` and always minor units
 * (kopecks/cents) — root CLAUDE.md's ironclad rule.
 */

export type Uuid = string;
export type IsoTimestamp = string;

export type Role = "admin" | "member" | "viewer";

/** `models.enums.Currency` (D211) — 15 ISO 4217 codes offered at account
 * creation. Kept in lockstep with `models/enums.py::Currency`. */
export type Currency =
  | "USD"
  | "EUR"
  | "GBP"
  | "PLN"
  | "UAH"
  | "CZK"
  | "CHF"
  | "SEK"
  | "NOK"
  | "DKK"
  | "JPY"
  | "CNY"
  | "CAD"
  | "AUD"
  | "TRY";

/** `models.enums.Language` (D701/D702) — kept in lockstep with
 * `models/enums.py::Language`. `lib/i18n.ts`'s `Lang` is the same value set,
 * kept as its own literal union rather than importing this one (D716) — the
 * two modules serve different concerns (an account setting vs. the active
 * rendering language) and a structural literal union needs no import to
 * type-check against this one. */
export type Language = "en" | "ru" | "uk";

export interface UserResponse {
  id: Uuid;
  tg_id: number;
  name: string;
  role: Role;
  account_id: Uuid;
  created_at: IsoTimestamp;
}

/** `models.user.UserMeResponse` — `GET /users/me` only, adds the caller's
 * account currency (D211), name (U0.2c), today's date in `family_tz`
 * (`YYYY-MM-DD` — the Add-expense date row's anchor, never the device clock)
 * and the account's UI language (U3.1, D701/D702). Every other `users`
 * route returns `UserResponse`. */
export interface UserMeResponse extends UserResponse {
  currency: Currency;
  account_name: string;
  today: string;
  language: Language;
}

export interface CategoryResponse {
  id: Uuid;
  name: string;
  account_id: Uuid;
  created_at: IsoTimestamp;
  /** Palette slot index (1-12), `null`/omitted = not yet assigned
   * (D301/D308) — `lib/category-colors.ts` treats both the same, falling
   * back to its own position rule. */
  color_slot?: number | null;
  /** Defaults `true` server-side (`models/category.py`); omitted only for
   * older callers that don't request this field. */
  is_active?: boolean;
  /** Populated only when the caller passes `include_usage=true`; `null`/
   * omitted means "not requested", never "zero" (U2.1). */
  expense_count?: number | null;
}

export interface CategoryCreate {
  name: string;
  /** 1-12 (D317); omitted lets the server auto-assign from its 1-6 pool. */
  color_slot?: number | null;
}

export interface CategoryUpdate {
  name?: string;
  color_slot?: number | null;
}

export interface TagResponse {
  id: Uuid;
  name: string;
  account_id: Uuid;
  created_at: IsoTimestamp;
  /** Defaults `true` server-side (`models/tag.py`); omitted only for older
   * callers that don't request this field. */
  is_active?: boolean;
  /** Populated only when the caller passes `include_usage=true`; `null`/
   * omitted means "not requested", never "zero" (U2.4). */
  expense_count?: number | null;
}

export interface TagCreate {
  name: string;
}

export interface TagUpdate {
  name?: string;
}

export interface ExpenseResponse {
  id: Uuid;
  amount: number;
  comment: string | null;
  category_id: Uuid;
  /** The day the expense happened, `YYYY-MM-DD` — distinct from `created_at`
   * (D314). Filters and statistics aggregate on this, not `created_at`. */
  spent_at: string;
  user_id: Uuid;
  account_id: Uuid;
  created_at: IsoTimestamp;
  updated_at: IsoTimestamp;
  tags: TagResponse[];
  user_name: string | null;
}

/** POST /expenses payload. No `account_id` — backend derives it from the
 * caller (webapp/CLAUDE.md's zero-DB-concepts rule; api/CLAUDE.md's
 * "neither client ever sends account_id or user UUIDs"). */
export interface ExpenseCreate {
  amount: number;
  comment?: string | null;
  category_id: Uuid;
  /** `YYYY-MM-DD`. Omitted defaults to today in `family_tz` (D314) — the
   * bot needs no change for this reason. A future date is rejected (422). */
  spent_at?: string;
  tag_ids?: Uuid[];
}

/** PATCH /expenses/{id} payload — every field optional (partial update,
 * four-schema pattern). `spent_at`, like `amount`/`category_id`, is a
 * NOT NULL column with no "clear" semantics — omit it to leave unchanged. */
export interface ExpenseUpdate {
  amount?: number;
  comment?: string | null;
  category_id?: Uuid;
  spent_at?: string;
  tag_ids?: Uuid[];
}

export type BudgetPeriod = "monthly";

export interface BudgetPlanResponse {
  id: Uuid;
  category_id: Uuid;
  amount: number;
  period: BudgetPeriod;
  notify_threshold: number;
  account_id: Uuid;
  created_at: IsoTimestamp;
  updated_at: IsoTimestamp;
}

export interface BudgetPlanCreate {
  category_id: Uuid;
  amount: number;
  period?: BudgetPeriod;
  notify_threshold?: number;
}

export interface BudgetPlanUpdate {
  amount?: number;
  period?: BudgetPeriod;
  notify_threshold?: number;
}

/** `models.budget_plan.BudgetProgress` — computed by budget_service, never a
 * DB row. `fill_pct` is `null` when the plan's `amount <= 0`. */
export interface BudgetProgress {
  budget_plan_id: Uuid;
  category_id: Uuid;
  amount: number;
  spent: number;
  remaining: number;
  fill_pct: number | null;
  notify_threshold: number;
  is_over_threshold: boolean;
  is_exceeded: boolean;
}

export interface PeriodTotal {
  start: IsoTimestamp;
  end: IsoTimestamp;
  total: number;
}

export interface CategoryTotal {
  category_id: Uuid;
  total: number;
}

export interface TagTotal {
  tag_id: Uuid;
  total: number;
}

/** `models.account.AccountResponse` — `PATCH /accounts/me` only (U3.3). No
 * `GET /accounts/me`: the account's currency for display is read off
 * `UserMeResponse.currency` instead, already returned by `GET /users/me`.
 * `language` (D701/D702, U3.1) was live on the backend before any screen
 * consumed it here — `screens/language.ts` (U3.11) is its first reader. */
export interface AccountResponse {
  id: Uuid;
  name: string;
  currency: Currency;
  language: Language;
  owner_id: Uuid | null;
  created_at: IsoTimestamp;
}

/** `models.account.AccountUpdate` — relabels the account's currency, never
 * converts `expenses.amount` (D400/D401); `language` (U3.1) relabels chrome
 * only, never stored data (plan Non-goals). */
export interface AccountUpdate {
  currency?: Currency;
  language?: Language;
}
