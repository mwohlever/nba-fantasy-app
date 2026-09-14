export type GolfMoney = string | number;

/**
 * Monetary values cross APIs as fixed-decimal strings. Convert them to cents
 * before doing client-side Salary Cap arithmetic; never compare JS floats.
 */
export function golfMoneyToCents(value: unknown): number | null {
  const text = typeof value === "number" && Number.isFinite(value) ? String(value) : typeof value === "string" ? value : null;
  if (text === null || !/^\d+(?:\.\d{1,2})?$/.test(text)) return null;
  const [whole, fraction = ""] = text.split(".");
  const cents = Number(whole) * 100 + Number((fraction + "00").slice(0, 2));
  return Number.isSafeInteger(cents) ? cents : null;
}

export function formatGolfMoney(value: GolfMoney): string {
  const cents = golfMoneyToCents(value);
  if (cents === null) throw new Error("Invalid Golf money value");
  return `${Math.floor(cents / 100)}.${String(cents % 100).padStart(2, "0")}`;
}

export function golfCentsToMoney(cents: number): string {
  if (!Number.isSafeInteger(cents) || cents < 0) throw new Error("Invalid Golf cents value");
  return `${Math.floor(cents / 100)}.${String(cents % 100).padStart(2, "0")}`;
}
