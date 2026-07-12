import type { Category, Instant, ServiceId } from '../../../shared'
import { available, type Entitlement, type ProductSnapshot } from './types'

// D12 (v1.21) — service-level eligibility, in ONE place.
//
// Both the decider (`decideBooking`, I-9.8) and the advisory selector (`isBookable`) ask this
// question, and they must never be able to answer it differently: if they drift, the UI offers
// a booking the domain then refuses.
//
// The rule:
//   • snapshot HAS a service list  → the session's service must be in it.
//   • snapshot has NO service list → a pre-D12 purchase. It keeps the category-wide right it
//     was sold under. Absence is not missing data; absence is the record of what was sold.
//     (Never backfilled — that would retroactively narrow a right already paid for.)
//   • an EMPTY list is not "covers everything". It covers nothing, and it cannot be created:
//     `product_requires_service` refuses it at the catalogue. Should one ever exist, this
//     returns false — a package that names no service grants no access.
export function coversService(snapshot: ProductSnapshot, serviceId: ServiceId): boolean {
  const covered = snapshot.serviceIds
  if (covered === undefined) return true // legacy: the category wall alone
  return covered.includes(serviceId)
}

// **The** entitlement-eligibility predicate: *is this package able to pay for this kind of
// class, at this time?*
//
// It is deliberately the MEMBER-DEPENDENT half of `decideBooking` and nothing else — status,
// validity, the category wall (I-9.7), the service wall (I-9.8, D12), and remaining credit.
// It knows nothing about capacity, "already booked", or whether a session exists at all.
//
// That split is what lets the SAME rule serve three callers without any of them writing a
// second, looser copy:
//   • `isBookable` / `selectEntitlement` — booking a real session
//   • the member portal's agenda filter (Batch 7)
//   • the owner's "which members may I reserve this PT slot for?" picker (D13)
// A session-shaped check ("is it full?", "has it started?") would empty that picker for
// reasons that have nothing to do with the member, which is why those checks live elsewhere.
export function isEligibleForService(
  e: Entitlement,
  category: Category,
  serviceId: ServiceId,
  at: Instant,
): boolean {
  if (e.status !== 'active') return false
  if (at > e.validUntil) return false // expired by the time the class runs
  if (e.productSnapshot.category !== category) return false // I-9.7
  if (!coversService(e.productSnapshot, serviceId)) return false // I-9.8 (D12)
  if (e.credits !== null && available(e.credits) < 1) return false // no credit left to spend
  return true
}
