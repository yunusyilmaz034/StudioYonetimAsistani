import { FieldValue, Timestamp, type DocumentData } from 'firebase-admin/firestore'

import {
  instant,
  newEventId,
  type EntitlementId,
  type EventId,
  type Instant,
  type MemberId,
  type Money,
  type NewEvent,
  type ProductId,
  type StudioId,
} from '../../../shared'
import {
  available,
  type CreditLedger,
  type Entitlement,
  type EntitlementStatus,
  type FreezeState,
  type ManualPayment,
  type ProductSnapshot,
} from '../domain/types'

const toTs = (i: Instant): Timestamp => Timestamp.fromMillis(i)
const fromTs = (t: Timestamp): Instant => instant(t.toMillis())

export function entitlementToFirestore(e: Entitlement): DocumentData {
  return {
    studioId: e.studioId,
    memberId: e.memberId,
    productId: e.productId,
    productSnapshot: e.productSnapshot,
    policyRef: e.policyRef,
    status: e.status,
    validFrom: toTs(e.validFrom),
    validUntil: toTs(e.validUntil),
    // `available` is denormalised for reads (AD-14); the counters remain the truth.
    credits: e.credits ? { ...e.credits, available: available(e.credits) } : null,
    freeze: e.freeze,
    cancellationLedger: e.cancellationLedger,
    entryLedger: e.entryLedger,
    priceAgreed: e.priceAgreed,
    paidTotal: e.paidTotal,
    manualPayment: e.manualPayment
      ? { ...e.manualPayment, recordedAt: toTs(e.manualPayment.recordedAt) }
      : null,
    purchasedAt: toTs(e.purchasedAt),
    updatedAt: FieldValue.serverTimestamp(),
  }
}

export function entitlementFromFirestore(id: EntitlementId, d: DocumentData): Entitlement {
  const c = d.credits as (CreditLedger & { available?: number }) | null
  return {
    id,
    studioId: d.studioId as StudioId,
    memberId: d.memberId as MemberId,
    productId: d.productId as ProductId,
    productSnapshot: d.productSnapshot as ProductSnapshot,
    policyRef: d.policyRef as Entitlement['policyRef'],
    status: d.status as EntitlementStatus,
    validFrom: fromTs(d.validFrom as Timestamp),
    validUntil: fromTs(d.validUntil as Timestamp),
    credits: c
      ? {
          granted: c.granted,
          held: c.held,
          consumed: c.consumed,
          restored: c.restored,
          revoked: c.revoked,
          expired: c.expired,
        }
      : null,
    freeze: (d.freeze as FreezeState | null) ?? null,
    // Plus Phase 3 — legacy entitlements have no ledger; they start fresh at {0,0}.
    cancellationLedger: (d.cancellationLedger as { used: number; refunded: number } | undefined) ?? {
      used: 0,
      refunded: 0,
    },
    // v1.27 — same for the entry meter; legacy/unlimited docs read as {0,0}.
    entryLedger: (d.entryLedger as { consumed: number; restored: number } | undefined) ?? {
      consumed: 0,
      restored: 0,
    },
    priceAgreed: d.priceAgreed as Money,
    paidTotal: d.paidTotal as Money,
    manualPayment: d.manualPayment
      ? {
          ...(d.manualPayment as ManualPayment),
          recordedAt: fromTs((d.manualPayment as { recordedAt: Timestamp }).recordedAt),
        }
      : null,
    purchasedAt: fromTs(d.purchasedAt as Timestamp),
  }
}

export function eventToFirestore(e: NewEvent): { id: EventId; data: DocumentData } {
  const id = newEventId()
  return { id, data: { ...e, occurredAt: toTs(e.occurredAt), recordedAt: FieldValue.serverTimestamp() } }
}
