import { afterEach, describe, expect, it, vi } from "vitest";
import {
  applyTheme,
  expand,
  getInitData,
  haptics,
  isAvailable,
  mainButton,
  NOT_IN_TELEGRAM_MESSAGE,
  resolveThemeTokens,
  setBackButtonHandler,
  type TelegramWebApp,
} from "../src/lib/telegram";

function fakeWebApp(overrides: Partial<TelegramWebApp> = {}): TelegramWebApp {
  return {
    initData: "user=fake&hash=abc",
    colorScheme: "light",
    expand: vi.fn(),
    MainButton: {
      setText: vi.fn(),
      show: vi.fn(),
      hide: vi.fn(),
      enable: vi.fn(),
      disable: vi.fn(),
      onClick: vi.fn(),
      offClick: vi.fn(),
    },
    BackButton: {
      show: vi.fn(),
      hide: vi.fn(),
      onClick: vi.fn(),
      offClick: vi.fn(),
    },
    HapticFeedback: {
      impactOccurred: vi.fn(),
      notificationOccurred: vi.fn(),
      selectionChanged: vi.fn(),
    },
    ...overrides,
  };
}

function installWebApp(webApp: TelegramWebApp): void {
  (globalThis as { window?: Window }).window = {
    Telegram: { WebApp: webApp },
  } as unknown as Window;
}

afterEach(() => {
  delete (globalThis as { window?: Window }).window;
});

describe("resolveThemeTokens", () => {
  it("produces the documented light token values", () => {
    expect(resolveThemeTokens("light")).toEqual({
      appBackground: "#EDF0EF",
      card: "#FFFFFF",
      ink: "#0E1416",
      inkSecondary: "#6C7679",
      separator: "#E4E8E7",
    });
  });

  it("produces the documented dark token values", () => {
    expect(resolveThemeTokens("dark")).toEqual({
      appBackground: "#101415",
      card: "#1C2123",
      ink: "#F1F5F4",
      inkSecondary: "#97A1A3",
      separator: "#272D2F",
    });
  });
});

describe("applyTheme", () => {
  it("does not throw without a DOM, even with a webApp present", () => {
    installWebApp(fakeWebApp({ colorScheme: "dark" }));
    expect(() => applyTheme()).not.toThrow();
  });
});

describe("mainButton", () => {
  it("show() sets the label and shows the button", () => {
    const webApp = fakeWebApp();
    installWebApp(webApp);

    mainButton.show("Add €38.40 to Groceries");

    expect(webApp.MainButton.setText).toHaveBeenCalledWith("Add €38.40 to Groceries");
    expect(webApp.MainButton.show).toHaveBeenCalledOnce();
  });

  it("hide() hides the button", () => {
    const webApp = fakeWebApp();
    installWebApp(webApp);

    mainButton.hide();

    expect(webApp.MainButton.hide).toHaveBeenCalledOnce();
  });

  it("setEnabled() enables and disables", () => {
    const webApp = fakeWebApp();
    installWebApp(webApp);

    mainButton.setEnabled(true);
    expect(webApp.MainButton.enable).toHaveBeenCalledOnce();
    expect(webApp.MainButton.disable).not.toHaveBeenCalled();

    mainButton.setEnabled(false);
    expect(webApp.MainButton.disable).toHaveBeenCalledOnce();
  });
});

describe("setBackButtonHandler", () => {
  it("wires a handler, then unwires it before wiring the next screen's, then unwires on null", async () => {
    vi.resetModules();
    const { setBackButtonHandler: setHandler } = await import("../src/lib/telegram");
    const webApp = fakeWebApp();
    installWebApp(webApp);

    const screenOneHandler = vi.fn();
    setHandler(screenOneHandler);
    expect(webApp.BackButton.onClick).toHaveBeenCalledWith(screenOneHandler);
    expect(webApp.BackButton.show).toHaveBeenCalledOnce();
    expect(webApp.BackButton.offClick).not.toHaveBeenCalled();

    const screenTwoHandler = vi.fn();
    setHandler(screenTwoHandler);
    expect(webApp.BackButton.offClick).toHaveBeenCalledWith(screenOneHandler);
    expect(webApp.BackButton.onClick).toHaveBeenCalledWith(screenTwoHandler);

    setHandler(null);
    expect(webApp.BackButton.offClick).toHaveBeenCalledWith(screenTwoHandler);
    expect(webApp.BackButton.hide).toHaveBeenCalledOnce();
  });
});

describe("haptics", () => {
  it("forwards impact, notification and selection to HapticFeedback", () => {
    const webApp = fakeWebApp();
    installWebApp(webApp);

    haptics.impact("light");
    haptics.notification("success");
    haptics.selection();

    expect(webApp.HapticFeedback.impactOccurred).toHaveBeenCalledWith("light");
    expect(webApp.HapticFeedback.notificationOccurred).toHaveBeenCalledWith("success");
    expect(webApp.HapticFeedback.selectionChanged).toHaveBeenCalledOnce();
  });
});

describe("without a Telegram object", () => {
  it("degrades to a readable unavailable state instead of throwing", () => {
    expect(isAvailable()).toBe(false);
    expect(getInitData()).toBeNull();
    expect(NOT_IN_TELEGRAM_MESSAGE.length).toBeGreaterThan(0);

    expect(() => expand()).not.toThrow();
    expect(() => mainButton.show("Save")).not.toThrow();
    expect(() => mainButton.hide()).not.toThrow();
    expect(() => mainButton.setEnabled(true)).not.toThrow();
    expect(() => setBackButtonHandler(() => {})).not.toThrow();
    expect(() => setBackButtonHandler(null)).not.toThrow();
    expect(() => haptics.impact()).not.toThrow();
    expect(() => haptics.notification("error")).not.toThrow();
    expect(() => haptics.selection()).not.toThrow();
    expect(() => applyTheme()).not.toThrow();
  });
});

describe("with a Telegram object present", () => {
  it("isAvailable() and getInitData() reflect it", () => {
    installWebApp(fakeWebApp({ initData: "user=1&hash=xyz" }));

    expect(isAvailable()).toBe(true);
    expect(getInitData()).toBe("user=1&hash=xyz");
  });
});
