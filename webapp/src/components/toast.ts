/** Component: Toast (docs/ui/components/toast.md). A short, self-dismissing
 * message for one job only — a budget that reached its notify threshold
 * because of the expense the user just saved (D607/D608/D609). Pure render
 * + thin DOM glue, the same shape as every other file in this directory.
 * Not yet triggered by anything — `main.ts` wires it in U4.3.
 */

const DEFAULT_AUTO_DISMISS_MS = 5000;
const LEAVE_MS = 160;

export interface ToastProps {
  /** Pre-composed line; the component never formats money or a percentage. */
  message: string;
  kind: "warning";
  /** ms before auto-dismiss; `null` never auto-dismisses. Default 5000. */
  autoDismissMs?: number | null;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// Own copy of home.ts's warning glyph (triangle + bar + dot), scaled to this
// component's 16px — per-file inline SVG, matching category-picker.ts,
// color-picker.ts and period-selector.ts's existing convention (mini-app-v6
// plan, U4.1's STATE note) rather than importing home.ts's.
const WARNING_GLYPH_SVG =
  '<svg class="toast-glyph" width="16" height="16" viewBox="0 0 16 16" aria-hidden="true" focusable="false">' +
  '<path d="M8 1.5 14.9 14.1H1.1L8 1.5Z" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round" fill="none" />' +
  '<line x1="8" y1="5.9" x2="8" y2="9.6" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" />' +
  '<circle cx="8" cy="11.9" r="1" fill="currentColor" /></svg>';

/** Anatomy: root (`--ink` bg, `--card` text, no shadow) + glyph + message.
 * No close button — the whole root is the dismiss target (component doc:
 * "keeps one 44px-tall element from having to hold a second 44px control"). */
export function renderToast(props: ToastProps): string {
  return `<div class="toast-root" role="status" aria-live="polite" data-testid="toast" data-kind="${props.kind}">${WARNING_GLYPH_SVG}<span class="toast-message">${escapeHtml(props.message)}</span></div>`;
}

// -- mount (DOM glue) -------------------------------------------------------
//
// One toast up at a time per host (component doc's States: "Replaced" —
// never two at once, never a queue), tracked here rather than on the DOM
// itself so a replacement can force the previous one out immediately,
// without its leave animation — whether that previous toast's dwell timer is
// still pending *or* it is already mid-leave (tapped, or its own dwell just
// elapsed): `forceRemove` is what both `dismiss` and a replacement funnel
// through, and it stays the live entry in this map for as long as the node
// is still in the DOM, including during the 160ms fade.
const forceRemoveByHost = new WeakMap<HTMLElement, () => void>();

function prefersReducedMotion(): boolean {
  return typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/** Appends its own root to `host`, wires dismissal, and returns a dismiss
 * function. Never touches BackButton or MainButton and fires no haptic of
 * its own — a toast is not a dismissible *screen* (D607; component doc's
 * Telegram section). */
export function showToast(host: HTMLElement, props: ToastProps): () => void {
  forceRemoveByHost.get(host)?.();

  const autoDismissMs = props.autoDismissMs === undefined ? DEFAULT_AUTO_DISMISS_MS : props.autoDismissMs;
  host.insertAdjacentHTML("beforeend", renderToast(props));
  const root = host.lastElementChild as HTMLElement;

  let removed = false;
  let dismissing = false;
  let dwellTimer: ReturnType<typeof setTimeout> | null = null;
  let leaveTimer: ReturnType<typeof setTimeout> | null = null;

  const clearTimers = (): void => {
    if (dwellTimer !== null) {
      clearTimeout(dwellTimer);
      dwellTimer = null;
    }
    if (leaveTimer !== null) {
      clearTimeout(leaveTimer);
      leaveTimer = null;
    }
  };

  // The only path that actually removes the node — idempotent on `removed`
  // alone (not `dismissing`), so it still fires when called as a
  // replacement's force-out while a leave animation is mid-flight.
  const forceRemove = (): void => {
    if (removed) {
      return;
    }
    removed = true;
    clearTimers();
    forceRemoveByHost.delete(host);
    root.remove();
  };
  forceRemoveByHost.set(host, forceRemove);

  const dismiss = (): void => {
    if (removed || dismissing) {
      return;
    }
    dismissing = true;
    if (dwellTimer !== null) {
      clearTimeout(dwellTimer);
      dwellTimer = null;
    }
    if (prefersReducedMotion()) {
      // "appears and disappears instantly... a state change, not an
      // animation" (component doc's Accessibility section).
      forceRemove();
      return;
    }
    root.classList.add("toast-leaving");
    leaveTimer = setTimeout(forceRemove, LEAVE_MS);
  };

  root.addEventListener("click", dismiss);
  if (autoDismissMs !== null) {
    dwellTimer = setTimeout(dismiss, autoDismissMs);
  }

  return dismiss;
}
