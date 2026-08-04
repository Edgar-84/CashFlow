import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  ApiClient,
  ApiError,
  AuthError,
  ForbiddenError,
  INIT_DATA_HEADER,
  NotFoundError,
  RetryableError,
} from "../src/api/client";
import type { CategoryTotal, ExpenseResponse, UserMeResponse } from "../src/api/types";

/** Build a fake `fetch` that returns the given Response for every call. */
function fakeFetch(response: Response | (() => Response)): typeof fetch {
  const fn = vi.fn(async () => (typeof response === "function" ? response() : response));
  return fn as unknown as typeof fetch;
}

function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json" },
    ...init,
  });
}

function noBodyResponse(status: number): Response {
  return new Response(null, { status });
}

/** Convenience: build an ApiClient wired to a fake fetch and a fixed
 * initData string. Returns both so tests can assert on call args. */
function makeClient(
  response: Response | (() => Response),
  initData: string | null = "user=1&hash=abc",
) {
  const fetchFn = fakeFetch(response);
  const client = new ApiClient({
    baseUrl: "https://api.test",
    fetch: fetchFn,
    getInitData: () => initData,
  });
  return { client, fetchFn: fetchFn as unknown as ReturnType<typeof vi.fn> };
}

function lastCall(fetchFn: ReturnType<typeof vi.fn>): { url: string; init: RequestInit } {
  const args = fetchFn.mock.calls.at(-1);
  if (!args) {
    throw new Error("fetch was not called");
  }
  const [url, init] = args as [string, RequestInit];
  return { url, init };
}

function headersOf(init: RequestInit): Record<string, string> {
  return (init.headers ?? {}) as Record<string, string>;
}

describe("ApiClient — initData header", () => {
  it("sends the header on every v1 endpoint (each HTTP verb, each resource)", async () => {
    // Every method funnels through the same private `request()`, but hitting
    // the whole surface guards against a future method skipping the funnel.
    const fetchFn = vi.fn(async (_url: string, _init?: RequestInit) => {
      const url = String(_url);
      if (url.includes("delete") || (_init?.method === "DELETE")) {
        return noBodyResponse(204);
      }
      // Return a list for list-shaped endpoints; empty object otherwise —
      // enough for JSON.parse to succeed under any method.
      return jsonResponse(url.includes("statistics/by-period") ? {} : []);
    });
    const client = new ApiClient({
      baseUrl: "https://api.test",
      fetch: fetchFn as unknown as typeof fetch,
      getInitData: () => "user=1&hash=deadbeef",
    });

    await client.getMe();
    await client.listExpenses();
    await client.getExpense("id");
    await client.createExpense({ amount: 100, category_id: "c" });
    await client.updateExpense("id", { amount: 200 });
    await client.deleteExpense("id");
    await client.listCategories();
    await client.listTags();
    await client.listBudgetPlans();
    await client.getBudgetPlanProgress("bp");
    await client.createBudgetPlan({ category_id: "c", amount: 1000 });
    await client.updateBudgetPlan("bp", { amount: 2000 });
    await client.deleteBudgetPlan("bp");
    await client.statisticsByPeriod({ months_back: 0 });
    await client.statisticsByCategory({ months_back: 1 });
    await client.statisticsByTag({ months_back: 2 });

    expect(fetchFn.mock.calls.length).toBe(16);
    for (const [, init] of fetchFn.mock.calls as Array<[string, RequestInit]>) {
      expect(headersOf(init)[INIT_DATA_HEADER]).toBe("user=1&hash=deadbeef");
    }
  });

  it("sends the header even when initData is unavailable, so backend can 401 cleanly", async () => {
    const { client, fetchFn } = makeClient(jsonResponse({}), null);

    await client.getMe().catch(() => undefined);

    const { init } = lastCall(fetchFn);
    expect(init.headers).toBeDefined();
    expect(headersOf(init)[INIT_DATA_HEADER]).toBe("");
  });
});

