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
  | 'entitlement'
  | 'product'
  | 'classSession'
  | 'reservation'
  | 'payment'
  | 'policy'

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
}

// Small JSON: the delta plus the post-state of every number changed (AD-19).
// No PII (I-13), no entity snapshots.
export type EventPayload = Record<string, unknown>

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
