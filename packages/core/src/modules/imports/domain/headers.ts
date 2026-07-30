// Header matching for the import wizard.
//
// The BulutGym adapter (`members/domain/import-csv.ts`) has its own copy of this folding. That is
// deliberate, not an oversight: that file is frozen vendor-specific code for ONE customer's export
// (Doc 1 §16), and the wizard exists precisely so the next customer does not need a second one. They
// should be free to diverge — this one will grow as real files arrive, and the adapter must not
// change behaviour when it does.

/**
 * A header folded to bare ASCII letters: Turkish-locale lower-case, accents mapped to their Latin
 * base, everything else dropped. `"Üye / Müşteri"` → `uyemusteri`, `"Ad Soyad"` → `adsoyad`.
 *
 * The `İ`/`I` handling comes first and on purpose: JavaScript's `toLowerCase()` turns `I` into `i`
 * and `İ` into `i̇` (an i with a combining dot), so a Turkish header that looks identical to a human
 * folds to two different strings. Mapping both to `i` before lower-casing is what makes "İSİM" and
 * "isim" the same column.
 */
export function foldHeader(h: string): string {
  return h
    .trim()
    .replace(/İ/g, 'i')
    .replace(/I/g, 'i')
    .toLowerCase()
    .replace(/ı/g, 'i')
    .replace(/ş/g, 's')
    .replace(/ğ/g, 'g')
    .replace(/ü/g, 'u')
    .replace(/ö/g, 'o')
    .replace(/ç/g, 'c')
    .replace(/[^a-z0-9]/g, '')
}

/** One field the wizard can fill, and the headings a file might call it. */
export interface FieldSpec {
  readonly key: string
  /** Turkish label shown on the mapping screen. */
  readonly label: string
  readonly required: boolean
  /** Folded header names that mean this field. Order is preference. */
  readonly aliases: readonly string[]
  /** Shown under the field on the "fill the gaps" step. */
  readonly hint?: string
}

/**
 * Pre-fill the mapping by matching folded headers against each field's aliases.
 *
 * A SUGGESTION, never a decision: the operator sees every arrow and can change any of them. A wizard
 * that silently guessed and imported would produce exactly the failure the mapping screen exists to
 * prevent — forty-five records with a phone number in the name field, and nobody watching.
 *
 * Two fields never claim the same column. Earlier fields in `fields` win, so a file with both
 * "Ad Soyad" and "Ad" maps the full-name field first and leaves the other unmapped rather than
 * splitting one column across two meanings.
 */
export function suggestMapping(
  header: readonly string[],
  fields: readonly FieldSpec[],
): Record<string, number | null> {
  const folded = header.map(foldHeader)
  const taken = new Set<number>()
  const out: Record<string, number | null> = {}

  for (const field of fields) {
    let found: number | null = null
    for (const alias of field.aliases) {
      const at = folded.indexOf(alias)
      if (at >= 0 && !taken.has(at)) {
        found = at
        break
      }
    }
    if (found !== null) taken.add(found)
    out[field.key] = found
  }
  return out
}

/**
 * The cell for a field: the mapped column, or the operator's manual default when nothing was mapped.
 *
 * Whitespace is trimmed and the non-breaking space is folded to an ordinary one — spreadsheets are
 * full of both, and a name that ends in U+00A0 is a name that never matches anything.
 */
export function cellFor(
  row: readonly string[],
  mapping: Readonly<Record<string, number | null>>,
  defaults: Readonly<Record<string, string>>,
  key: string,
): string {
  const at = mapping[key]
  const raw = at != null ? (row[at] ?? '') : (defaults[key] ?? '')
  return raw.replace(/\u00a0/g, ' ').trim()
}

/**
 * Fold a PACKAGE label. Same folding as a header, and it **keeps digits** — which is the whole
 * reason it is not `foldName`.
 *
 * `foldName`, built for people, strips everything that is not a letter. Under it
 * `Reformer Pilates - 8 Ders` and `… 16 Ders` become the same key, and so do `6 AY` and `3 AY`; the
 * lookup would hold whichever was written last and hand out the wrong package. Caught by the alias
 * tests before it reached anyone (2026-07-30).
 */
export const foldLabel = (label: string): string => foldHeader(label)
