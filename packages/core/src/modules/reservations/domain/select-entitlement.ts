import type { Instant } from '../../../shared'
import { isEligibleForService, type Entitlement } from '../../entitlements'
import type { ClassSession } from '../../scheduling'

// Which entitlement pays? (OQ-7, I-17). Earliest-expiring-first so the member never
// burns a credit she was about to lose; deterministic tie-break so the same inputs
// always produce the same booking (replay, tests). Reception may override by passing
// an explicit entitlementId to the booking use-case.

export function isBookable(e: Entitlement, session: ClassSession, now: Instant): boolean {
  // ONE definition (D12/D13): the same predicate the PT member-picker and the member portal's
  // agenda filter use. If this were re-implemented anywhere else, the UI would eventually offer
  // a booking the domain refuses — or hide one it would have allowed.
  void now // reserved: validFrom-in-future check arrives with waitlist/advance rules
  return isEligibleForService(e, session.category, session.serviceId, session.startsAt)
}

// Credit entitlements are spent before period ones (unlimited access has no scarcity
// and the credits expire); then earliest `validUntil`, then earliest `purchasedAt`,
// then lowest `id`.
function compare(a: Entitlement, b: Entitlement): number {
  const aPeriod = a.credits === null ? 1 : 0
  const bPeriod = b.credits === null ? 1 : 0
  if (aPeriod !== bPeriod) return aPeriod - bPeriod
  if (a.validUntil !== b.validUntil) return a.validUntil - b.validUntil
  if (a.purchasedAt !== b.purchasedAt) return a.purchasedAt - b.purchasedAt
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0
}

export function selectEntitlement(
  candidates: readonly Entitlement[],
  session: ClassSession,
  now: Instant,
): Entitlement | null {
  return [...candidates].filter((e) => isBookable(e, session, now)).sort(compare)[0] ?? null
}

// "Paket süresince" — how many weeks a standing booking should span, taken from the covering package's
// validUntil (the same package selectEntitlement would spend). A CREDIT package stops itself early
// when its credits run out mid-series (the generator reports no_eligible_entitlement), so this is an
// upper bound; a PERIOD package runs to its end. Capped so a mis-typed far-future date can't schedule
// forever. null ⇒ no package covers this slot (nothing to fix).
export function weeksUntilPackageEnd(
  candidates: readonly Entitlement[],
  session: ClassSession,
  now: Instant,
  maxWeeks = 52,
): number | null {
  const covering = selectEntitlement(candidates, session, now)
  if (!covering) return null
  const weeks = Math.ceil((covering.validUntil - now) / (7 * 86_400_000))
  return Math.max(1, Math.min(weeks, maxWeeks))
}
