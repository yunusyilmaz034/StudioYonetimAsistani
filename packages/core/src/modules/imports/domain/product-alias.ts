import type { ProductId } from '../../../shared'
import { foldLabel } from './headers'
import type { ProductCandidate } from './types'

// THE FILE'S PACKAGE NAMES ARE NOT OUR PACKAGE NAMES (owner, 2026-07-30).
//
// The studio's real export says `6 AY`, `3 AY`, `1 AY`, `2 AY`, `3AY`. Those are not catalogue
// names and never will be — the old system stored a duration, not a product. Demanding an exact
// match rejected all one hundred rows and left the owner retyping a spreadsheet, which is the
// opposite of what an import is for.
//
// So the wizard asks, once per DISTINCT label, exactly the way it asks about columns: here is what
// your file says, here is what we have, draw the line between them. Five labels, five answers, a
// hundred rows imported.
//
// ── Why this proposes and does not decide ───────────────────────────────────────────────────
//
// A wrong product is a right in the wrong CATEGORY — a pilates credit that opens the gym — and the
// category wall is the one thing the UI cannot repair afterwards. `6 AY` looks obvious only because
// the owner knows every row in that file is fitness; the label itself does not say so, and a studio
// with both a six-month fitness membership and a six-month pilates package would be one careless
// default away from a mess nobody notices for weeks.
//
// The suggestion below is deliberately narrow: it reads a NUMBER and a UNIT out of the label and
// offers products whose shape matches. It never guesses a category.

export interface ProductSuggestion {
  readonly productId: ProductId
  readonly name: string
  /** Shown next to the proposal, because a proposal without a reason is noise. */
  readonly reason: 'same_duration' | 'same_credits'
}

/** What the catalogue exposes for suggesting: enough shape to compare, no more. */
export interface ProductShape extends ProductCandidate {
  readonly durationDays: number
  readonly creditCount: number | null
}

const MONTHS = /(\d+)\s*ay/i
const CLASSES = /(\d+)\s*(ders|seans)/i

/**
 * Products that plausibly mean `label`, best first. Empty when nothing does.
 *
 * `6 AY` → every product lasting about six months. `8 DERS` → every credit product granting eight.
 * A month is treated as 30 days with a week of slack either side, because a studio's "3 aylık" is
 * 90 days in one catalogue and 92 in another and neither is wrong.
 */
export function suggestProducts(label: string, products: readonly ProductShape[]): readonly ProductSuggestion[] {
  const months = MONTHS.exec(label)
  const classes = CLASSES.exec(label)

  if (months) {
    const want = Number(months[1]) * 30
    return products
      .filter((p) => Math.abs(p.durationDays - want) <= 7)
      .map((p) => ({ productId: p.productId, name: p.name, reason: 'same_duration' as const }))
  }

  if (classes) {
    const want = Number(classes[1])
    return products
      .filter((p) => p.creditCount === want)
      .map((p) => ({ productId: p.productId, name: p.name, reason: 'same_credits' as const }))
  }

  return []
}

/**
 * The distinct labels a file uses that the catalogue does not know, with how many rows each covers.
 *
 * Counted so the operator can see what a decision is worth: a label on sixty rows deserves more
 * care than one on a single row she can also just skip.
 */
export function unknownLabels(
  labels: readonly string[],
  products: readonly ProductCandidate[],
  aliases: Readonly<Record<string, string>>,
): readonly { readonly label: string; readonly rows: number }[] {
  const known = new Set(products.map((p) => foldLabel(p.name)))
  const counts = new Map<string, number>()
  for (const raw of labels) {
    const folded = foldLabel(raw)
    if (!folded || known.has(folded) || aliases[folded]) continue
    counts.set(raw, (counts.get(raw) ?? 0) + 1)
  }
  return [...counts.entries()]
    .map(([label, rows]) => ({ label, rows }))
    .sort((a, b) => b.rows - a.rows)
}

/** Fold an alias table's keys so lookup survives case, punctuation and Turkish letters. */
export function foldAliases(aliases: Readonly<Record<string, string>>): Record<string, ProductId> {
  const out: Record<string, ProductId> = {}
  for (const [label, productId] of Object.entries(aliases)) {
    if (productId) out[foldLabel(label)] = productId as ProductId
  }
  return out
}
