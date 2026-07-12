import {
  err,
  ok,
  type ActorRef,
  type AggregateKind,
  type CorrelationId,
  type DomainError,
  type EventSource,
  type Instant,
  type NewEvent,
  type Result,
  type StudioId,
} from '../../../shared'
import {
  BULK_OPERATION_APPLIED,
  BULK_OPERATION_PLANNED,
  STUDIO_CLOSURE_APPLIED,
  STUDIO_CLOSURE_CANCELLED,
  STUDIO_CLOSURE_PLANNED,
} from '../events'
import type { BulkOperation, BulkSummary, ClosureSummary, StudioClosure } from './types'

export interface DecideContext {
  readonly studioId: StudioId
  readonly actor: ActorRef
  readonly now: Instant
  readonly correlationId: CorrelationId
  readonly source: EventSource
}

function base(ctx: DecideContext, id: string) {
  return {
    studioId: ctx.studioId,
    branchId: null,
    version: 1,
    occurredAt: ctx.now,
    actor: ctx.actor, // the OWNER. A human declared this; `system` is for sweeps nobody asked for.
    source: ctx.source,
    subject: { kind: 'policy' as AggregateKind, id },
    related: {},
    policyRef: null,
    commandId: null,
    causationId: null,
    correlationId: ctx.correlationId,
  }
}

// ── I-28 — a bulk act is applied AT MOST ONCE ──────────────────────────────────────────────
//
// `status` is the guard, and it is not decoration. Without it a double-click extends every
// package in the studio by six days instead of three — and nothing in the ledger can tell you
// afterwards which of the two happened.
function guardApplicable(status: string): DomainError | null {
  if (status === 'applied') return { code: 'operation_already_applied' }
  if (status === 'cancelled') return { code: 'operation_not_applicable' }
  return null
}

export function decideCloseurePlanned(ctx: DecideContext, c: StudioClosure): Result<NewEvent[], DomainError> {
  if (c.dateTo < c.dateFrom) return err({ code: 'invalid_time_range' })
  if (c.reason.trim().length === 0) return err({ code: 'reason_required' })
  if (c.extensionDays < 0) return err({ code: 'invalid_time_range' })
  return ok([
    {
      ...base(ctx, c.id),
      type: STUDIO_CLOSURE_PLANNED,
      payload: {
        dateFrom: c.dateFrom,
        dateTo: c.dateTo,
        scopeKind: c.scope.kind,
        extensionDays: c.extensionDays,
        reason: c.reason,
      },
    },
  ])
}

export function decideClosureApplicable(c: StudioClosure): Result<void, DomainError> {
  const bad = guardApplicable(c.status)
  return bad ? err(bad) : ok(undefined)
}

export function decideClosureApplied(
  ctx: DecideContext,
  c: StudioClosure,
  summary: ClosureSummary,
): NewEvent[] {
  return [
    {
      ...base(ctx, c.id),
      type: STUDIO_CLOSURE_APPLIED,
      payload: { ...summary, dateFrom: c.dateFrom, dateTo: c.dateTo },
    },
  ]
}

export function decideClosureCancelled(ctx: DecideContext, c: StudioClosure, reason: string): Result<NewEvent[], DomainError> {
  if (reason.trim().length === 0) return err({ code: 'reason_required' })
  const bad = guardApplicable(c.status)
  if (bad) return err(bad)
  return ok([{ ...base(ctx, c.id), type: STUDIO_CLOSURE_CANCELLED, payload: { reason } }])
}

// ── D22 ────────────────────────────────────────────────────────────────────────────────────
export function decideBulkPlanned(ctx: DecideContext, b: BulkOperation): Result<NewEvent[], DomainError> {
  // AD-39 — no bulk credit movement without a reason AND a note. "Gerekçesiz toplu işlem" is
  // exactly the thing nobody can explain three months later.
  if (b.note.trim().length === 0) return err({ code: 'note_required' })
  const amount = b.action.kind === 'extend_days' ? b.action.days : b.action.credits
  if (amount <= 0) return err({ code: 'invalid_time_range' })
  return ok([
    {
      ...base(ctx, b.id),
      type: BULK_OPERATION_PLANNED,
      payload: { action: b.action.kind, amount, scopeKind: b.scope.kind, reason: b.reason },
    },
  ])
}

export function decideBulkApplicable(b: BulkOperation): Result<void, DomainError> {
  const bad = guardApplicable(b.status)
  return bad ? err(bad) : ok(undefined)
}

export function decideBulkApplied(ctx: DecideContext, b: BulkOperation, summary: BulkSummary): NewEvent[] {
  const amount = b.action.kind === 'extend_days' ? b.action.days : b.action.credits
  return [
    {
      ...base(ctx, b.id),
      type: BULK_OPERATION_APPLIED,
      payload: { ...summary, action: b.action.kind, amount },
    },
  ]
}
