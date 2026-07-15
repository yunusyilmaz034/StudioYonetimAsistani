import type { ActorRef } from './actor'
import type {
  BranchId,
  ClassSessionId,
  CommandId,
  CorrelationId,
  EntitlementId,
  EventId,
  MemberId,
  PaymentId,
  PolicyId,
  ReservationId,
  StaffUserId,
  StudioId,
} from './ids'
import type { Instant } from './time'

// ⚠ THE CANONICAL EVENT ENVELOPE (Doc 4 §2, AD-42). Its field set and types match
// that document exactly. Changing the envelope is permanent and unrecoverable —
// it is the owner's decision, never a refactor. Doc 3 §4.5 (the Firestore shape)
// mirrors this; if the two ever disagree, this document wins.
//
// Per-event payload TYPES arrive with each module's events.ts. The envelope is
// generic over the payload here so the foundation ships without inventing events.

// `source` is metadata — what typed it in. Domain logic NEVER branches on it (D1).
export type EventSource = string

export type AggregateKind =
  | 'branch'
  | 'member'
  // v1.27 — who may work here, and as what. Additive: no existing event's `subject.kind` changes.
  | 'staff'
  | 'entitlement'
  | 'product'
  | 'service'
  | 'room'
  | 'classTemplate'
  | 'classSession'
  | 'reservation'
  | 'payment'
  | 'policy'
  // Plus Phase 6 (Commerce & Payments) — additive.
  | 'payment_intent'
  | 'retail_product'
  // Plus Phase 7 (Training & Progress) — additive.
  | 'exercise'
  | 'program'
  | 'measurement'
  | 'training_feedback'
  // Plus Phase 8 (Fitness Attendance) — additive.
  | 'fitness_visit'

export interface PolicyRef {
  readonly policyId: PolicyId
  readonly version: number
}

export interface EventSubject {
  readonly kind: AggregateKind
  readonly id: string
}

// Opaque ids only — the join-key set. NEVER any PII (I-13).
export interface EventRelated {
  readonly memberId?: MemberId
  readonly entitlementId?: EntitlementId
  readonly classSessionId?: ClassSessionId
  readonly reservationId?: ReservationId
  readonly paymentId?: PaymentId
  readonly trainerId?: StaffUserId
  // Plus Phase 6+ — additive join keys (opaque ids only, still no PII).
  readonly saleId?: string
  readonly paymentIntentId?: string
  readonly programId?: string
  readonly visitId?: string
}

// Small JSON: the delta plus the post-state of every number changed (AD-19).
// No PII (I-13), no entity snapshots.
export type EventPayload = Record<string, unknown>

// ── OQ-2 (owner, 2026-07-13) — before/after for the Audit Log. ───────────────────────────────
//
// An OPTIONAL, ADDITIVE field inside a state-editing event's PAYLOAD — never in the envelope,
// which must not move (AD-42). Additive means: no version bump, no upcaster, no migration.
//
// History is NOT backfilled and never will be: the before-value of a 2026-06 price edit was
// never recorded, and no amount of engineering produces one. Events written before today carry
// no `changes`, and the Audit Log shows `—` for them and says why (I-30: a screen never invents
// a fact the log does not have).
//
// `from`/`to` hold the RAW domain value (kuruş as an integer, an instant as a number, an enum as
// its string). Formatting is the presenter's job — the log stores facts, not sentences.
export interface FieldChange {
  readonly field: string
  readonly from: unknown
  readonly to: unknown
}

export interface DomainEvent<
  TType extends string = string,
  TPayload extends EventPayload = EventPayload,
> {
  // ── identity ──
  readonly id: EventId
  readonly studioId: StudioId
  readonly branchId: BranchId | null

  // ── what ──
  readonly type: TType
  readonly version: number
  readonly payload: TPayload

  // ── when (D2 — two timestamps, always) ──
  readonly occurredAt: Instant
  readonly recordedAt: Instant

  // ── who (D4) ──
  readonly actor: ActorRef
  readonly source: EventSource

  // ── about what ──
  readonly subject: EventSubject
  readonly related: EventRelated

  // ── why (D3) ──
  readonly policyRef: PolicyRef | null

  // ── causation ──
  readonly commandId: CommandId | null
  readonly causationId: EventId | null
  readonly correlationId: CorrelationId
}

// What a PURE decision function returns: the full envelope minus the two fields
// infrastructure assigns at write time — `id` (a ULID uses randomness) and
// `recordedAt` (serverTimestamp()). The transactor completes these atomically with
// the state write (non-negotiable #1, #7).
export type NewEvent<
  TType extends string = string,
  TPayload extends EventPayload = EventPayload,
> = Omit<DomainEvent<TType, TPayload>, 'id' | 'recordedAt'>
