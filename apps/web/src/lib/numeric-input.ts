/*
 * The text ↔ number rules behind components/ui/number-input.tsx. Pure, so they are tested
 * without a DOM (numeric-input.test.ts).
 *
 * Three formats:
 *   integer   digits only
 *   decimal   one separator, "," or "." — both mean decimal (kg, cm, %: "65.5" is 65.5)
 *   money     Turkish TL: "." is a THOUSANDS separator and is dropped, "," is the decimal
 *             separator, at most 2 decimals. "1.500" is 1500 TL, "12,50" is 12.50 TL.
 *
 * The canonical string a parent holds uses "." as its only decimal separator ("12.5"), so
 * `Number(value)` stays correct everywhere. Money is DISPLAYED with "," ("12,5"): a pre-filled 12.5
 * shown as "12.5" would lose its "." on the next keystroke and silently become 125.
 *
 * Negative numbers are not accepted: no numeric field in the panel takes one.
 */

export type NumericFormat = "integer" | "decimal" | "money"

export const MONEY_DECIMALS = 2

/** What the user typed (or pasted) → canonical: digits plus at most one ".". */
export function sanitizeNumeric(raw: string, format: NumericFormat = "integer"): string {
  let out = ""
  let seenSeparator = false
  let decimals = 0
  for (const ch of raw) {
    if (ch >= "0" && ch <= "9") {
      if (format === "money" && seenSeparator) {
        if (decimals >= MONEY_DECIMALS) continue
        decimals += 1
      }
      out += ch
    } else if (seenSeparator || format === "integer") {
      continue
    } else if (format === "decimal" && (ch === "," || ch === ".")) {
      out += "."
      seenSeparator = true
    } else if (format === "money" && ch === ",") {
      out += "."
      seenSeparator = true
    }
  }
  return out
}

/** Canonical → what the box shows. Money shows its decimal separator as ",". */
export function displayNumeric(canonical: string, format: NumericFormat = "integer"): string {
  return format === "money" ? canonical.replace(".", ",") : canonical
}

/** `null` for an empty (or separator-only) canonical string. */
export function parseNumeric(canonical: string): number | null {
  if (canonical === "" || canonical === ".") return null
  const n = Number(canonical)
  return Number.isFinite(n) ? n : null
}