describe("ApiClient — error mapping", () => {
  it("401 → AuthError with a reopen-from-Telegram message", async () => {
    const { client } = makeClient(jsonResponse({ detail: "bad" }, { status: 401 }));
    await expect(client.getMe()).rejects.toBeInstanceOf(AuthError);
    await expect(client.getMe()).rejects.toMatchObject({
      status: 401,
      message: expect.stringContaining("Telegram"),
    });
  });

  it("403 → ForbiddenError with a permission message", async () => {
    const { client } = makeClient(jsonResponse({}, { status: 403 }));
    await expect(client.listExpenses()).rejects.toBeInstanceOf(ForbiddenError);
    await expect(client.listExpenses()).rejects.toMatchObject({
      status: 403,
      message: expect.stringContaining("permission"),
    });
  });

  it("404 → NotFoundError", async () => {
    const { client } = makeClient(jsonResponse({}, { status: 404 }));
    await expect(client.getExpense("missing")).rejects.toBeInstanceOf(NotFoundError);
    await expect(client.getExpense("missing")).rejects.toMatchObject({ status: 404 });
  });

  it("500 → RetryableError carrying the status", async () => {
    const { client } = makeClient(jsonResponse({}, { status: 500 }));
    await expect(client.getMe()).rejects.toBeInstanceOf(RetryableError);
    await expect(client.getMe()).rejects.toMatchObject({ status: 500 });
  });

  it("503 → RetryableError", async () => {
    const { client } = makeClient(jsonResponse({}, { status: 503 }));
    await expect(client.getMe()).rejects.toBeInstanceOf(RetryableError);
  });

  it("network failure (fetch rejects) → RetryableError with undefined status", async () => {
    const fetchFn = vi.fn(async () => {
      throw new TypeError("Failed to fetch");
    });
    const client = new ApiClient({
      baseUrl: "https://api.test",
      fetch: fetchFn as unknown as typeof fetch,
      getInitData: () => "user=1&hash=abc",
    });
    await expect(client.getMe()).rejects.toBeInstanceOf(RetryableError);
    await expect(client.getMe()).rejects.toMatchObject({ status: undefined });
  });

  it("unmapped 4xx (e.g. 409) → plain ApiError, not a Retryable one", async () => {
    const { client } = makeClient(jsonResponse({}, { status: 409 }));
    await expect(
      client.createBudgetPlan({ category_id: "c", amount: 1000 }),
    ).rejects.toBeInstanceOf(ApiError);
    await expect(
      client.createBudgetPlan({ category_id: "c", amount: 1000 }),
    ).rejects.not.toBeInstanceOf(RetryableError);
  });
});

describe("ApiClient — query params", () => {
  it("listExpenses serializes limit and offset when provided", async () => {
    const { client, fetchFn } = makeClient(jsonResponse([]));

    await client.listExpenses({ limit: 25, offset: 50 });

    const { url } = lastCall(fetchFn);
    expect(url).toBe("https://api.test/expenses?limit=25&offset=50");
  });

  it("listExpenses omits query string entirely when no params given", async () => {
    const { client, fetchFn } = makeClient(jsonResponse([]));

    await client.listExpenses();

    const { url } = lastCall(fetchFn);
    expect(url).toBe("https://api.test/expenses");
  });

  it("statisticsByCategory sends months_back=0 (falsy but meaningful — current month)", async () => {
    const { client, fetchFn } = makeClient(jsonResponse([]));

    await client.statisticsByCategory({ months_back: 0 });

    const { url } = lastCall(fetchFn);
    expect(url).toBe("https://api.test/statistics/by-category?months_back=0");
  });

  it("statisticsByPeriod omits months_back when undefined", async () => {
    const { client, fetchFn } = makeClient(jsonResponse({}));

    await client.statisticsByPeriod();

    const { url } = lastCall(fetchFn);
    expect(url).toBe("https://api.test/statistics/by-period");
  });
});

describe("ApiClient — PeriodQuery (D313)", () => {
  it("period=custom serializes start_date/end_date and nothing else", async () => {
    const { client, fetchFn } = makeClient(jsonResponse({}));

    await client.statisticsByPeriod({ period: "custom", start_date: "2026-07-09", end_date: "2026-07-17" });

    const { url } = lastCall(fetchFn);
    expect(url).toBe(
      "https://api.test/statistics/by-period?period=custom&start_date=2026-07-09&end_date=2026-07-17",
    );
  });

  it("a unit serializes period and offset and nothing else", async () => {
    const { client, fetchFn } = makeClient(jsonResponse([]));

    await client.statisticsByCategory({ period: "month", offset: -1 });

    const { url } = lastCall(fetchFn);
    expect(url).toBe("https://api.test/statistics/by-category?period=month&offset=-1");
  });

  it("offset=0 is sent explicitly rather than omitted", async () => {
    const { client, fetchFn } = makeClient(jsonResponse([]));

    await client.statisticsByTag({ period: "day", offset: 0 });

    const { url } = lastCall(fetchFn);
    expect(url).toBe("https://api.test/statistics/by-tag?period=day&offset=0");
  });

  it("never sends months_back for a PeriodQuery call", async () => {
    const { client, fetchFn } = makeClient(jsonResponse({}));

    await client.statisticsByPeriod({ period: "week", offset: 0 });

    const { url } = lastCall(fetchFn);
    expect(url).not.toContain("months_back");
  });

  it("a 422 from a conflicting selector surfaces as a typed ApiError, not a crash", async () => {
    const { client } = makeClient(
      jsonResponse(
        { detail: "at most one of period/offset, months_back, or start/end may be given" },
        { status: 422 },
      ),
    );

    await expect(
      client.statisticsByPeriod({ period: "month", offset: 0 }),
    ).rejects.toBeInstanceOf(ApiError);
    await expect(
      client.statisticsByPeriod({ period: "month", offset: 0 }),
    ).rejects.not.toBeInstanceOf(RetryableError);
  });
});

