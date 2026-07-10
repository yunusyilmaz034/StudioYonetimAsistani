import type { Instant } from '../../../shared'
import { available, type Entitlement } from '../../entitlements'
import type { ClassSession } from '../../scheduling'

// Which entitlement pays? (OQ-7, I-17). Earliest-expiring-first so the member never
// burns a credit she was about to lose; deterministic tie-break so the same inputs
// always produce the same booking (replay, tests). Reception may override by passing
// an explicit entitlementId to the booking use-case.

export function isBookable(e: Entitlement, session: ClassSession, now: Instant): boolean {
  if (e.status !== 'active') return false
  if (session.startsAt > e.validUntil) return false
  if (e.productSnapshot.category !== session.category) return false
  if (e.credits !== null && available(e.credits) < 1) return false
  void now // reserved: validFrom-in-future check arrives with waitlist/advance rules
  return true
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
