/** Date rendering in the family's timezone, never the device's — the
 * direct lesson of D120 (a client computing its own date/period math in the
 * wrong timezone). The only place this app turns an ISO timestamp into a
 * displayed day.
 */

export function formatDay(iso: string, tz: string): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    weekday: "short",
    month: "short",
    day: "numeric",
  }).format(new Date(iso));
}
