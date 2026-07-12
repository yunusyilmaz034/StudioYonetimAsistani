import type {
  Category,
  ClassSessionId,
  EntitlementId,
  Instant,
  LocalDate,
  MemberId,
  OperationId,
  ProductId,
  ServiceId,
  StudioId,
} from '../../../shared'

// D21 / D22 (v1.22) — bulk operations.
//
// These are the most dangerous acts in the product: they cancel classes, release
// money-adjacent credits and extend package validity, across hundreds of objects, on one click.
// So they are modelled the way a migration is modelled — **preview, approve, apply, never twice**
// — and the aggregate exists mainly to hold the guard that makes "never twice" true.

export type OperationStatus = 'planned' | 'applying' | 'applied' | 'cancelled'

// Who the operation touches. Chosen, never assumed: a closure of the Pilates room is not a
// closure of the studio, and extending a fitness member's package for it would be a number the
// owner cannot explain later.
export type OperationScope =
  | { readonly kind: 'studio' }
  | { readonly kind: 'category'; readonly categories: readonly Category[] }
  | { readonly kind: 'service'; readonly serviceIds: readonly ServiceId[] }
  | { readonly kind: 'product'; readonly productIds: readonly ProductId[] }
  | { readonly kind: 'members'; readonly memberIds: readonly MemberId[] }

// ── D21 — StudioClosure ────────────────────────────────────────────────────────────────────
export interface StudioClosure {
  readonly id: string
  // OP-2 — the id every event of this operation carries (it IS the events' correlationId).
  // Minted when the closure is PLANNED, so the plan and the apply are one operation, not two.
  readonly operationId: OperationId
  readonly studioId: StudioId
  readonly dateFrom: LocalDate
  readonly dateTo: LocalDate
  readonly reason: string
  readonly scope: OperationScope
  // D21.3 — the owner CHOOSES this. Five days closed may mean +5, +7, or none. A number this
  // consequential is not derived behind her back.
  readonly extensionDays: number
  readonly calendarDayIds: readonly string[]
  readonly status: OperationStatus
  readonly summary: ClosureSummary | null
  readonly appliedAt: Instant | null
  readonly createdAt: Instant
}

export interface ClosureSummary {
  readonly sessionsCancelled: number
  readonly reservationsReleased: number
  readonly creditsReleased: number
  readonly membersAffected: number
  readonly entitlementsExtended: number
  readonly frozenSkipped: number
  readonly blockedSessions: number
}

// ── D22 — BulkOperation ────────────────────────────────────────────────────────────────────
export type BulkAction =
  | { readonly kind: 'extend_days'; readonly days: number }
  | { readonly kind: 'add_credits'; readonly credits: number }

export interface BulkOperation {
  readonly id: string
  readonly operationId: OperationId
  readonly studioId: StudioId
  readonly action: BulkAction
  readonly scope: OperationScope
  // AD-39 — a credit movement needs a closed-enum reason AND a non-empty note. A bulk operation
  // is a hundred of those, so it carries them once, and every one of them is stamped with it.
  readonly reason: 'gift' | 'correction' | 'migration' | 'support'
  readonly note: string
  readonly status: OperationStatus
  readonly summary: BulkSummary | null
  readonly appliedAt: Instant | null
  readonly createdAt: Instant
}

export interface BulkSummary {
  readonly membersAffected: number
  readonly entitlementsAffected: number
  readonly creditsAdded: number
  readonly daysAdded: number
  readonly skippedFrozen: number
  readonly skippedInactive: number
}

// ── The preview ────────────────────────────────────────────────────────────────────────────
//
// One shape for every bulk act. Three rules, and they are the same three every time:
//   1. NOTHING is skipped without a name. A silent skip is a lie told by omission.
//   2. The preview WRITES NOTHING. It is a pure function over a read.
//   3. Apply RE-DERIVES; it never replays the preview. The world moves in between.

export type SessionSkipReason =
  | 'already_resolved' // ⛔ BLOCKED — a reservation on it is already attended/no_show (OQ-6)
  | 'already_cancelled'

export interface PlannedSession {
  readonly sessionId: ClassSessionId
  readonly serviceName: string
  readonly startsAt: Instant
  readonly bookedCount: number
}

export interface BlockedSession {
  readonly sessionId: ClassSessionId
  readonly serviceName: string
  readonly startsAt: Instant
  readonly reason: SessionSkipReason
  readonly detail: string
}

export type EntitlementSkipReason = 'frozen' | 'not_overlapping' | 'not_active' | 'out_of_scope'

export interface PlannedEntitlement {
  readonly entitlementId: EntitlementId
  readonly memberId: MemberId
  readonly memberName: string
  readonly productName: string
  readonly validUntil: Instant
}

export interface SkippedEntitlement extends PlannedEntitlement {
  readonly reason: EntitlementSkipReason
}

export interface ClosurePlan {
  readonly sessionsToCancel: readonly PlannedSession[]
  readonly blockedSessions: readonly BlockedSession[]
  readonly reservationsToRelease: number
  readonly creditsToRelease: number
  readonly membersAffected: readonly MemberId[]
  readonly entitlementsToExtend: readonly PlannedEntitlement[]
  readonly skippedEntitlements: readonly SkippedEntitlement[]
}

export interface BulkPlan {
  readonly toApply: readonly PlannedEntitlement[]
  readonly skipped: readonly SkippedEntitlement[]
}
