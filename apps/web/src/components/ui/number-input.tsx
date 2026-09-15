"use client"

import * as React from "react"

import { Input } from "@/components/ui/input"
import { displayNumeric, parseNumeric, sanitizeNumeric, type NumericFormat } from "@/lib/numeric-input"

/*
 * Numeric fields are plain text boxes (owner, 2026-09-15).
 *
 * Native number inputs brought two things nobody wanted: spinner arrows (and wheel/arrow-key
 * increments that silently change a price or a capacity), and — combined with the per-keystroke
 * `Math.max(1, Number(v) || 1)` clamps the call sites used — a field whose first digit could never
 * be deleted: clearing it snapped straight back to 1.
 *
 * These inputs let the user type and fully clear the value while editing. Limits are applied when
 * the field is left, never while typing.
 *
 * Three shapes, so a call site keeps the state type it already had:
 *   NumericTextInput     value: string          — no clamping; the submit handler validates
 *   NumberInput          value: number          — empty/out-of-range → clamped on blur
 *   OptionalNumberInput  value: number | null   — empty = null (e.g. "Sınırsız"), stays empty
 *
 * Three formats:
 *   (default)  digits only
 *   decimal    one separator, "," or "." — both mean decimal (kg, cm, %: "65.5" is 65.5)
 *   money      Turkish TL: "." is a THOUSANDS separator and is dropped, "," is the decimal
 *              separator, at most 2 decimals. "1.500" is 1500 TL, "12,50" is 12.50 TL.
 *
 * Whatever the format, the parent only ever sees "." as the decimal separator ("12.5"), so
 * `Number(value)` stays correct. Money is DISPLAYED with "," ("12,5"): a pre-filled 12.5 shown as
 * "12.5" would lose its "." on the next keystroke and silently become 125.
 *
 * Negative numbers are not accepted: no numeric field in the panel takes one.
 */

type BaseProps = Omit<
  React.ComponentProps<typeof Input>,
  "type" | "value" | "defaultValue" | "onChange" | "inputMode" | "min" | "max" | "step"
> & {
  /** One decimal separator, "," or "." (normalised to "."). For non-money decimals: kg, cm, %. */
  decimal?: boolean | undefined
  /** Turkish TL: "." = thousands (dropped), "," = decimal, max 2 decimals. Wins over `decimal`. */
  money?: boolean | undefined
}

function formatOf(decimal: boolean | undefined, money: boolean | undefined): NumericFormat {
  return money ? "money" : decimal ? "decimal" : "integer"
}

function clamp(n: number, min: number | undefined, max: number | undefined): number {
  let out = n
  if (min !== undefined) out = Math.max(min, out)
  if (max !== undefined) out = Math.min(max, out)
  return out
}

function NumericTextInput({
  value,
  onValueChange,
  decimal,
  money,
  ...props
}: BaseProps & { value: string; onValueChange: (value: string) => void }) {
  const format = formatOf(decimal, money)
  return (
    <Input
      type="text"
      inputMode={format === "integer" ? "numeric" : "decimal"}
      autoComplete="off"
      {...props}
      value={displayNumeric(value, format)}
      onChange={(e) => onValueChange(sanitizeNumeric(e.target.value, format))}
    />
  )
}

type LimitProps = {
  min?: number | undefined
  max?: number | undefined
}

function NumberInput({
  value,
  onValueChange,
  min,
  max,
  fallback,
  decimal,
  money,
  onBlur,
  ...props
}: BaseProps &
  LimitProps & {
    value: number
    /** Always receives a valid, clamped number — also while the box is being edited. */
    onValueChange: (value: number) => void
    /** What an empty box commits to. Defaults to `min`, or 0. */
    fallback?: number | undefined
  }) {
  const format = formatOf(decimal, money)
  // `null` = not editing: the box shows the parent's value. While editing it shows the draft, so
  // "" and "0" can sit in the box even when the committed value is clamped to 1.
  const [draft, setDraft] = React.useState<string | null>(null)
  const commit = (canonical: string): number => {
    const n = parseNumeric(canonical)
    return clamp(n ?? fallback ?? min ?? 0, min, max)
  }

  return (
    <Input
      type="text"
      inputMode={format === "integer" ? "numeric" : "decimal"}
      autoComplete="off"
      {...props}
      value={displayNumeric(draft ?? (Number.isFinite(value) ? String(value) : ""), format)}
      onChange={(e) => {
        const next = sanitizeNumeric(e.target.value, format)
        setDraft(next)
        // The parent always holds a valid number, so a submit via Enter (no blur) is still safe.
        const n = commit(next)
        if (n !== value) onValueChange(n)
      }}
      onBlur={(e) => {
        if (draft !== null) {
          const n = commit(draft)
          if (n !== value) onValueChange(n)
          setDraft(null)
        }
        onBlur?.(e)
      }}
    />
  )
}

function OptionalNumberInput({
  value,
  onValueChange,
  min,
  max,
  decimal,
  money,
  onBlur,
  ...props
}: BaseProps &
  LimitProps & {
    value: number | null
    /** `null` when the box is empty; otherwise a clamped number. */
    onValueChange: (value: number | null) => void
  }) {
  const format = formatOf(decimal, money)
  const [draft, setDraft] = React.useState<string | null>(null)
  const commit = (canonical: string): number | null => {
    const n = parseNumeric(canonical)
    return n === null ? null : clamp(n, min, max)
  }

  return (
    <Input
      type="text"
      inputMode={format === "integer" ? "numeric" : "decimal"}
      autoComplete="off"
      {...props}
      value={displayNumeric(draft ?? (value === null ? "" : String(value)), format)}
      onChange={(e) => {
        const next = sanitizeNumeric(e.target.value, format)
        setDraft(next)
        const n = commit(next)
        if (n !== value) onValueChange(n)
      }}
      onBlur={(e) => {
        if (draft !== null) {
          const n = commit(draft)
          if (n !== value) onValueChange(n)
          setDraft(null)
        }
        onBlur?.(e)
      }}
    />
  )
}

export { NumberInput, NumericTextInput, OptionalNumberInput }
