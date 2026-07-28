import type { Category, Instant } from '../../../shared'
import { available, type Entitlement } from './types'

// WHEN A RENEWAL STARTS (owner decision, 2026-07-27).
//
// A member with twelve days left on her package buys the next one. If it starts today, twelve of the
// thirty days she just paid for burn while she is still using the old package: she pays for a month
// and gets eighteen days. Nobody notices until she does, and then she is right and the studio is
// wrong. The owner's decision: **sıraya alsın** — the new package begins when the one it renews ends.
//
// ── Queue behind WHAT, exactly ──────────────────────────────────────────────────────────────
//
// Only behind a package that is genuinely still useful to her, which is a narrower set than "active":
//
//   · SAME CATEGORY only. Fitness and Pilates run in parallel by design (the category wall means
//     neither can pay for the other's class), so a Pilates renewal must not wait behind a Fitness
//     membership. Three members hold both today.
//   · STILL SPENDABLE. A credit package with zero credits left and ten days on the clock is not
//     something to wait behind — she cannot book with it. Five members are in exactly that state, and
//     for them the new package starts today. This is the difference between "still valid" and "still
//     any use", and only the second one should make a renewal wait.
//
// ── Frozen packages are refused elsewhere, not queued here ──────────────────────────────────
//
// A frozen package's `validUntil` has NOT yet been extended — the extension is applied when it
// unfreezes, because at freeze time nobody knows how long the freeze will last. So while a package is
// frozen there is no honest answer to "when does it end", and any date computed here would be one we
// already know is wrong. The caller refuses the purchase instead and sends her to reception; see
// `blockedByFrozen`.

/** A package still worth waiting for: same category, running, and something left to spend. */
function blocksRenewal(e: Entitlement, category: Category, now: Instant): boolean {
  if (e.status !== 'active') return false
  if (e.productSnapshot.category !== category) return false
  if (e.validUntil <= now) return false
  // A period (unlimited) package has no counter — it is useful until the day it expires.
  if (e.credits === null) return true
  return available(e.credits) > 0
}

/**
 * The instant a newly bought package of `category` should begin.
 *
 * The day AFTER the last still-useful package of the same category ends — or `now` when she holds
 * none. Never earlier than `now`: a renewal cannot start in the past.
 */
export function nextPackageStart(
  existing: readonly Entitlement[],
  category: Category,
  now: Instant,
): Instant {
  const blocking = existing.filter((e) => blocksRenewal(e, category, now))
  if (blocking.length === 0) return now
  // The LAST one to end. Two overlapping packages of the same category is unusual but real (one
  // member holds two today), and the renewal has to clear both or it overlaps the survivor.
  const lastEnd = blocking.reduce((max, e) => (e.validUntil > max ? e.validUntil : max), blocking[0]!.validUntil)
  return (lastEnd > now ? lastEnd : now) as Instant
}

/**
 * True when a same-category package is CURRENTLY frozen, which is the one case where the start date
 * cannot be computed honestly. The caller refuses rather than inventing a date.
 *
 * `freeze` being non-null only means the package BUYS freeze days; `freeze.activeFrom` is what says
 * it is frozen right now (the same distinction that had six paying members reading as invalid until
 * it was fixed on 2026-07-27).
 */
export function blockedByFrozen(
  existing: readonly Entitlement[],
  category: Category,
  now: Instant,
): boolean {
  return existing.some(
    (e) =>
      e.status === 'active' &&
      e.productSnapshot.category === category &&
      e.validUntil > now &&
      e.freeze?.activeFrom != null,
  )
}

// ── A HYBRID is one window over several categories (2026-07-27) ─────────────────────────────
//
// A bundle grants one entitlement per component, but they share ONE `validFrom`/`validUntil` — it is
// a single sale with a single window. So the queue has to be answered for every category it touches,
// not just the product's "face" category, which for a hybrid is only the one it displays under.
//
// Without this, a member whose Fitness membership runs to October buys a hybrid, the queue looks at
// Pilates alone, and the hybrid's fitness half lands on top of the months she has already paid for.
// That is precisely the overlap the queue exists to prevent, arriving through the one door nobody
// checked.
//
// When the categories AGREE, the answer is that date. When they DISAGREE there is no honest single
// window — starting at the later one denies her the category that was free; starting at the earlier
// one bills her twice for the other. Neither is a decision a checkout should make unattended, so it
// says so and lets a human sell it with the real dates in view.
export type BundleStart =
  | { readonly ok: true; readonly startsAt: Instant }
  | { readonly ok: false; readonly reason: 'categories_disagree'; readonly perCategory: readonly { category: Category; startsAt: Instant }[] }

export function nextBundleStart(
  existing: readonly Entitlement[],
  categories: readonly Category[],
  now: Instant,
): BundleStart {
  const perCategory = [...new Set(categories)].map((category) => ({
    category,
    startsAt: nextPackageStart(existing, category, now),
  }))
  const first = perCategory[0]
  if (!first) return { ok: true, startsAt: now }
  return perCategory.every((c) => c.startsAt === first.startsAt)
    ? { ok: true, startsAt: first.startsAt }
    : { ok: false, reason: 'categories_disagree', perCategory }
}
