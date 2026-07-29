/** The only module touching `window.Telegram.WebApp`: MainButton, BackButton,
 * haptics, theme params, `initData`, `expand()`. Every function degrades to a
 * safe no-op (or a documented fallback value) when Telegram is absent —
 * screens must never crash when opened outside Telegram.
 */

export interface TelegramWebApp {
  initData: string;
  colorScheme: "light" | "dark";
  expand(): void;
  MainButton: {
    setText(text: string): void;
    show(): void;
    hide(): void;
    enable(): void;
    disable(): void;
    onClick(handler: () => void): void;
    offClick(handler: () => void): void;
  };
  BackButton: {
    show(): void;
    hide(): void;
    onClick(handler: () => void): void;
    offClick(handler: () => void): void;
  };
  HapticFeedback: {
    impactOccurred(style: "light" | "medium" | "heavy" | "rigid" | "soft"): void;
    notificationOccurred(type: "error" | "success" | "warning"): void;
    selectionChanged(): void;
  };
}

declare global {
  interface Window {
    Telegram?: {
      WebApp?: TelegramWebApp;
    };
  }
}

export const NOT_IN_TELEGRAM_MESSAGE = "Open this app from Telegram to continue.";

export function getWebApp(): TelegramWebApp | undefined {
  if (typeof window === "undefined") {
    return undefined;
  }
  return window.Telegram?.WebApp;
}

export function isAvailable(): boolean {
  return getWebApp() !== undefined;
}

export function getInitData(): string | null {
  return getWebApp()?.initData ?? null;
}

export function expand(): void {
  getWebApp()?.expand();
}

export const mainButton = {
  show(label: string): void {
    const webApp = getWebApp();
    if (!webApp) {
      return;
    }
    webApp.MainButton.setText(label);
    webApp.MainButton.show();
  },
  hide(): void {
    getWebApp()?.MainButton.hide();
  },
  setEnabled(enabled: boolean): void {
    const webApp = getWebApp();
    if (!webApp) {
      return;
    }
    if (enabled) {
      webApp.MainButton.enable();
    } else {
      webApp.MainButton.disable();
    }
  },
};

let currentBackHandler: (() => void) | null = null;

/** Wires `handler` as the BackButton's click handler, unwiring whatever
 * handler a previous screen left in place first. `null` hides the button and
 * unwires without wiring a new one — the shape a screen change needs.
 */
export function setBackButtonHandler(handler: (() => void) | null): void {
  const webApp = getWebApp();
  if (!webApp) {
    return;
  }
  if (currentBackHandler) {
    webApp.BackButton.offClick(currentBackHandler);
  }
  currentBackHandler = handler;
  if (handler) {
    webApp.BackButton.onClick(handler);
    webApp.BackButton.show();
  } else {
    webApp.BackButton.hide();
  }
}

export const haptics = {
  impact(style: "light" | "medium" | "heavy" | "rigid" | "soft" = "medium"): void {
    getWebApp()?.HapticFeedback.impactOccurred(style);
  },
  notification(type: "error" | "success" | "warning"): void {
    getWebApp()?.HapticFeedback.notificationOccurred(type);
  },
  selection(): void {
    getWebApp()?.HapticFeedback.selectionChanged();
  },
};

export interface ThemeTokens {
  appBackground: string;
  card: string;
  ink: string;
  inkSecondary: string;
  separator: string;
}

// Fixed brand colours from docs/design/mini-app-ux.md §6 — Telegram's
// colorScheme only selects which fixed set applies, its own theme colours are
// never used directly.
const LIGHT_TOKENS: ThemeTokens = {
  appBackground: "#EDF0EF",
  card: "#FFFFFF",
  ink: "#0E1416",
  inkSecondary: "#6C7679",
  separator: "#E4E8E7",
};

const DARK_TOKENS: ThemeTokens = {
  appBackground: "#101415",
  card: "#1C2123",
  ink: "#F1F5F4",
  inkSecondary: "#97A1A3",
  separator: "#272D2F",
};

const CSS_VAR_NAMES: Record<keyof ThemeTokens, string> = {
  appBackground: "--app-background",
  card: "--card",
  ink: "--ink",
  inkSecondary: "--ink-secondary",
  separator: "--separator",
};

export function resolveThemeTokens(colorScheme: "light" | "dark"): ThemeTokens {
  return colorScheme === "dark" ? DARK_TOKENS : LIGHT_TOKENS;
}

/** Reads the current colour scheme from Telegram and applies the matching
 * token set as CSS custom properties on the document root. No-ops when
 * Telegram or the DOM is unavailable (mirrors main.ts's `document` guard).
 */
export function applyTheme(): void {
  const webApp = getWebApp();
  const colorScheme = webApp?.colorScheme ?? "light";
  const tokens = resolveThemeTokens(colorScheme);
  if (typeof document === "undefined") {
    return;
  }
  const root = document.documentElement;
  root.dataset.theme = colorScheme;
  for (const key of Object.keys(tokens) as (keyof ThemeTokens)[]) {
    root.style.setProperty(CSS_VAR_NAMES[key], tokens[key]);
  }
}
