import type { MemberId } from '../../../shared'

// WHOSE PACKAGE IS THIS? (owner, 2026-07-30)
//
// The file says "AYŞE YILMAZ, Reformer 8 Ders, 5 kalan". Two questions follow, and only the first
// one has a safe answer.
//
// **By phone: certain.** A phone is unique in this studio by construction (AD-40 — collisions are
// reported, never merged). A match on the normalised number IS the member, and the wizard attaches
// the package without asking.
//
// **By name: a guess, and it stays a guess.** Two members can share a name; this studio already has
// near-collisions. A wrong attachment gives one woman another woman's classes, and nobody discovers
// it until the second woman is turned away at the door for credits she never spent. So a name match
// is a PROPOSAL: it is shown with the reason it was proposed, and an operator confirms it one by
// one. Nothing here can attach a package on its own.
//
// The owner's instruction was already this shape — *"bu bunun aboneliği olabilir mi diye eşleştirsin"*.
// This file only makes it impossible to loosen later.

/** A member already in the system, reduced to what matching needs. No other field is read. */
export interface MatchCandidate {
  readonly memberId: MemberId
  readonly fullName: string
  /** Digits-only E.164 without the plus — the uniqueness key (`905321234567`). */
  readonly phoneNormalized: string
}

export type MatchOutcome =
  /** A phone hit. Certain, applied without asking. */
  | { readonly kind: 'phone'; readonly memberId: MemberId }
  /** Name proposals, best first. NEVER applied without confirmation. */
  | { readonly kind: 'proposal'; readonly candidates: readonly NameProposal[] }
  /** Nothing plausible. The row becomes a new member the operator completes. */
  | { readonly kind: 'none' }

export interface NameProposal {
  readonly memberId: MemberId
  readonly fullName: string
  /** Why this was proposed — shown to the operator, because a proposal without a reason is noise. */
  readonly reason:
    | 'exact_name'
    | 'same_surname_and_first_name'
    | 'same_surname_and_initial'
    | 'near_spelling'
}

/**
 * Fold a person's name for comparison: Turkish-locale lower-case, accents to their Latin base,
 * runs of whitespace collapsed.
 *
 * `İ`/`I` are mapped BEFORE lower-casing for the same reason as in header folding: JavaScript turns
 * `İ` into an i-with-combining-dot, so "İREM" and "irem" would otherwise never compare equal — and
 * this is Turkey, where that is most names' first letter's problem.
 */
export function foldName(name: string): string {
  return name
    .replace(/\u00a0/g, ' ')
    .replace(/İ/g, 'i')
    .replace(/I/g, 'i')
    .toLowerCase()
    .replace(/ı/g, 'i')
    .replace(/ş/g, 's')
    .replace(/ğ/g, 'g')
    .replace(/ü/g, 'u')
    .replace(/ö/g, 'o')
    .replace(/ç/g, 'c')
    .replace(/[^a-z ]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

const parts = (name: string): readonly string[] => foldName(name).split(' ').filter(Boolean)

/**
 * Levenshtein distance, capped — we only ever ask "is this within two edits?".
 *
 * Two rows of integers rather than a full matrix: these are names, but the roster is compared
 * against every row of the file and there is no reason to allocate a matrix per pair.
 */
function editDistance(a: string, b: string, cap: number): number {
  if (Math.abs(a.length - b.length) > cap) return cap + 1
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i)
  for (let i = 1; i <= a.length; i++) {
    const row = [i]
    let best = i
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1
      const v = Math.min(prev[j]! + 1, row[j - 1]! + 1, prev[j - 1]! + cost)
      row.push(v)
      if (v < best) best = v
    }
    if (best > cap) return cap + 1 // no later row can come back under the cap
    prev = row
  }
  return prev[b.length]!
}