describe("ApiClient — payload discipline", () => {
  let fetchFn: ReturnType<typeof vi.fn>;
  let client: ApiClient;

  beforeEach(() => {
    fetchFn = vi.fn(async () => jsonResponse({}));
    client = new ApiClient({
      baseUrl: "https://api.test",
      fetch: fetchFn as unknown as typeof fetch,
      getInitData: () => "user=1&hash=abc",
    });
  });

  it("createExpense sends only user-supplied fields — never account_id or user_id", async () => {
    await client.createExpense({
      amount: 4200,
      comment: "coffee",
      category_id: "cat-1",
      tag_ids: ["tag-1"],
    });

    const { init } = lastCall(fetchFn);
    expect(init.method).toBe("POST");
    const body = JSON.parse(init.body as string) as Record<string, unknown>;
    expect(body).toEqual({
      amount: 4200,
      comment: "coffee",
      category_id: "cat-1",
      tag_ids: ["tag-1"],
    });
    expect(body).not.toHaveProperty("account_id");
    expect(body).not.toHaveProperty("user_id");
  });

  it("createBudgetPlan sends only user-supplied fields — never account_id or user_id", async () => {
    await client.createBudgetPlan({
      category_id: "cat-1",
      amount: 500000,
      notify_threshold: 80,
    });

    const { init } = lastCall(fetchFn);
    const body = JSON.parse(init.body as string) as Record<string, unknown>;
    expect(body).not.toHaveProperty("account_id");
    expect(body).not.toHaveProperty("user_id");
    expect(body).toHaveProperty("category_id", "cat-1");
  });

  it("POST/PATCH set Content-Type: application/json; GET/DELETE do not", async () => {
    await client.createExpense({ amount: 100, category_id: "c" });
    let { init } = lastCall(fetchFn);
    expect(headersOf(init)["Content-Type"]).toBe("application/json");

    fetchFn.mockClear();
    fetchFn.mockImplementation(async () => jsonResponse({}));
    await client.updateExpense("id", { amount: 200 });
    ({ init } = lastCall(fetchFn));
    expect(headersOf(init)["Content-Type"]).toBe("application/json");

    fetchFn.mockClear();
    fetchFn.mockImplementation(async () => jsonResponse([]));
    await client.listExpenses();
    ({ init } = lastCall(fetchFn));
    expect(headersOf(init)["Content-Type"]).toBeUndefined();

    fetchFn.mockClear();
    fetchFn.mockImplementation(async () => noBodyResponse(204));
    await client.deleteExpense("id");
    ({ init } = lastCall(fetchFn));
    expect(headersOf(init)["Content-Type"]).toBeUndefined();
  });
});

describe("ApiClient — response parsing", () => {
  it("returns the parsed JSON body typed as the endpoint's response", async () => {
    const payload: UserMeResponse = {
      id: "u-1",
      tg_id: 42,
      name: "Wife",
      role: "member",
      account_id: "a-1",
      created_at: "2026-07-29T00:00:00Z",
      currency: "PLN",
      account_name: "Smith Family",
    };
    const { client } = makeClient(jsonResponse(payload));

    const result = await client.getMe();

    expect(result).toEqual(payload);
    expect(result.currency).toBe("PLN");
  });

  it("DELETE with 204 resolves to undefined without attempting a JSON parse", async () => {
    const { client } = makeClient(noBodyResponse(204));

    await expect(client.deleteExpense("id")).resolves.toBeUndefined();
  });

  it("preserves the response shape for list endpoints", async () => {
    const payload: CategoryTotal[] = [
      { category_id: "c-1", total: 4200 },
      { category_id: "c-2", total: 1000 },
    ];
    const { client } = makeClient(jsonResponse(payload));

    const result = await client.statisticsByCategory({ months_back: 0 });

    expect(result).toEqual(payload);
  });

  it("expense list survives an empty payload", async () => {
    const { client } = makeClient(jsonResponse([] as ExpenseResponse[]));
    await expect(client.listExpenses()).resolves.toEqual([]);
  });
});
