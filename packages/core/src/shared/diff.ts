import type { FieldChange } from './event'

// OQ-2 — the before/after diff, computed in the DOMAIN, where both states are already in hand.
// Pure: (previous, next, the fields that may change) → the ones that actually did.
//
// Doing this here rather than in each decider means the Audit Log's "eski değer → yeni değer" is
// produced by ONE piece of code. A hand-written `if (a.name !== b.name)` list in eleven deciders
// is eleven chances to forget the field that mattered.
export function diffFields<T extends object>(
  previous: T,
  next: T,
  fields: readonly (keyof T & string)[],
): readonly FieldChange[] {
  const out: FieldChange[] = []
  for (const field of fields) {
    const from = previous[field]
    const to = next[field]
    if (!same(from, to)) out.push({ field, from, to })
  }
  return out
}

export const changedFieldNames = (changes: readonly FieldChange[]): readonly string[] =>
  changes.map((c) => c.field)

// Structural equality for the small values a domain field holds (scalars, and the odd string
// array such as a product's eligible services). Deliberately not a deep-equal library: a field
// whose value needs one is a field that should not be diffed field-wise.
function same(a: unknown, b: unknown): boolean {
  if (a === b) return true
  if (Array.isArray(a) && Array.isArray(b)) {
    return a.length === b.length && a.every((v, i) => v === b[i])
  }
  return false
}