/**
 * A near-miss spelling: the same name with a typo in it.
 *
 * `ZÜHRE HİLAL KAŞ` in the file is `ZÜHRE HİLAL KUŞ` in the studio — one letter, and every tier
 * above this one misses it, because they all key on the SURNAME being right (owner, 2026-07-30).
 *
 * The allowance grows with the name, because that is how confident we are entitled to be:
 *
 *   under 8 letters  → nothing. At that length one edit is `KAR` and `KOR`, two different women.
 *   8 to 11 letters  → one edit.
 *   12 and above     → two, which is where a doubled letter and a swapped one both fit.
 *
 * It is the last tier and it only ever proposes, so being wrong costs a line in a list. Being
 * absent costs a member who quietly does not get imported.
 */
function isNearSpelling(a: string, b: string): boolean {
  const len = Math.max(a.length, b.length)
  if (len < 8) return false
  const cap = len >= 12 ? 2 : 1
  const d = editDistance(a, b, cap)
  return d > 0 && d <= cap
}

/**
 * Resolve one row against the existing members.
 *
 * `phoneNormalized` is null when the file has no phone column, or the cell could not be normalised —
 * a phone we could not read must never fall back to a name match dressed up as certainty.
 */
export function matchMember(
  phoneNormalized: string | null,
  fullName: string,
  existing: readonly MatchCandidate[],
): MatchOutcome {
  if (phoneNormalized) {
    const hit = existing.find((m) => m.phoneNormalized === phoneNormalized)
    if (hit) return { kind: 'phone', memberId: hit.memberId }
    // A phone that matches nobody is a NEW member. It is deliberately not softened into a name
    // search: the file gave us the unique key and it said "not her".
    return { kind: 'none' }
  }

  const want = parts(fullName)
  if (want.length === 0) return { kind: 'none' }
  const wantJoined = want.join(' ')
  const surname = want[want.length - 1]!
  const initial = want[0]![0]!

  const firstName = want[0]!

  // Three tiers, strongest first. The tiers exist because the weakest one is genuinely weak: in a
  // studio of 120 Turkish women, "same surname + same first initial" matches ARZU YILMAZ when you
  // are looking for AYŞE YILMAZ. That is not a bug — it is the right person to put in front of an
  // operator — but showing it ABOVE the woman whose first name actually matches would bury the
  // answer under the noise, and an operator scanning seventy rows clicks the first plausible line.
  const exact: NameProposal[] = []
  const sameFirstName: NameProposal[] = []
  const sameInitial: NameProposal[] = []
  const nearSpelling: NameProposal[] = []

  for (const m of existing) {
    const have = parts(m.fullName)
    if (have.length === 0) continue
    if (have.join(' ') === wantJoined) {
      exact.push({ memberId: m.memberId, fullName: m.fullName, reason: 'exact_name' })
      continue
    }
    if (have[have.length - 1] !== surname) {
      // Different surname — but a typo IS a different surname. `KAŞ` vs `KUŞ` reaches here and
      // every tier above would drop it on the floor.
      if (isNearSpelling(have.join(' '), wantJoined)) {
        nearSpelling.push({ memberId: m.memberId, fullName: m.fullName, reason: 'near_spelling' })
      }
      continue
    }
    // Same surname AND the same first name — a middle name only one of the two systems recorded.
    if (have[0] === firstName) {
      sameFirstName.push({ memberId: m.memberId, fullName: m.fullName, reason: 'same_surname_and_first_name' })
      continue
    }
    // Same surname and only the same first initial: "AYŞE YILMAZ" vs "A. YILMAZ" — but also vs
    // "ARZU YILMAZ". Offered last, never alone at the top.
    if (have[0]![0] === initial) {
      sameInitial.push({ memberId: m.memberId, fullName: m.fullName, reason: 'same_surname_and_initial' })
    }
  }

  const candidates = [...exact, ...sameFirstName, ...sameInitial, ...nearSpelling]
  return candidates.length > 0 ? { kind: 'proposal', candidates } : { kind: 'none' }
}

/**
 * True when a set of proposals is ambiguous — more than one member could be meant.
 *
 * The screen uses this to refuse a "hepsini onayla" shortcut on the rows that need a human most.
 * A single exact-name proposal is still a proposal, but bulk-confirming a row where two women share
 * a name is how the wrong one gets the package.
 */
export function isAmbiguous(outcome: MatchOutcome): boolean {
  return outcome.kind === 'proposal' && outcome.candidates.length > 1
}
