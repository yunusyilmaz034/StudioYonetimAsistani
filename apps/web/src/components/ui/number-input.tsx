"use client"

import * as React from "react"

import { Input } from "@/components/ui/input"

/*
 * Numeric fields are plain text boxes (owner, 2026-09-15).
 *
 * Native number inputs brought two things nobody wanted: spinner arrows (and wheel/arrow-key
 * increments that silently change a price or a capacity), and — combined with the per-keystroke
 * `Math.max(1, Number(v) || 1)` clamps the call sites used — a field whose first digit could never
 * be deleted: clearing it snapped straight back to 1.
 *
 * These inputs let the user type and fully clear the value while editing. Only digits (and, with
 * `decimal`, a single separator — "," or ".", stored as ".") get in. Limits are applied when the
 * field is left, never while typing.
 *
 * Three shapes, so a call site keeps the state type it already had:
 *   NumericTextInput     value: string          — no clamping; the submit handler validates
 *   NumberInput          value: number          — empty/out-of-range → clamped on blur
 *   OptionalNumberInput  value: number | null   — empty = null (e.g. "Sınırsız"), stays empty
 *
 * Negative numbers are not accepted: no numeric field in the panel takes one.
 */

type BaseProps = Omit<
  React.ComponentProps<typeof Input>,
  "type" | "value" | "defaultValue" | "onChange" | "inputMode" | "min" | "max" | "step"
> & {
  /** Allow one decimal separator ("," or "."; normalised to "."). Integers only otherwise. */
  decimal?: boolean
}

/** Keeps digits and — when `decimal` — the first separator, normalised to ".". */
export function sanitizeNumeric(raw: string, decimal = false): string {
  let out = ""
  let seenSeparator = false
  for (const ch of raw) {
    if (ch >= "0" && ch <= "9") {
      out += ch
    } else if (decimal && !seenSeparator && (ch === "," || ch === ".")) {
      out += "."
      seenSeparator = true
    }
  }
  return out
}

/** `null` for an empty (or separator-only) draft. */
export function parseNumeric(draft: string): number | null {
  if (draft === "" || draft === ".") return null
  const n = Number(draft)
  return Number.isFinite(n) ? n : null
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
  decimal = false,
  ...props
}: BaseProps & { value: string; onValueChange: (value: string) => void }) {
  return (
    <Input
      type="text"
      inputMode={decimal ? "decimal" : "numeric"}
      autoComplete="off"
      {...props}
      value={value}
      onChange={(e) => onValueChange(sanitizeNumeric(e.target.value, decimal))}
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
  decimal = false,
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
  // `null` = not editing: the box shows the parent's value. While editing it shows the raw draft,
  // so "" and "0" can sit in the box even when the committed value is clamped to 1.
  const [draft, setDraft] = React.useState<string | null>(null)
  const commit = (raw: string): number => {
    const n = parseNumeric(raw)
    return clamp(n ?? fallback ?? min ?? 0, min, max)
  }

  return (
    <Input
      type="text"
      inputMode={decimal ? "decimal" : "numeric"}
      autoComplete="off"
      {...props}
      value={draft ?? (Number.isFinite(value) ? String(value) : "")}
      onChange={(e) => {
        const next = sanitizeNumeric(e.target.value, decimal)
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
  decimal = false,
  onBlur,
  ...props
}: BaseProps &
  LimitProps & {
    value: number | null
    /** `null` when the box is empty; otherwise a clamped number. */
    onValueChange: (value: number | null) => void
  }) {
  const [draft, setDraft] = React.useState<string | null>(null)
  const commit = (raw: string): number | null => {
    const n = parseNumeric(raw)
    return n === null ? null : clamp(n, min, max)
  }

  return (
    <Input
      type="text"
      inputMode={decimal ? "decimal" : "numeric"}
      autoComplete="off"
      {...props}
      value={draft ?? (value === null ? "" : String(value))}
      onChange={(e) => {
        const next = sanitizeNumeric(e.target.value, decimal)
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
