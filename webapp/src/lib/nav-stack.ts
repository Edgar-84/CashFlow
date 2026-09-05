/** Pure navigation stack — no DOM, no Telegram, no fetching. `main.ts` owns
 * the single instance and decides what `push`/`replace`/`pop` mean for each
 * screen; this module only tracks the entries.
 */

export interface NavEntry {
  /** Which screen this entry re-mounts. Debug/testing identity only —
   *  never compared for equality by the stack itself. */
  screen: string;
  /** Re-mounts that screen exactly as it was entered. Called by `pop`'s
   *  caller, never by the stack. */
  restore: () => void;
}

export interface NavStack {
  /** Push a new entry on top. */
  push(entry: NavEntry): void;
  /** Replace the top entry (a same-screen re-render: a retry, a period
   *  change, a grouping toggle) — never grows the stack. */
  replace(entry: NavEntry): void;
  /** Drop the top entry and return the one beneath it, or `null` at the
   *  floor (Home). Does NOT call `restore`. */
  pop(): NavEntry | null;
  /** Empty the stack — Home is the floor and holds no entry. */
  reset(): void;
  /** For tests. Not currently consumed by `main.ts` — a rapid double-tap on
   *  BackButton popping two levels while the first pop's screen is still
   *  loading is ordinary back-stack semantics (the same behaviour a
   *  browser's own Back button has under a double-click), not a bug this
   *  needs to guard against (U2.2's review). */
  depth(): number;
  peek(): NavEntry | null;
}

export function createNavStack(): NavStack {
  const entries: NavEntry[] = [];

  return {
    push(entry: NavEntry): void {
      entries.push(entry);
    },

    replace(entry: NavEntry): void {
      if (entries.length === 0) {
        entries.push(entry);
        return;
      }
      entries[entries.length - 1] = entry;
    },

    pop(): NavEntry | null {
      if (entries.length === 0) {
        return null;
      }
      entries.pop();
      return entries.length === 0 ? null : entries[entries.length - 1];
    },

    reset(): void {
      entries.length = 0;
    },

    depth(): number {
      return entries.length;
    },

    peek(): NavEntry | null {
      return entries.length === 0 ? null : entries[entries.length - 1];
    },
  };
}
