import { ApiClient } from "./api/client";
import { applyTheme, getInitData } from "./lib/telegram";
import {
  applyHomeChrome,
  createMemoryCache,
  loadHome,
  mount as mountHome,
  type HomeHandlers,
} from "./screens/home";

const homeCache = createMemoryCache();

/** Boots the app onto `#app`. Guarded the same way every DOM-touching export
 * in this codebase is (main.ts's own original placeholder, lib/telegram.ts's
 * applyTheme) so importing this module under the vitest `node` environment
 * never throws. */
export async function boot(): Promise<void> {
  if (typeof document === "undefined") {
    return;
  }
  const root = document.getElementById("app");
  if (!root) {
    return;
  }

  applyTheme();

  const handlers: HomeHandlers = {
    onRetry: () => {
      void boot();
    },
    onTileTap: () => {
      // Screens 03-07 (Expenses/Budgets/Statistics/Categories/Tags) land in
      // later units (U2.2-U2.5, M3). Tiles are reachable — tappable, haptic-
      // confirmed — but have nowhere to navigate to yet.
    },
    onSegmentTap: () => {
      // Filtered expense list lands with U2.3.
    },
  };

  // Mount the loading skeleton synchronously, before the fetch — otherwise
  // #app stays blank until loadHome() resolves and the AC's "loading
  // skeleton occupies the final layout" state never actually reaches the
  // screen (review finding on U2.1).
  applyHomeChrome({ status: "loading" });
  mountHome(root, { status: "loading" }, handlers);

  const client = new ApiClient({ getInitData });
  const state = await loadHome(client, homeCache);
  applyHomeChrome(state);
  mountHome(root, state, handlers);
}

if (typeof document !== "undefined") {
  void boot();
}
