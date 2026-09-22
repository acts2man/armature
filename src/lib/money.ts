/**
 * Money is stored in whole cents and entered in dollars. Pure module.
 */

const dollars = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
const dollarsExact = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** "$320" for whole dollars, "$18.50" when there are cents. */
export function formatCents(cents: number | null | undefined): string {
  if (cents === null || cents === undefined || Number.isNaN(cents)) return "—";
  return cents % 100 === 0 ? dollars.format(cents / 100) : dollarsExact.format(cents / 100);
}

/** Cents → the text shown in a dollars input: "320" or "18.50". Empty for null. */
export function centsToInput(cents: number | null | undefined): string {
  if (cents === null || cents === undefined) return "";
  return cents % 100 === 0 ? String(cents / 100) : (cents / 100).toFixed(2);
}

/**
 * Dollars typed by a person → cents, or null for an empty field. Accepts "$1,200",
 * "1200", "18.5". Returns undefined when the text is not a number.
 */
export function inputToCents(text: string): number | null | undefined {
  const clean = text.replace(/[$,\s]/g, "");
  if (clean === "") return null;
  if (!/^\d+(\.\d{0,2})?$/.test(clean)) return undefined;
  return Math.round(Number(clean) * 100);
}
