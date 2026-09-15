import { describe, expect, it } from "vitest"

import { displayNumeric, parseNumeric, sanitizeNumeric } from "./numeric-input"

describe("sanitizeNumeric — money (TL)", () => {
  it.each([
    ["1.500", "1500"], // Turkish thousands separator — NOT 1.5 TL
    ["1.500.000", "1500000"],
    ["12,50", "12.50"],
    ["12,5", "12.5"],
    ["1.500,75", "1500.75"],
    ["12,999", "12.99"], // at most 2 decimals
    ["12,5,0", "12.50"], // a second "," is ignored
    ["₺ 9 000", "9000"],
    ["", ""],
    [",", "."],
  ])("%s → %s", (raw, canonical) => {
    expect(sanitizeNumeric(raw, "money")).toBe(canonical)
  })

  it("editing a pre-filled decimal value never multiplies it", () => {
    // State holds "12.5"; the box shows "12,5"; the user types a trailing 0.
    const shown = displayNumeric("12.5", "money")
    expect(shown).toBe("12,5")
    expect(sanitizeNumeric(shown + "0", "money")).toBe("12.50")
    // Deleting the last digit leaves "12," → 12, never 125.
    expect(parseNumeric(sanitizeNumeric("12,", "money"))).toBe(12)
  })

  it("a whole amount round-trips untouched", () => {
    expect(displayNumeric("5850", "money")).toBe("5850")
    expect(sanitizeNumeric(displayNumeric("5850", "money") + "1", "money")).toBe("58501")
  })
})

describe("sanitizeNumeric — decimal (kg, cm, %)", () => {
  it.each([
    ["65.5", "65.5"],
    ["65,5", "65.5"],
    ["65.5.1", "65.51"],
    ["abc7", "7"],
  ])("%s → %s", (raw, canonical) => {
    expect(sanitizeNumeric(raw, "decimal")).toBe(canonical)
    expect(displayNumeric(canonical, "decimal")).toBe(canonical)
  })
})

describe("sanitizeNumeric — integer", () => {
  it.each([
    ["30", "30"],
    ["1.5", "15"],
    ["-3", "3"],
    ["", ""],
  ])("%s → %s", (raw, canonical) => {
    expect(sanitizeNumeric(raw, "integer")).toBe(canonical)
  })
})

describe("parseNumeric", () => {
  it("empty is null, not 0", () => {
    expect(parseNumeric("")).toBeNull()
    expect(parseNumeric(".")).toBeNull()
  })
  it("reads canonical strings", () => {
    expect(parseNumeric("0")).toBe(0)
    expect(parseNumeric("1500.75")).toBe(1500.75)
  })
})
