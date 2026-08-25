import { afterEach, describe, expect, it } from "vitest";
import { renderSideMenu, type MenuItem, type SideMenuProps } from "../src/components/side-menu";
import { setLanguage } from "../src/lib/i18n";

afterEach(() => {
  setLanguage("en");
});

const NOOP = (): void => {};

function props(overrides: Partial<SideMenuProps> = {}): SideMenuProps {
  return {
    open: true,
    accountName: "The Smiths",
    currency: "USD",
    onSelect: NOOP,
    onClose: NOOP,
    ...overrides,
  };
}

// vitest.config's `environment: "node"` means `document` is undefined here,
// same as every other component's suite in this project — this covers
// `renderSideMenu` only. `mount`'s DOM wiring (scrim/row taps, the focus trap,
// Escape) is the same accepted, code-reviewed-not-unit-tested gap
// period-selector.ts/date-range-picker.ts's `mount` already carries; it gets
// its first live exercise when U3.2 wires this component into Home.

describe("renderSideMenu — closed", () => {
  it("renders nothing when open is false", () => {
    expect(renderSideMenu(props({ open: false }))).toBe("");
  });
});

describe("renderSideMenu — rows", () => {
  it("renders exactly seven rows in the specified order", () => {
    const html = renderSideMenu(props());
    const order: Array<[MenuItem, string]> = [
      ["add-expense", "Add expense"],
      ["expenses", "Expenses"],
      ["budgets", "Budgets"],
      ["statistics", "Statistics"],
      ["categories", "Categories"],
      ["tags", "Tags"],
      ["settings", "Settings"],
    ];
    const indices = order.map(([id]) => html.indexOf(`data-item="${id}"`));
    expect(indices.every((i) => i >= 0)).toBe(true);
    expect(indices).toEqual([...indices].sort((a, b) => a - b));
    expect((html.match(/data-item="/g) ?? []).length).toBe(7);
    for (const [id, label] of order) {
      expect(html).toContain(`data-testid="side-menu-row-${id}"`);
      expect(html).toMatch(new RegExp(`data-item="${id}"[^>]*>${label}<`));
    }
  });

  it("gives only Settings the gap class that separates it from the six", () => {
    const html = renderSideMenu(props());
    expect((html.match(/class="side-menu-row side-menu-row-settings"/g) ?? []).length).toBe(1);
    expect(html).toMatch(/class="side-menu-row side-menu-row-settings" data-item="settings"/);
  });

  it("renders no icon markup in the panel", () => {
    const html = renderSideMenu(props());
    expect(html).not.toContain("<svg");
  });
});

describe("renderSideMenu — read-only", () => {
  it("disables only Add expense, leaving the other six enabled", () => {
    const html = renderSideMenu(props({ readOnly: true }));
    expect(html).toMatch(/data-item="add-expense"[^>]* disabled/);
    for (const id of ["expenses", "budgets", "statistics", "categories", "tags", "settings"]) {
      expect(html).not.toMatch(new RegExp(`data-item="${id}"[^>]* disabled`));
    }
  });

  it("omitting readOnly disables nothing", () => {
    const html = renderSideMenu(props());
    expect(html).not.toContain("disabled");
  });
});

describe("renderSideMenu — header", () => {
  it("shows the account name over the currency code", () => {
    const html = renderSideMenu(props({ accountName: "The Smiths", currency: "EUR" }));
    const accountIdx = html.indexOf(">The Smiths<");
    const currencyIdx = html.indexOf(">EUR<");
    expect(accountIdx).toBeGreaterThan(-1);
    expect(currencyIdx).toBeGreaterThan(accountIdx);
  });

  it("omits the account name line when accountName is null", () => {
    const html = renderSideMenu(props({ accountName: null, currency: "EUR" }));
    expect(html).not.toContain("side-menu-account");
    expect(html).toContain("side-menu-currency");
  });

  it("omits the currency line when currency is null", () => {
    const html = renderSideMenu(props({ accountName: "The Smiths", currency: null }));
    expect(html).toContain("side-menu-account");
    expect(html).not.toContain("side-menu-currency");
  });

  it("renders the header band exactly once", () => {
    const html = renderSideMenu(props());
    expect((html.match(/data-testid="side-menu-header"/g) ?? []).length).toBe(1);
  });
});

describe("renderSideMenu — footer", () => {
  it("reads 'Synced <date> <time>' when a cache timestamp is given", () => {
    const html = renderSideMenu(props({ lastSyncedAt: "2026-08-07T17:18:00.000Z" }));
    expect(html).toMatch(/data-testid="side-menu-footer">Synced \d{1,2}\/\d{1,2}\/\d{4} \d{2}:\d{2}</);
  });

  it("renders no footer, not a placeholder, when there is no cache timestamp", () => {
    const html = renderSideMenu(props());
    expect(html).not.toContain("side-menu-footer");
  });
});

describe("renderSideMenu — colour discipline", () => {
  it("never renders --accent or a category colour anywhere", () => {
    const html = renderSideMenu(props({ readOnly: true, lastSyncedAt: "2026-08-07T17:18:00.000Z" }));
    expect(html).not.toContain("--accent");
    expect(html).not.toContain("category-slot");
  });
});

describe("renderSideMenu — dialog semantics", () => {
  it("the panel is a modal dialog labelled Menu, and the scrim is hidden from assistive tech", () => {
    const html = renderSideMenu(props());
    expect(html).toContain('role="dialog"');
    expect(html).toContain('aria-modal="true"');
    expect(html).toContain('aria-label="Menu"');
    expect(html).toMatch(/side-menu-scrim" aria-hidden="true"/);
  });
});

// U3.5: every row label and the panel's aria-label come from the i18n
// catalogue (`lib/i18n.ts`), not a baked-in English string.
describe("renderSideMenu — language (U3.5)", () => {
  it("renders RU row labels and the RU dialog aria-label when the language is set", () => {
    setLanguage("ru");
    const html = renderSideMenu(props());
    expect(html).toMatch(/data-item="add-expense"[^>]*>Добавить расход</);
    expect(html).toMatch(/data-item="settings"[^>]*>Настройки</);
    expect(html).toContain('aria-label="Меню"');
  });

  it("renders the RU footer through the same {date} {time} template as EN", () => {
    setLanguage("ru");
    const html = renderSideMenu(props({ lastSyncedAt: "2026-08-07T17:18:00.000Z" }));
    expect(html).toMatch(/data-testid="side-menu-footer">Синхронизировано \d{1,2}\/\d{1,2}\/\d{4} \d{2}:\d{2}</);
  });
});
