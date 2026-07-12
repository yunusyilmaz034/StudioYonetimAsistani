import type { LocalDate } from '../../shared'
import type { BulkSummary, ClosureSummary } from './domain/types'

// D21 / D22 — the operations' own events. They record the DECISION and its SUMMARY; the objects
// they touched emit their own, ordinary events (class_session.cancelled, reservation.cancelled,
// entitlement.extended, entitlement.adjusted) — all sharing this operation's `correlationId`.
//
// That is the whole trick: nothing needed a new "bulk" event on the reservation or the ledger.
// A hundred cancellations are a hundred cancellations; what is new is the ACT that caused them,
// and the act is what these events describe.
export const STUDIO_CLOSURE_PLANNED = 'studio_closure.planned'
export const STUDIO_CLOSURE_APPLIED = 'studio_closure.applied'
export const STUDIO_CLOSURE_CANCELLED = 'studio_closure.cancelled'

export const BULK_OPERATION_PLANNED = 'bulk_operation.planned'
export const BULK_OPERATION_APPLIED = 'bulk_operation.applied'

export type StudioClosurePlannedPayload = {
  readonly dateFrom: LocalDate
  readonly dateTo: LocalDate
  readonly scopeKind: string
  readonly extensionDays: number
  readonly reason: string
}
export type StudioClosureAppliedPayload = ClosureSummary & {
  readonly dateFrom: LocalDate
  readonly dateTo: LocalDate
}
export type StudioClosureCancelledPayload = {
  readonly reason: string
}

export type BulkOperationPlannedPayload = {
  readonly action: string
  readonly amount: number
  readonly scopeKind: string
  readonly reason: string
}
export type BulkOperationAppliedPayload = BulkSummary & {
  readonly action: string
  readonly amount: number
}
