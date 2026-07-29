/** Minor-unit (kopeck/cent) amount parsing and formatting — the only place
 * this app does money arithmetic. Mirrors
 * `bot/handlers/expenses.py::parse_amount_to_minor_units` so both clients
 * accept/reject the same input.
 */

export function parseAmount(input: string): number | null {
  const cleaned = input
    .trim()
    .replace(/\s+/g, "")
    .replace(/,/g, ".");

  if ((cleaned.match(/\./g) ?? []).length > 1) {
    return null;
  }
  if (!/^\d+(\.\d+)?$/.test(cleaned)) {
    return null;
  }

  const [intStr, fracStr = ""] = cleaned.split(".");
  const isZero = /^0+$/.test(intStr) && (fracStr === "" || /^0+$/.test(fracStr));
  if (isZero) {
    return null;
  }

  // Round the fractional part to cents (ROUND_HALF_UP) on the decimal string
  // itself — multiplying the parsed float by 100 loses precision at exactly
  // the half-cent boundary (e.g. 1.005 * 100 === 100.49999999999999 in IEEE
  // 754), which would silently disagree with the bot's Decimal-based parser.
  const twoDigits = (fracStr + "00").slice(0, 2);
  const roundUpDigit = fracStr.length > 2 ? fracStr[2] : "0";
  let cents = Number(twoDigits) + (roundUpDigit >= "5" ? 1 : 0);
  let whole = Number(intStr);
  if (cents === 100) {
    cents = 0;
    whole += 1;
  }

  return whole * 100 + cents;
}

export function formatAmount(minor: number): string {
  const sign = minor < 0 ? "-" : "";
  const abs = Math.abs(minor);
  const whole = Math.trunc(abs / 100);
  const cents = abs % 100;
  return `${sign}${whole}.${String(cents).padStart(2, "0")}`;
}
