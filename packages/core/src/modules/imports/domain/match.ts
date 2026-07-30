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
  readonly reason: 'exact_name' | 'same_surname_and_first_name' | 'same_surname_and_initial'
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

  for (const m of existing) {
    const have = parts(m.fullName)
    if (have.length === 0) continue
    if (have.join(' ') === wantJoined) {
      exact.push({ memberId: m.memberId, fullName: m.fullName, reason: 'exact_name' })
      continue
    }
    if (have[have.length - 1] !== surname) continue
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

  const candidates = [...exact, ...sameFirstName, ...sameInitial]
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
