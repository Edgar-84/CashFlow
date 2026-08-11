// @vitest-environment jsdom
//
// Per-file opt-in (U0.5/D603): `showToast`'s whole behaviour is DOM glue
// (append, tap-to-dismiss, auto-dismiss, replace rather than stack, remove),
// so unlike most component tests in this suite this file needs a real DOM.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../src/lib/telegram", () => ({
  mainButton: { onClick: vi.fn(), offClick: vi.fn(), show: vi.fn(), hide: vi.fn(), setEnabled: vi.fn() },
  setBackButtonHandler: vi.fn(),
  haptics: { selection: vi.fn(), impact: vi.fn(), notification: vi.fn() },
}));

import { mainButton, setBackButtonHandler, haptics } from "../src/lib/telegram";
import { renderToast, showToast, type ToastProps } from "../src/components/toast";

function props(overrides: Partial<ToastProps> = {}): ToastProps {
  return { message: "Groceries is at 82% — 82.00 of 100.00 EUR", kind: "warning", ...overrides };
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  vi.clearAllMocks();
  delete (window as { matchMedia?: unknown }).matchMedia;
});

describe("renderToast", () => {
  it("matches the spec's anatomy: role=status, aria-live=polite, the escaped message text", () => {
    const html = renderToast(props({ message: "Groceries is over budget by 12.00 <EUR>" }));
    expect(html).toContain('role="status"');
    expect(html).toContain('aria-live="polite"');
    expect(html).toContain("Groceries is over budget by 12.00 &lt;EUR&gt;");
    expect(html).not.toContain("<EUR>");
  });

  it("renders no close button — the whole root is the dismiss target", () => {
    const html = renderToast(props());
    expect(html).not.toContain("<button");
  });
});

describe("showToast — mount, dismissal and replacement", () => {
  function host(): HTMLElement {
    return document.createElement("div");
  }

  it("appends its own root to the host and is not focusable", () => {
    const h = host();
    showToast(h, props());
    const root = h.querySelector('[data-testid="toast"]')!;
    expect(root).not.toBeNull();
    expect(root.tagName).toBe("DIV");
    expect(root.hasAttribute("tabindex")).toBe(false);
  });

  it("installs no BackButton or MainButton handler and fires no haptic of its own", () => {
    const h = host();
    const dismiss = showToast(h, props());
    h.querySelector('[data-testid="toast"]')!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    dismiss();
    vi.advanceTimersByTime(200);

    expect(mainButton.onClick).not.toHaveBeenCalled();
    expect(mainButton.setEnabled).not.toHaveBeenCalled();
    expect(setBackButtonHandler).not.toHaveBeenCalled();
    expect(haptics.selection).not.toHaveBeenCalled();
    expect(haptics.impact).not.toHaveBeenCalled();
    expect(haptics.notification).not.toHaveBeenCalled();
  });

  it("a tap dismisses immediately and the node is gone once the leave animation elapses", () => {
    const h = host();
    showToast(h, props());
    const root = h.querySelector('[data-testid="toast"]')!;

    root.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(root.classList.contains("toast-leaving")).toBe(true);
    expect(h.querySelector('[data-testid="toast"]')).not.toBeNull(); // still there mid-fade

    vi.advanceTimersByTime(160);
    expect(h.querySelector('[data-testid="toast"]')).toBeNull();
  });

  it("auto-dismisses after the default 5s dwell", () => {
    const h = host();
    showToast(h, props());

    vi.advanceTimersByTime(4999);
    expect(h.querySelector('[data-testid="toast"]')).not.toBeNull();

    vi.advanceTimersByTime(1 + 160);
    expect(h.querySelector('[data-testid="toast"]')).toBeNull();
  });

  it("autoDismissMs: null never auto-dismisses", () => {
    const h = host();
    showToast(h, props({ autoDismissMs: null }));

    vi.advanceTimersByTime(60_000);
    expect(h.querySelector('[data-testid="toast"]')).not.toBeNull();
  });

  it("a custom autoDismissMs is honoured", () => {
    const h = host();
    showToast(h, props({ autoDismissMs: 1000 }));

    vi.advanceTimersByTime(999);
    expect(h.querySelector('[data-testid="toast"]')).not.toBeNull();

    vi.advanceTimersByTime(1 + 160);
    expect(h.querySelector('[data-testid="toast"]')).toBeNull();
  });

  it("the returned dismiss function is idempotent — calling it twice does not throw", () => {
    const h = host();
    const dismiss = showToast(h, props());

    expect(() => {
      dismiss();
      dismiss();
      vi.advanceTimersByTime(160);
      dismiss();
    }).not.toThrow();
    expect(h.querySelector('[data-testid="toast"]')).toBeNull();
  });

  it("dismissing after auto-dismiss has already fired is a no-op, not a throw", () => {
    const h = host();
    const dismiss = showToast(h, props());

    vi.advanceTimersByTime(5000 + 160);
    expect(() => dismiss()).not.toThrow();
  });

  it("a second showToast while one is up replaces it immediately, without a leave animation, rather than stacking", () => {
    const h = host();
    const firstDismiss = showToast(h, props({ message: "first" }));
    const firstRoot = h.querySelector('[data-testid="toast"]')!;

    showToast(h, props({ message: "second" }));

    expect(h.querySelectorAll('[data-testid="toast"]').length).toBe(1);
    expect(firstRoot.classList.contains("toast-leaving")).toBe(false); // no leave animation
    expect(h.querySelector('[data-testid="toast"] .toast-message')?.textContent).toBe("second");

    // The first toast's own dismiss handle and dwell timer are dead, not just
    // hidden — advancing past what would have been its 5s dwell (but short of
    // the second toast's own, freshly-started one) must not remove anything.
    expect(() => firstDismiss()).not.toThrow();
    vi.advanceTimersByTime(4000);
    expect(h.querySelectorAll('[data-testid="toast"]').length).toBe(1);
  });

  it("a second showToast while the first is mid-leave-animation removes it instantly instead of leaving both up", () => {
    const h = host();
    showToast(h, props({ message: "first" }));
    const firstRoot = h.querySelector('[data-testid="toast"]')!;

    firstRoot.dispatchEvent(new MouseEvent("click", { bubbles: true })); // starts the 160ms fade
    expect(firstRoot.classList.contains("toast-leaving")).toBe(true);

    showToast(h, props({ message: "second" })); // must force the fading node out now, not after 160ms

    expect(h.querySelectorAll('[data-testid="toast"]').length).toBe(1);
    expect(h.querySelector('[data-testid="toast"] .toast-message')?.textContent).toBe("second");

    vi.advanceTimersByTime(160); // the dead leave-timer, if it fired, must not touch anything
    expect(h.querySelectorAll('[data-testid="toast"]').length).toBe(1);
  });

  it("prefers-reduced-motion: reduce dismisses instantly, with no leave-animation wait", () => {
    (window as { matchMedia: (query: string) => MediaQueryList }).matchMedia = vi
      .fn()
      .mockReturnValue({ matches: true } as MediaQueryList);
    const h = host();
    const dismiss = showToast(h, props());

    dismiss();

    expect(h.querySelector('[data-testid="toast"]')).toBeNull();
  });
});
